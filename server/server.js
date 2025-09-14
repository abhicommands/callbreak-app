import express from "express";
import cors from "cors";

const app = express();
app.use(cors()); // LAN-friendly CORS
app.use(express.json());

// ======================== In-memory store ========================
/**
 * sessions[gameId] = {
 *   // identity
 *   seriesId: string,            // NEW: all games in a series share this
 *   gameIndex: number,           // NEW: 1,2,3...
 *   gameId, name, rounds: 5,
 *   createdAt: number,
 *   resolvedAt?: number,
 *   archived: boolean,
 *
 *   // players & config
 *   players: [{ id, name }],
 *   adminKey,
 *   settlementConfig: { weights:[w2,w3,w4], stake:number, locked:true },
 *
 *   // state
 *   roundInfo: { [1..5]: { dealerId:string, bidderOrder:string[] } }, // dealer last
 *   roundData: {
 *     [1..5]: {
 *       bids:{[pid]:number}, actuals:{[pid]:number}, points:{[pid]:number},
 *       status:"BIDS_SET"|"AUTO_AWARDED"|"PLAYED"|undefined,
 *       locked?:boolean
 *     }
 *   },
 *   perfectCounts: { [pid]: number },
 *   payoutLedger: { [pid]: number },
 *   highBid: { active: boolean, round: number, bidderIds: string[] } | null,
 *
 *   // computed / lifecycle
 *   settlementApplied: boolean,
 *   lastSettlementResult?: { applied:true, appliedAt:number, ...calc },
 *
 *   // immutable history (per round) — surfaced only after game is resolved
 *   roundHistory: { [round:number]: { at:number, round:number, type:"AUTO_AWARDED"|"PLAYED", bids:any, actuals?:any, points:any, status:string } },
 *   roundEvents: { [round:number]: Array<{ at:number, type:string, [k:string]:any }> },
 * }
 */
const sessions = {};

const rid = (len = 8) =>
  Math.random()
    .toString(36)
    .slice(2, 2 + len)
    .toUpperCase();
const pid = (len = 6) =>
  Math.random()
    .toString(36)
    .slice(2, 2 + len);

// =========================== Helpers ============================
function ensurePayoutLedger(s) {
  if (!s.payoutLedger) s.payoutLedger = {};
  for (const p of s.players)
    if (!(p.id in s.payoutLedger)) s.payoutLedger[p.id] = 0;
}
function ensurePerfectCounts(s) {
  if (!s.perfectCounts) s.perfectCounts = {};
  for (const p of s.players)
    if (!(p.id in s.perfectCounts)) s.perfectCounts[p.id] = 0;
}
function ensureHistoryStructs(s) {
  if (!s.roundHistory) s.roundHistory = {};
  if (!s.roundEvents) s.roundEvents = {};
}
function pushRoundEvent(s, round, evt) {
  ensureHistoryStructs(s);
  if (!s.roundEvents[round]) s.roundEvents[round] = [];
  s.roundEvents[round].push({ at: Date.now(), round, ...evt });
}
function snapshotRoundOnce(s, round, snapshot) {
  ensureHistoryStructs(s);
  if (!s.roundHistory[round]) {
    s.roundHistory[round] = { at: Date.now(), round, ...snapshot };
  }
}

function calcPoints(bid, actual) {
  // exact → bid; overtricks → bid + (extra/10); under → -bid
  if (typeof bid !== "number" || typeof actual !== "number") return 0;
  if (actual < bid) return -bid;
  const extra = actual - bid;
  return Number((bid + extra / 10).toFixed(1));
}

function totalsPoints(s) {
  const totals = {};
  for (const p of s.players) totals[p.id] = 0;
  for (const r of Object.keys(s.roundData || {})) {
    const pts = s.roundData[r]?.points || {};
    for (const [pid, val] of Object.entries(pts)) {
      const v = Number(val);
      if (!Number.isNaN(v)) totals[pid] += v;
    }
  }
  return totals;
}

function allRoundsResolved(s) {
  for (let r = 1; r <= s.rounds; r++) {
    const st = s.roundData?.[r]?.status;
    if (st !== "AUTO_AWARDED" && st !== "PLAYED") return false;
  }
  return true;
}

/** Initialize dealer/bidder rotation for 5 rounds.
 * Round r dealer = players[(r-1) % 4]; bidderOrder = (next...wrap...) dealer last.
 * If startDealerId provided, rotate so that round 1 dealer = startDealerId.
 */
function initDealerRotation(s, startDealerId = null) {
  s.roundInfo = {};
  const n = s.players.length;
  if (n !== 4) throw new Error("Game requires exactly 4 players.");
  let baseOrder = [...s.players];

  if (startDealerId) {
    const idx = baseOrder.findIndex((p) => p.id === startDealerId);
    if (idx >= 0)
      baseOrder = [...baseOrder.slice(idx), ...baseOrder.slice(0, idx)];
  }

  for (let r = 1; r <= s.rounds; r++) {
    const dealerIndex = (r - 1) % n;
    const dealerId = baseOrder[dealerIndex].id;
    const inOrder = [
      ...baseOrder.slice(dealerIndex + 1),
      ...baseOrder.slice(0, dealerIndex + 1),
    ].map((p) => p.id);
    s.roundInfo[r] = { dealerId, bidderOrder: inOrder }; // dealer is last
  }
}

/** Apply auto-award for a round (NOT round 5): everyone gets bid + 0.1. */
function applyAutoAward(s, round, bidsObj) {
  ensurePerfectCounts(s);
  const rd = (s.roundData[round] = s.roundData[round] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  rd.bids = {};
  rd.actuals = {};
  rd.points = {};
  for (const p of s.players) {
    const b = Number(bidsObj[p.id] || 0);
    rd.bids[p.id] = b;
    const points = Number((b + 0.1).toFixed(1));
    rd.points[p.id] = points;
    // counts as “perfect” by your rule
    s.perfectCounts[p.id] = (s.perfectCounts[p.id] || 0) + 1;
  }
  rd.status = "AUTO_AWARDED";
  rd.locked = true;
  snapshotRoundOnce(s, round, {
    type: "AUTO_AWARDED",
    bids: { ...rd.bids },
    actuals: {},
    points: { ...rd.points },
    status: rd.status,
  });
  pushRoundEvent(s, round, { type: "AUTO_AWARDED", bids: { ...rd.bids } });
}

/** Score a normal played round given bids + actuals */
function scorePlayedRound(s, round) {
  ensurePerfectCounts(s);
  const rd = s.roundData[round];
  rd.points = {};
  for (const p of s.players) {
    const b = Number(rd.bids[p.id] ?? 0);
    const a = Number(rd.actuals[p.id] ?? 0);
    const pts = calcPoints(b, a);
    rd.points[p.id] = pts;
    if (a === b) s.perfectCounts[p.id] = (s.perfectCounts[p.id] || 0) + 1;
  }
  rd.status = "PLAYED";
  rd.locked = true;
  snapshotRoundOnce(s, round, {
    type: "PLAYED",
    bids: { ...rd.bids },
    actuals: { ...rd.actuals },
    points: { ...rd.points },
    status: rd.status,
  });
  pushRoundEvent(s, round, {
    type: "PLAYED",
    bids: { ...rd.bids },
    actuals: { ...rd.actuals },
  });
}

/** Compute final settlement, with special Exact-5 override. */
function computeFinalSettlement(s) {
  const totals = totalsPoints(s);
  const baseRanking = s.players
    .map((p) => ({ id: p.id, name: p.name, total: Number(totals[p.id] || 0) }))
    .sort((a, b) => b.total - a.total);

  if (baseRanking.length !== 4) throw new Error("Invalid players");

  ensurePerfectCounts(s);
  const perfectWinners = s.players.filter(
    (p) => (s.perfectCounts[p.id] || 0) >= 5
  );
  let ranking;

  if (perfectWinners.length === 1) {
    const winnerId = perfectWinners[0].id;
    const winner = baseRanking.find((r) => r.id === winnerId);
    const others = baseRanking.filter((r) => r.id !== winnerId);
    ranking = [winner, ...others];
  } else {
    ranking = baseRanking;
  }

  const [winner, second, third, fourth] = ranking;
  const { weights = [1, 2, 3], stake = 1 } = s.settlementConfig || {};
  const winnerOver20 = winner.total > 20;

  const base = {
    [second.id]: weights[0] || 0,
    [third.id]: weights[1] || 0,
    [fourth.id]: weights[2] || 0,
  };
  const unitsFor = (loser) =>
    base[loser.id] * (winnerOver20 ? 2 : 1) * (loser.total < 0 ? 2 : 1);

  const payouts = [
    {
      fromPlayerId: second.id,
      toPlayerId: winner.id,
      units: unitsFor(second),
      amount: unitsFor(second) * stake,
    },
    {
      fromPlayerId: third.id,
      toPlayerId: winner.id,
      units: unitsFor(third),
      amount: unitsFor(third) * stake,
    },
    {
      fromPlayerId: fourth.id,
      toPlayerId: winner.id,
      units: unitsFor(fourth),
      amount: unitsFor(fourth) * stake,
    },
  ];

  const perPlayerDelta = {};
  for (const p of s.players) perPlayerDelta[p.id] = 0;
  for (const p of payouts) {
    perPlayerDelta[p.fromPlayerId] -= p.amount;
    perPlayerDelta[p.toPlayerId] += p.amount;
  }

  return {
    totalsPoints: totals,
    ranking,
    weights,
    stake,
    winnerOver20,
    payouts,
    perPlayerDelta,
    perfectCounts: { ...(s.perfectCounts || {}) },
  };
}

// ============================ API ==============================

// 0) Series helpers
function listSeriesGames(seriesId) {
  return Object.values(sessions)
    .filter((s) => (s.seriesId || s.gameId) === seriesId)
    .map((g) => ({
      seriesId: g.seriesId,
      gameId: g.gameId,
      gameIndex: g.gameIndex || 1,
      name: g.name,
      createdAt: g.createdAt,
      resolvedAt: g.resolvedAt || null,
      archived: !!g.archived,
      settlementApplied: !!g.settlementApplied,
    }))
    .sort((a, b) => a.gameIndex - b.gameIndex);
}

// 1) Create game
app.post("/create-game", (req, res) => {
  try {
    const {
      name,
      players = [],
      weights,
      stake = 1,
      startDealerId = null, // can pass a known player id
      startDealerName = null, // convenience: match by name
      startDealerIndex = null, // convenience: 0..3
      seriesId = null, // OPTIONAL: attach to an existing series explicitly
    } = req.body || {};

    if (!name || !Array.isArray(players) || players.length !== 4)
      return res
        .status(400)
        .json({ error: "Provide game name and exactly 4 players." });

    if (
      !Array.isArray(weights) ||
      weights.length !== 3 ||
      !weights.every((x) => Number.isFinite(Number(x)) && Number(x) >= 0)
    )
      return res.status(400).json({
        error:
          "weights must be [w2,w3,w4] non-negative numbers (e.g., [1,2,3]).",
      });

    const stakeNum = Number(stake);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0)
      return res.status(400).json({ error: "stake must be a positive number" });

    // Figure out series & index
    const newSeriesId = seriesId || rid(10);
    const maxIndexInSeries = listSeriesGames(newSeriesId).reduce(
      (m, g) => Math.max(m, g.gameIndex || 0),
      0
    );
    const thisGameIndex = maxIndexInSeries + 1;

    const gameId = rid(8);
    const adminKey = rid(12);
    const ps = players.map((n) => ({ id: pid(), name: String(n).trim() }));

    sessions[gameId] = {
      // identity
      seriesId: newSeriesId,
      gameIndex: thisGameIndex,
      gameId,
      name: String(name).trim(),
      rounds: 5,
      createdAt: Date.now(),
      archived: false,

      // players & config
      players: ps,
      adminKey,
      settlementConfig: {
        weights: weights.map(Number),
        stake: stakeNum,
        locked: true,
      },

      // state
      roundInfo: {},
      roundData: {},
      perfectCounts: Object.fromEntries(ps.map((p) => [p.id, 0])),
      payoutLedger: Object.fromEntries(ps.map((p) => [p.id, 0])),
      highBid: null,

      // lifecycle
      settlementApplied: false,
      lastSettlementResult: undefined,

      // history
      roundHistory: {},
      roundEvents: {},
    };

    // resolve starting dealer
    let resolvedDealerId = null;
    if (startDealerId && ps.some((p) => p.id === startDealerId)) {
      resolvedDealerId = startDealerId;
    } else if (typeof startDealerName === "string" && startDealerName.trim()) {
      const target = ps.find(
        (p) => p.name.toLowerCase() === startDealerName.trim().toLowerCase()
      );
      if (target) resolvedDealerId = target.id;
    } else if (Number.isInteger(Number(startDealerIndex))) {
      const idx = Number(startDealerIndex);
      if (idx >= 0 && idx < ps.length) resolvedDealerId = ps[idx].id;
    }

    initDealerRotation(sessions[gameId], resolvedDealerId || ps[0].id);

    res.json({
      seriesId: sessions[gameId].seriesId,
      gameIndex: sessions[gameId].gameIndex,
      gameId,
      adminKey,
      players: ps,
      settlementConfig: sessions[gameId].settlementConfig,
      roundInfo: sessions[gameId].roundInfo,
      startDealerId: resolvedDealerId || ps[0].id,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create game." });
  }
});

// 2) Public state
app.get("/game/:gameId", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });
  const { adminKey, ...pub } = s;
  res.json({ ...pub, gameId: req.params.gameId });
});

// 3) Admin: set bids for a round (all 4 at once)
app.post("/game/:gameId/set-bids", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, round, bids } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  const r = Number(round);
  if (!Number.isInteger(r) || r < 1 || r > s.rounds)
    return res.status(400).json({ error: "Invalid round" });
  if (!bids || typeof bids !== "object")
    return res.status(400).json({ error: "bids is required" });

  const existing = s.roundData[r];
  if (existing?.locked)
    return res
      .status(400)
      .json({ error: "Round is locked; history is immutable." });

  const validIds = new Set(s.players.map((p) => p.id));
  const incomingIds = Object.keys(bids);
  if (
    incomingIds.length !== s.players.length ||
    !incomingIds.every((id) => validIds.has(id))
  )
    return res
      .status(400)
      .json({ error: "Provide bids for all 4 valid players." });

  const normalized = {};
  let anyHigh = false;
  let sum = 0;
  for (const id of incomingIds) {
    const v = Number(bids[id]);
    if (!Number.isFinite(v) || !Number.isInteger(v))
      return res.status(400).json({ error: "Each bid must be an integer" });
    if (v < 1) return res.status(400).json({ error: "Each bid must be >= 1" });
    if (v > 13) return res.status(400).json({ error: "Bid must be <= 13" });
    if (v >= 8) anyHigh = true;
    normalized[id] = v;
    sum += v;
  }

  // High-bid — don't persist to round; record event + set highBid
  if (anyHigh) {
    const bidderIds = incomingIds.filter((id) => normalized[id] >= 8);
    s.highBid = { active: true, round: r, bidderIds };
    pushRoundEvent(s, r, {
      type: "HIGH_BID_TRIGGERED",
      bidderIds: [...bidderIds],
    });
    return res.status(409).json({
      error: "HIGH_BID_TRIGGERED",
      message:
        "At least one bid is >= 8. Resolve the side game, or edit bids to be < 8.",
      highBidTriggered: true,
      bidderIds,
      round: r,
    });
  }

  // Auto-award when total bids < 10, but NOT on last round (r !== 5)
  if (sum < 10 && r !== 5) {
    applyAutoAward(s, r, normalized);
    if (s.highBid?.active && s.highBid.round === r) s.highBid = null;
    return res.json({ ok: true, autoAwarded: true, roundData: s.roundData[r] });
  }

  // Persist bids and wait for actuals
  const rd = (s.roundData[r] = s.roundData[r] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  rd.bids = normalized;
  rd.actuals = {};
  rd.points = {};
  rd.status = "BIDS_SET";
  pushRoundEvent(s, r, { type: "BIDS_SET", bids: { ...rd.bids } });

  if (s.highBid?.active && s.highBid.round === r) s.highBid = null;
  return res.json({ ok: true, autoAwarded: false, roundData: rd });
});

// 4) Admin: resolve high-bid side game (updates payout ledger)
app.post("/game/:gameId/resolve-highbid", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, round, bidderId, winnerId, stake } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  const r = Number(round);
  if (!Number.isInteger(r) || r < 1 || r > s.rounds)
    return res.status(400).json({ error: "Invalid round" });

  if (!s.highBid?.active || s.highBid.round !== r)
    return res.status(400).json({ error: "No active high bid for this round" });

  const ids = new Set(s.players.map((p) => p.id));
  if (!ids.has(bidderId) || !ids.has(winnerId))
    return res.status(400).json({ error: "Invalid bidderId or winnerId" });
  if (!s.highBid.bidderIds.includes(bidderId))
    return res
      .status(400)
      .json({ error: "bidderId not in active high bidders" });

  const st = Number(stake);
  if (!Number.isFinite(st) || st <= 0)
    return res.status(400).json({ error: "Stake must be a positive number" });

  ensurePayoutLedger(s);

  if (winnerId === bidderId) {
    for (const p of s.players) {
      if (p.id === bidderId) s.payoutLedger[p.id] += 3 * st;
      else s.payoutLedger[p.id] -= st;
    }
  } else {
    for (const p of s.players) {
      if (p.id === bidderId) s.payoutLedger[p.id] -= 3 * st;
      else s.payoutLedger[p.id] += st;
    }
  }

  // Clear bids for the round to force re-entry (if not locked)
  const rd = (s.roundData[r] = s.roundData[r] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  if (rd.locked)
    return res
      .status(400)
      .json({ error: "Round is locked; history is immutable." });

  rd.bids = {};
  rd.status = undefined;
  s.highBid = null;

  pushRoundEvent(s, r, {
    type: "HIGH_BID_RESOLVED",
    bidderId,
    winnerId,
    stake: st,
    mode: winnerId === bidderId ? "BIDDER_WON" : "BIDDER_LOST",
  });

  return res.json({
    ok: true,
    applied: {
      bidderId,
      winnerId,
      stake: st,
      mode: winnerId === bidderId ? "BIDDER_WON" : "BIDDER_LOST",
    },
    payoutLedger: { ...s.payoutLedger },
    roundData: rd,
  });
});

// 5) Admin: cancel high-bid (clears highBid without resolution)
app.post("/game/:gameId/cancel-highbid", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, round } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  const r = Number(round);
  if (!Number.isInteger(r) || r < 1 || r > s.rounds)
    return res.status(400).json({ error: "Invalid round" });

  if (!s.highBid?.active || s.highBid.round !== r)
    return res.status(400).json({ error: "No active high bid for this round" });

  const rd = (s.roundData[r] = s.roundData[r] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  if (rd.locked)
    return res
      .status(400)
      .json({ error: "Round is locked; history is immutable." });

  rd.bids = {};
  rd.status = undefined;
  s.highBid = null;

  pushRoundEvent(s, r, { type: "HIGH_BID_CANCELED" });

  return res.json({ ok: true, roundData: rd });
});

// 6) Admin: set actuals (resolve round). Requires all 4, sum=13.
app.post("/game/:gameId/set-actuals", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, round, actuals } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  const r = Number(round);
  if (!Number.isInteger(r) || r < 1 || r > s.rounds)
    return res.status(400).json({ error: "Invalid round" });
  if (!actuals || typeof actuals !== "object")
    return res.status(400).json({ error: "actuals is required" });

  if (s.highBid?.active && s.highBid.round === r)
    return res
      .status(400)
      .json({ error: "Resolve high bid for this round first" });

  const rd = (s.roundData[r] = s.roundData[r] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  if (rd.locked)
    return res
      .status(400)
      .json({ error: "Round is locked; history is immutable." });

  if (!rd.bids || Object.keys(rd.bids).length !== s.players.length)
    return res.status(400).json({ error: "Set bids first for all 4 players." });
  if (rd.status === "AUTO_AWARDED")
    return res
      .status(400)
      .json({ error: "Round already auto-awarded. No actuals needed." });

  const validIds = new Set(s.players.map((p) => p.id));
  const incomingIds = Object.keys(actuals);
  if (
    incomingIds.length !== s.players.length ||
    !incomingIds.every((id) => validIds.has(id))
  )
    return res
      .status(400)
      .json({ error: "Provide actuals for all 4 valid players." });

  let sum = 0;
  rd.actuals = {};
  for (const id of incomingIds) {
    const v = Number(actuals[id]);
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 13)
      return res
        .status(400)
        .json({ error: "Each actual must be an integer between 0 and 13" });
    rd.actuals[id] = v;
    sum += v;
  }
  if (sum !== 13)
    return res.status(400).json({ error: "Sum of actuals must be 13" });

  scorePlayedRound(s, r);
  return res.json({ ok: true, roundData: s.roundData[r] });
});

// 7) Summary — live payout + this game totals + settlement preview (if possible) + roundInfo
app.get("/game/:gameId/summary", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  ensurePayoutLedger(s);
  ensurePerfectCounts(s);

  const resp = {
    seriesId: s.seriesId,
    gameIndex: s.gameIndex,
    gameId: s.gameId,
    name: s.name,
    players: s.players,
    payouts: { ...s.payoutLedger },
    settlementApplied: !!s.settlementApplied,
    totalsPoints: totalsPoints(s),
    roundInfo: s.roundInfo,
    perfectCounts: s.perfectCounts,
  };

  if (s.settlementApplied && s.lastSettlementResult) {
    resp.settlement = s.lastSettlementResult; // applied
  } else if (allRoundsResolved(s)) {
    try {
      resp.settlement = { applied: false, ...computeFinalSettlement(s) }; // preview
    } catch {
      // ignore
    }
  }

  res.json(resp);
});

// 8) Admin: resolve game (apply final settlement)
app.post("/game/:gameId/resolve-game", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });
  const { adminKey } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });
  if (!allRoundsResolved(s))
    return res
      .status(400)
      .json({ error: "All 5 rounds must be resolved first." });
  if (s.settlementApplied)
    return res.status(400).json({ error: "Settlement already applied." });

  try {
    const result = computeFinalSettlement(s);
    ensurePayoutLedger(s);
    for (const p of result.payouts) {
      s.payoutLedger[p.fromPlayerId] -= p.amount;
      s.payoutLedger[p.toPlayerId] += p.amount;
    }
    s.settlementApplied = true;
    s.resolvedAt = Date.now();
    s.lastSettlementResult = {
      applied: true,
      appliedAt: s.resolvedAt,
      ...result,
    };
    res.json({ ok: true, payoutLedger: { ...s.payoutLedger } });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to resolve game" });
  }
});

// 9) Admin: start a NEW 5-round game, carrying payout ledger forward
// Dealer for new game = loser (last place) of last settlement by totals
app.post("/game/:gameId/next-game", (req, res) => {
  const old = sessions[req.params.gameId];
  if (!old || old.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey } = req.body || {};
  if (adminKey !== old.adminKey)
    return res.status(403).json({ error: "Unauthorized" });
  if (!old.settlementApplied)
    return res
      .status(400)
      .json({ error: "Resolve game before starting a new one." });

  const gameId = rid(8);
  const newAdminKey = rid(12);
  const seriesId = old.seriesId || old.gameId;

  const newGameIndex = (old.gameIndex || 1) + 1;
  const newGame = {
    // identity
    seriesId,
    gameIndex: newGameIndex,
    gameId,
    name: old.name,
    rounds: 5,
    createdAt: Date.now(),
    archived: false,

    // players & config
    players: old.players.map((p) => ({ ...p })),
    adminKey: newAdminKey,
    settlementConfig: { ...old.settlementConfig },

    // state
    roundInfo: {},
    roundData: {},
    perfectCounts: Object.fromEntries(old.players.map((p) => [p.id, 0])),
    payoutLedger: { ...old.payoutLedger }, // carry forward
    highBid: null,

    // lifecycle
    settlementApplied: false,
    lastSettlementResult: undefined,

    // history
    roundHistory: {},
    roundEvents: {},
  };

  // Compute loser (last place) from last settlement to be next game's starting dealer
  let startDealerId = newGame.players[0].id;
  const lastRank = old.lastSettlementResult?.ranking;
  if (Array.isArray(lastRank) && lastRank.length === 4) {
    const loser = lastRank[lastRank.length - 1];
    if (loser?.id) startDealerId = loser.id;
  }

  initDealerRotation(newGame, startDealerId);

  old.archived = true;
  sessions[gameId] = newGame;

  res.json({
    seriesId,
    gameIndex: newGameIndex,
    gameId,
    adminKey: newAdminKey,
    roundInfo: newGame.roundInfo,
  });
});

// 10) Admin: reorder players (recomputes dealer/bidder rotation)
app.post("/game/:gameId/reorder-players", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, newOrder } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  if (!Array.isArray(newOrder) || newOrder.length !== s.players.length)
    return res
      .status(400)
      .json({ error: "newOrder must include all 4 player ids" });

  const idSet = new Set(newOrder);
  const validSet = new Set(s.players.map((p) => p.id));
  if (idSet.size !== validSet.size || ![...idSet].every((x) => validSet.has(x)))
    return res.status(400).json({ error: "Invalid player IDs" });

  s.players = newOrder.map((id) => s.players.find((p) => p.id === id));
  initDealerRotation(s, s.players[0].id);

  res.json({ ok: true, players: s.players, roundInfo: s.roundInfo });
});

// 11) Admin: override dealer for a round (recomputes bidder order)
app.post("/game/:gameId/set-dealer", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, round, dealerId } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  const r = Number(round);
  if (!Number.isInteger(r) || r < 1 || r > s.rounds)
    return res.status(400).json({ error: "Invalid round" });
  if (!s.players.find((p) => p.id === dealerId))
    return res.status(400).json({ error: "Invalid dealerId" });

  s.roundInfo[r] = s.roundInfo[r] || {};
  s.roundInfo[r].dealerId = dealerId;
  const idx = s.players.findIndex((p) => p.id === dealerId);
  const bidderOrder = [
    ...s.players.slice(idx + 1),
    ...s.players.slice(0, idx + 1),
  ].map((p) => p.id);
  s.roundInfo[r].bidderOrder = bidderOrder;

  res.json({ ok: true, roundInfo: s.roundInfo[r] });
});

// 12) Admin: override full bidder order for a round (last is dealer)
app.post("/game/:gameId/set-bidders", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s || s.archived)
    return res.status(404).json({ error: "Game not found" });

  const { adminKey, round, bidderOrder } = req.body || {};
  if (adminKey !== s.adminKey)
    return res.status(403).json({ error: "Unauthorized" });

  const r = Number(round);
  if (!Number.isInteger(r) || r < 1 || r > s.rounds)
    return res.status(400).json({ error: "Invalid round" });

  const validIds = new Set(s.players.map((p) => p.id));
  if (!Array.isArray(bidderOrder) || bidderOrder.length !== s.players.length)
    return res
      .status(400)
      .json({ error: "bidderOrder must include all 4 players" });
  if (!bidderOrder.every((id) => validIds.has(id)))
    return res.status(400).json({ error: "Invalid bidderOrder ids" });

  s.roundInfo[r] = s.roundInfo[r] || {};
  s.roundInfo[r].bidderOrder = bidderOrder;
  s.roundInfo[r].dealerId = bidderOrder[bidderOrder.length - 1];

  res.json({ ok: true, roundInfo: s.roundInfo[r] });
});

// ============ SERIES & HISTORY (game-level only) ============

// A) List games in the same series as :gameId (ordered by gameIndex)
app.get("/series/by-game/:gameId", (req, res) => {
  const cur = sessions[req.params.gameId];
  if (!cur) return res.status(404).json({ error: "Game not found" });
  const seriesId = cur.seriesId || cur.gameId;
  const games = listSeriesGames(seriesId);
  res.json({ seriesId, currentGameId: cur.gameId, games });
});

// B) List games by seriesId directly (ordered by gameIndex)
app.get("/series/:seriesId/games", (req, res) => {
  const games = listSeriesGames(req.params.seriesId);
  if (!games.length) return res.status(404).json({ error: "Series not found" });
  res.json({ seriesId: req.params.seriesId, games });
});

// C) Full game history (all rounds) by gameId — ONLY AFTER RESOLUTION
app.get("/game/:gameId/history", (req, res) => {
  const s = sessions[req.params.gameId];
  if (!s) return res.status(404).json({ error: "Game not found" });

  if (!s.settlementApplied) {
    return res.status(403).json({
      error: "HISTORY_LOCKED_UNTIL_GAME_RESOLVED",
      message: "Game history becomes available after the game is resolved.",
    });
  }

  res.json({
    seriesId: s.seriesId,
    gameIndex: s.gameIndex,
    gameId: s.gameId,
    name: s.name,
    players: s.players,
    roundHistory: s.roundHistory || {},
    roundEvents: s.roundEvents || {},
    resolvedAt: s.resolvedAt || null,
  });
});

// ============================ Start =============================
const PORT = process.env.PORT || 5001;
app.listen(PORT, () =>
  console.log(`Server running on http://0.0.0.0:${PORT} (LAN-ready)`)
);
