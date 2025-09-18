import { assert } from "./errors.js";

export function ensurePayoutLedger(session) {
  if (!session.payoutLedger) session.payoutLedger = {};
  const roster = [...(session.players || []), ...(session.inactivePlayers || [])];
  for (const player of roster) {
    if (!(player?.id in session.payoutLedger)) session.payoutLedger[player.id] = 0;
  }
}

export function ensurePerfectCounts(session) {
  if (!session.perfectCounts) session.perfectCounts = {};
  const roster = [...(session.players || []), ...(session.inactivePlayers || [])];
  for (const player of roster) {
    if (!(player?.id in session.perfectCounts)) session.perfectCounts[player.id] = 0;
  }
}

export function ensureHistoryStructs(session) {
  if (!session.roundHistory) session.roundHistory = {};
  if (!session.roundEvents) session.roundEvents = {};
}

export function pushRoundEvent(session, round, event) {
  ensureHistoryStructs(session);
  if (!session.roundEvents[round]) session.roundEvents[round] = [];
  session.roundEvents[round].push({ at: Date.now(), round, ...event });
}

export function snapshotRound(session, round, snapshot, { force = false } = {}) {
  ensureHistoryStructs(session);
  if (!session.roundHistory[round] || force) {
    session.roundHistory[round] = { at: Date.now(), round, ...snapshot };
  }
}

export function calcPoints(bid, actual) {
  if (typeof bid !== "number" || typeof actual !== "number") return 0;
  if (actual < bid) return -bid;
  const extra = actual - bid;
  return Number((bid + extra / 10).toFixed(1));
}

export function totalsPoints(session) {
  const totals = {};
  for (const player of session.players) totals[player.id] = 0;
  for (const round of Object.keys(session.roundData || {})) {
    const pts = session.roundData[round]?.points || {};
    for (const [playerId, val] of Object.entries(pts)) {
      const value = Number(val);
      if (!Number.isNaN(value)) totals[playerId] += value;
    }
  }
  return totals;
}

export function allRoundsResolved(session) {
  for (let round = 1; round <= session.rounds; round++) {
    const status = session.roundData?.[round]?.status;
    if (status !== "AUTO_AWARDED" && status !== "PLAYED") return false;
  }
  return true;
}

export function initDealerRotation(session, startDealerId = null) {
  session.roundInfo = {};
  const playerCount = session.players.length;
  assert(playerCount === 4, 400, "Game requires exactly 4 players.");

  let baseOrder = [...session.players];
  if (startDealerId) {
    const index = baseOrder.findIndex((p) => p.id === startDealerId);
    if (index >= 0)
      baseOrder = [...baseOrder.slice(index), ...baseOrder.slice(0, index)];
  }

  for (let round = 1; round <= session.rounds; round++) {
    const dealerIndex = (round - 1) % playerCount;
    const dealer = baseOrder[dealerIndex].id;
    const order = [
      ...baseOrder.slice(dealerIndex + 1),
      ...baseOrder.slice(0, dealerIndex + 1),
    ].map((player) => player.id);
    session.roundInfo[round] = { dealerId: dealer, bidderOrder: order };
  }
}

export function applyAutoAward(session, round, bidsByPlayer) {
  ensurePerfectCounts(session);
  const roundData = (session.roundData[round] = session.roundData[round] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });

  roundData.bids = {};
  roundData.actuals = {};
  roundData.points = {};

  for (const player of session.players) {
    const bidValue = Number(bidsByPlayer[player.id] || 0);
    roundData.bids[player.id] = bidValue;
    const points = Number((bidValue + 0.1).toFixed(1));
    roundData.points[player.id] = points;
    session.perfectCounts[player.id] = (session.perfectCounts[player.id] || 0) + 1;
  }

  roundData.status = "AUTO_AWARDED";
  delete roundData.locked;

  snapshotRound(session, round, {
    type: "AUTO_AWARDED",
    bids: { ...roundData.bids },
    actuals: {},
    points: { ...roundData.points },
    status: roundData.status,
  }, { force: true });

  pushRoundEvent(session, round, { type: "AUTO_AWARDED", bids: { ...roundData.bids } });
}

export function scorePlayedRound(session, round) {
  ensurePerfectCounts(session);
  const roundData = session.roundData[round];
  roundData.points = {};

  for (const player of session.players) {
    const bidValue = Number(roundData.bids[player.id] ?? 0);
    const actualValue = Number(roundData.actuals[player.id] ?? 0);
    const points = calcPoints(bidValue, actualValue);
    roundData.points[player.id] = points;
    if (actualValue === bidValue) {
      session.perfectCounts[player.id] = (session.perfectCounts[player.id] || 0) + 1;
    }
  }

  roundData.status = "PLAYED";
  delete roundData.locked;

  snapshotRound(session, round, {
    type: "PLAYED",
    bids: { ...roundData.bids },
    actuals: { ...roundData.actuals },
    points: { ...roundData.points },
    status: roundData.status,
  }, { force: true });

  pushRoundEvent(session, round, {
    type: "PLAYED",
    bids: { ...roundData.bids },
    actuals: { ...roundData.actuals },
  });
}

export function computeFinalSettlement(session) {
  const totals = totalsPoints(session);
  const rounds = session.rounds || 5;

  const playersWithPriority = session.players.map((player) => {
    const pointsByRound = [];
    for (let round = 1; round <= rounds; round++) {
      const value = session.roundData?.[round]?.points?.[player.id];
      if (value == null) {
        return {
          id: player.id,
          name: player.name,
          total: Number(totals[player.id] || 0),
          priority: 0,
          pointsByRound: [],
          active: true,
        };
      }
      pointsByRound.push(Number(Number(value).toFixed(1)));
    }

    const isConstant =
      pointsByRound.length === rounds &&
      pointsByRound.every(
        (point) => Math.abs(point - pointsByRound[0]) < 1e-6
      );

    const sortedPoints = [...pointsByRound].sort((a, b) => a - b);
    const isSequence =
      rounds === 5 &&
      sortedPoints.every(
        (point, index) => Math.abs(point - (index + 1)) < 1e-6
      );

    const priority = isSequence ? 2 : isConstant ? 1 : 0;

    return {
      id: player.id,
      name: player.name,
      total: Number(totals[player.id] || 0),
      priority,
      pointsByRound,
      active: true,
    };
  });

  assert(playersWithPriority.length === 4, 400, "Invalid players");

  const ranking = [...playersWithPriority].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.total !== a.total) return b.total - a.total;
    return 0;
  });

  ensurePerfectCounts(session);

  const [winner, second, third, fourth] = ranking;
  const { weights = [1, 2, 3], stake = 1 } = session.settlementConfig || {};
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
  for (const player of session.players) perPlayerDelta[player.id] = 0;
  for (const payout of payouts) {
    perPlayerDelta[payout.fromPlayerId] -= payout.amount;
    perPlayerDelta[payout.toPlayerId] += payout.amount;
  }

  return {
    totalsPoints: totals,
    ranking,
    weights,
    stake,
    winnerOver20,
    payouts,
    perPlayerDelta,
    perfectCounts: { ...(session.perfectCounts || {}) },
  };
}
