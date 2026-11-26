import { assert } from "./errors.js";

const BALANCE_SCALE = 1_000_000;
const CONFIG_SCALE = 1_000;

export function validAmount(value, minimum = 0) {
  return typeof value === "number" && value >= minimum && value <= 10_000 &&
    Math.round(value * CONFIG_SCALE) / CONFIG_SCALE === value;
}

export function balanceFromUnits(units) {
  return units / BALANCE_SCALE;
}

export function transfer(session, from, to, units) {
  const debit = session.balanceUnits[from] - units;
  const credit = session.balanceUnits[to] + units;
  assert(Number.isSafeInteger(debit) && Number.isSafeInteger(credit), 409, "Balance limit reached.");
  session.balanceUnits[from] = debit;
  session.balanceUnits[to] = credit;
}

export function pushRoundEvent(session, round, event, at) {
  const { dealerId, bidderOrder } = session.roundInfo[round];
  session.roundEvents[round] ??= [];
  session.roundEvents[round].push({ at, round, dealerId, bidderOrder: [...bidderOrder], ...event });
}

function snapshotRound(session, round, at) {
  const { status, bids, actuals, points } = session.roundData[round];
  session.roundHistory[round] = {
    at, round, status, type: status, dealerId: session.roundInfo[round].dealerId,
    bids: { ...bids }, actuals: { ...actuals }, points: { ...points },
  };
}

export function calcPoints(bid, actual) {
  return (actual < bid ? -bid * 10 : bid * 10 + actual - bid) / 10;
}

export function pointTotals(session) {
  const roster = session.mode === "online" ? [...session.players, ...session.inactivePlayers] : session.players;
  const entries = roster.map(({ id }) => {
    let confirmed = 0;
    let pending = 0;
    for (const [round, data] of Object.entries(session.roundData)) {
      if (data.status === "PLAYED" || data.status === "AUTO_AWARDED") {
        confirmed += Math.round((data.points[id] ?? 0) * 10);
      } else if (data.status === "BIDS_SET" && session.highBid?.round !== Number(round)) {
        pending += (data.bids[id] ?? 0) * 10;
      }
    }
    return [id, { confirmed: confirmed / 10, projected: (confirmed + pending) / 10 }];
  });
  return {
    totalsPoints: Object.fromEntries(entries.map(([id, score]) => [id, score.confirmed])),
    projectedPoints: Object.fromEntries(entries.map(([id, score]) => [id, score.projected])),
  };
}

export function perfectCounts(session) {
  return Object.fromEntries([...session.players, ...session.inactivePlayers].map(({ id }) => [
    id,
    Object.values(session.roundData).filter((data) =>
      Object.hasOwn(data.bids, id) && (data.status === "AUTO_AWARDED" ||
        (data.status === "PLAYED" && data.bids[id] === data.actuals[id]))
    ).length,
  ]));
}

export function allRoundsResolved(session) {
  for (let round = 1; round <= session.rounds; round++) {
    const status = session.roundData?.[round]?.status;
    if (status !== "AUTO_AWARDED" && status !== "PLAYED") return false;
  }
  return true;
}

export function initDealerRotation(session, startDealerId, startRound = 1) {
  const playerCount = session.players.length;
  assert(playerCount === 4, 400, "Game requires exactly 4 players.");

  let baseOrder = [...session.players];
  if (startDealerId) {
    const index = baseOrder.findIndex((p) => p.id === startDealerId);
    if (index >= 0)
      baseOrder = [...baseOrder.slice(index), ...baseOrder.slice(0, index)];
  }

  for (let round = startRound; round <= session.rounds; round++) {
    const dealerIndex = (round - startRound) % playerCount;
    const dealer = baseOrder[dealerIndex].id;
    const order = [
      ...baseOrder.slice(dealerIndex + 1),
      ...baseOrder.slice(0, dealerIndex + 1),
    ].map((player) => player.id);
    session.roundInfo[round] = { dealerId: dealer, bidderOrder: order };
  }
}

export function applyAutoAward(session, round, bids, at) {
  const points = Object.fromEntries(Object.entries(bids).map(([id, bid]) => [id, (bid * 10 + 1) / 10]));
  session.roundData[round] = { bids, actuals: {}, points, status: "AUTO_AWARDED" };
  snapshotRound(session, round, at);
  pushRoundEvent(session, round, { type: "AUTO_AWARDED", bids: { ...bids } }, at);
}

export function scorePlayedRound(session, round, at) {
  const data = session.roundData[round];
  data.points = Object.fromEntries(session.players.map(({ id }) => [
    id, calcPoints(data.bids[id], data.actuals[id]),
  ]));
  data.status = "PLAYED";
  snapshotRound(session, round, at);
  pushRoundEvent(session, round, {
    type: "PLAYED",
    bids: { ...data.bids },
    actuals: { ...data.actuals },
  }, at);
}

function settlementRanking(session) {
  const { totalsPoints: totals } = pointTotals(session);
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
      pointsByRound.push(value);
    }

    const isConstant =
      pointsByRound.length === rounds &&
      pointsByRound.every(
        (point) => point === pointsByRound[0]
      );

    const sortedPoints = [...pointsByRound].sort((a, b) => a - b);
    const isSequence =
      rounds === 5 &&
      sortedPoints.every(
        (point, index) => point === index + 1
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

  return playersWithPriority.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.total !== a.total) return b.total - a.total;
    return 0;
  });
}

function firstPlace(ranking) {
  const [winner] = ranking;
  return ranking.filter((player) => player.priority === winner.priority && player.total === winner.total);
}

export function pendingSettlementTie(session) {
  if (session.settlementApplied || session.settlementSkipped || session.highBid || !allRoundsResolved(session)) return [];
  const contenders = firstPlace(settlementRanking(session));
  return contenders.length > 1 ? contenders : [];
}

export function computeFinalSettlement(session, choice = null) {
  let ranking = settlementRanking(session);
  const contenders = firstPlace(ranking);
  const { winnerId, splitTie } = choice ?? {};
  if (choice) {
    const chosen = typeof winnerId === "string" && contenders.some(({ id }) => id === winnerId);
    assert(winnerId === undefined || chosen, 400, "Choose one of the tied players.");
    assert(splitTie === undefined || splitTie === true, 400, "Choose whether to split the tie.");
    assert(!splitTie || !chosen, 400, "Choose a winner or split the tie.");
    assert(contenders.length === 1 ? !chosen && !splitTie : chosen || splitTie, 409,
      contenders.length > 1 ? "Choose a winner or split the tie." : "This game has no first-place tie.");
    if (chosen) ranking = [contenders.find(({ id }) => id === winnerId), ...ranking.filter(({ id }) => id !== winnerId)];
  }

  const [winner] = ranking;
  const winners = splitTie ? contenders : [winner];
  const { weights = [1, 2, 3], stake = 1 } = session.settlementConfig || {};
  const winnerOver20 = winner.total > 20;

  const deltaUnits = Object.fromEntries(session.players.map(({ id }) => [id, 0]));
  const payouts = ranking.slice(winners.length).flatMap((loser, index) => {
    const fixedWeight = Math.round(weights[index + winners.length - 1] * CONFIG_SCALE);
    const fixedStake = Math.round(stake * CONFIG_SCALE);
    const multiplier = (winnerOver20 ? 2 : 1) * (loser.total < 0 ? 2 : 1);
    const amountUnits = fixedWeight * fixedStake * multiplier;
    deltaUnits[loser.id] -= amountUnits;
    const base = Math.floor(amountUnits / winners.length);
    return winners.map(({ id }, winnerIndex) => {
      const share = base + Number(winnerIndex < amountUnits % winners.length);
      deltaUnits[id] += share;
      return {
        fromPlayerId: loser.id,
        toPlayerId: id,
        units: fixedWeight * multiplier / (CONFIG_SCALE * winners.length),
        amount: balanceFromUnits(share),
      };
    });
  });
  const perPlayerDelta = Object.fromEntries(Object.entries(deltaUnits).map(([id, units]) =>
    [id, balanceFromUnits(units)]
  ));

  return {
    totalsPoints: pointTotals(session).totalsPoints,
    ranking,
    weights,
    stake,
    winnerOver20,
    payouts,
    perPlayerDelta,
    perfectCounts: perfectCounts(session),
    ...(choice ? { winnerIds: winners.map(({ id }) => id), tie: contenders.length > 1 ? (splitTie ? "split" : "selected") : null } : {}),
  };
}
