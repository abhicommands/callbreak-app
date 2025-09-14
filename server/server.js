import express from "express";
import cors from "cors";

const app = express();
app.use(cors()); // LAN-friendly CORS
app.use(express.json());

// ======================== In-memory store ========================
/**
 * sessions[gameId] = {
 *   gameId, name, rounds: 5,
 *   players: [{ id, name }],
 *   adminKey,
 *   roundData: {
 *     [1..5]: { bids:{[pid]:number}, actuals:{[pid]:number}, points:{[pid]:number}, status:"BIDS_SET"|"AUTO_AWARDED"|"PLAYED"|undefined }
 *   },
 *   roundInfo: { [1..5]: { dealerId:string, bidderOrder:string[] } }, // dealer is always last in bidderOrder
 *   perfectCounts: { [pid]: number },     // rounds where player was exact or round was auto-awarded
 *   payoutLedger: { [pid]: number },      // running money tally (carries forward)
 *   highBid: { active: boolean, round: number, bidderIds: string[] } | null,
 *   settlementConfig: { weights:[w2,w3,w4], stake:number, locked:true },
 *   settlementApplied: boolean,
 *   lastSettlementResult?: { applied:true, appliedAt:number, ...calc },
 *   archived: boolean,
 *   createdAt: number
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

function calcPoints(bid, actual) {
  // Base round scoring: exact → bid; overtricks → bid + (extra/10); under → -bid
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
 * Round r dealer = players[(r-1) % 4], bidderOrder = next...wrap..., dealer last
 * If startDealerId provided, rotate so that round 1 dealer = startDealerId.
 */
function initDealerRotation(s, startDealerId = null) {
  s.roundInfo = {};
  const n = s.players.length;
  if (n !== 4) throw new Error("Game requires exactly 4 players.");
  let baseOrder = [...s.players];

  if (startDealerId) {
    const idx = baseOrder.findIndex((p) => p.id === startDealerId);
    if (idx >= 0) {
      baseOrder = [...baseOrder.slice(idx), ...baseOrder.slice(0, idx)];
    }
  }

  for (let r = 1; r <= s.rounds; r++) {
    const dealerIndex = (r - 1) % n; // cycles
    const dealerId = baseOrder[dealerIndex].id;
    const inOrder = [
      ...baseOrder.slice(dealerIndex + 1),
      ...baseOrder.slice(0, dealerIndex + 1),
    ].map((p) => p.id);
    s.roundInfo[r] = { dealerId, bidderOrder: inOrder }; // dealer is last
  }
}

/** Apply auto-award for a round: everyone gets bid + 0.1, status= AUTO_AWARDED. */
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
    // Count as “perfect” round for the special 5× rule (3.1*5 qualifies)
    s.perfectCounts[p.id] = (s.perfectCounts[p.id] || 0) + 1;
  }
  rd.status = "AUTO_AWARDED";
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
    // Count as “perfect” if exact (actual === bid)
    if (a === b) s.perfectCounts[p.id] = (s.perfectCounts[p.id] || 0) + 1;
  }
  rd.status = "PLAYED";
}

/** Compute final settlement, with special Exact-5 override. */
function computeFinalSettlement(s) {
  const totals = totalsPoints(s); // points this game
  const baseRanking = s.players
    .map((p) => ({ id: p.id, name: p.name, total: Number(totals[p.id] || 0) }))
    .sort((a, b) => b.total - a.total);

  if (baseRanking.length !== 4) throw new Error("Invalid players");

  // Special override: any player with perfectCounts >=5 becomes overall winner.
  ensurePerfectCounts(s);
  const perfectWinners = s.players.filter(
    (p) => (s.perfectCounts[p.id] || 0) >= 5
  );
  let ranking;

  if (perfectWinners.length === 1) {
    const winnerId = perfectWinners[0].id;
    const winner = baseRanking.find((r) => r.id === winnerId);
    const others = baseRanking.filter((r) => r.id !== winnerId);
    ranking = [winner, ...others]; // force winner to top
  } else {
    // 0 or >1 perfect winners: fall back to normal totals ranking
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

// 1) Create game
app.post("/create-game", (req, res) => {
  try {
    const {
      name,
      players = [],
      weights,
      stake = 1,
      startDealerId = null,
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

    const gameId = rid(8);
    const adminKey = rid(12);
    const ps = players.map((n) => ({ id: pid(), name: String(n).trim() }));

    sessions[gameId] = {
      gameId,
      name: String(name).trim(),
      rounds: 5,
      players: ps,
      adminKey,
      roundData: {},
      roundInfo: {},
      perfectCounts: Object.fromEntries(ps.map((p) => [p.id, 0])),
      payoutLedger: Object.fromEntries(ps.map((p) => [p.id, 0])),
      highBid: null,
      settlementConfig: {
        weights: weights.map(Number),
        stake: stakeNum,
        locked: true,
      },
      settlementApplied: false,
      archived: false,
      createdAt: Date.now(),
    };

    initDealerRotation(sessions[gameId], startDealerId || ps[0].id);
    res.json({
      gameId,
      adminKey,
      settlementConfig: sessions[gameId].settlementConfig,
      roundInfo: sessions[gameId].roundInfo,
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

  const validIds = new Set(s.players.map((p) => p.id));
  const playersCount = s.players.length;
  // Validate exactly 4 bids
  const incomingIds = Object.keys(bids);
  if (
    incomingIds.length !== playersCount ||
    !incomingIds.every((id) => validIds.has(id))
  ) {
    return res
      .status(400)
      .json({ error: "Provide bids for all 4 valid players." });
  }

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

  // High-bid — don't persist; ask client to resolve side game first
  if (anyHigh) {
    const bidderIds = incomingIds.filter((id) => normalized[id] >= 8);
    s.highBid = { active: true, round: r, bidderIds };
    return res.status(409).json({
      error: "HIGH_BID_TRIGGERED",
      message:
        "At least one bid is >= 8. Resolve the side game, or edit bids to be < 8.",
      highBidTriggered: true,
      bidderIds,
      round: r,
    });
  }

  // Auto-award when total bids < 10 → everyone gets bid + 0.1, but not on last round
  if (sum < 10 && r !== 5) {
    applyAutoAward(s, r, normalized);
    if (s.highBid?.active && s.highBid.round === r) s.highBid = null;
    return res.json({ ok: true, autoAwarded: true, roundData: s.roundData[r] });
  }

  // Otherwise just persist bids and wait for actuals
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
    // bidder wins: +3×stake to bidder, −stake to others
    for (const p of s.players) {
      if (p.id === bidderId) s.payoutLedger[p.id] += 3 * st;
      else s.payoutLedger[p.id] -= st;
    }
  } else {
    // bidder loses: −3×stake to bidder, +stake to others
    for (const p of s.players) {
      if (p.id === bidderId) s.payoutLedger[p.id] -= 3 * st;
      else s.payoutLedger[p.id] += st;
    }
  }

  // Clear bids for the round to force re-entry
  const rd = (s.roundData[r] = s.roundData[r] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  rd.bids = {};
  rd.status = undefined;
  s.highBid = null;

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

  // Clear bids for the round to force re-entry
  const rd = (s.roundData[r] = s.roundData[r] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  rd.bids = {};
  rd.status = undefined;
  s.highBid = null;

  return res.json({
    ok: true,
    roundData: rd,
  });
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
      // ignore if compute fails
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
    s.lastSettlementResult = {
      applied: true,
      appliedAt: Date.now(),
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
  const newGame = {
    gameId,
    name: old.name,
    rounds: 5,
    players: old.players.map((p) => ({ ...p })),
    adminKey: newAdminKey,
    roundData: {},
    roundInfo: {},
    perfectCounts: Object.fromEntries(old.players.map((p) => [p.id, 0])),
    payoutLedger: { ...old.payoutLedger }, // carry forward
    highBid: null,
    settlementConfig: { ...old.settlementConfig },
    settlementApplied: false,
    archived: false,
    createdAt: Date.now(),
  };

  // Compute loser (last place) from last settlement
  let startDealerId = newGame.players[0].id;
  const lastRank = old.lastSettlementResult?.ranking;
  if (Array.isArray(lastRank) && lastRank.length === 4) {
    const loser = lastRank[lastRank.length - 1];
    if (loser?.id) startDealerId = loser.id;
  }

  initDealerRotation(newGame, startDealerId);

  old.archived = true;
  sessions[gameId] = newGame;

  res.json({ gameId, adminKey: newAdminKey, roundInfo: newGame.roundInfo });
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
  // Re-init dealer rotation with the first in new order as dealer for round 1
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
  // recompute bidderOrder with dealer last based on current global players order
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

// ============================ Start =============================
const PORT = process.env.PORT || 5001;
app.listen(PORT, () =>
  console.log(`Server running on http://0.0.0.0:${PORT} (LAN-ready)`)
);
