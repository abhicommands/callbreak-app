import { assert } from "../utils/errors.js";
import {
  allRoundsResolved,
  applyAutoAward,
  balanceFromUnits,
  computeFinalSettlement,
  initDealerRotation,
  perfectCounts,
  pointTotals,
  pushRoundEvent,
  scorePlayedRound,
  transfer,
  validAmount,
} from "../utils/gameLogic.js";

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireName(value) {
  assert(typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80,
    400, "Names must be between 1 and 80 characters.");
  return value.trim();
}

function newGame(seriesId, gameIndex, source, dealerId, at) {
  const game = {
    seriesId,
    gameIndex,
    gameId: String(gameIndex),
    name: source.name,
    rounds: 5,
    createdAt: at,
    players: source.players.map((player) => ({ ...player })),
    inactivePlayers: source.inactivePlayers.map((player) => ({ ...player })),
    settlementConfig: { ...source.settlementConfig },
    settings: { ...source.settings },
    balanceUnits: { ...source.balanceUnits },
    roundInfo: {},
    roundData: {},
    roundHistory: {},
    roundEvents: {},
    highBid: null,
    settlementApplied: false,
  };
  initDealerRotation(game, dealerId);
  return game;
}

export function createGame(seriesId, input, at) {
  const { name, players, weights, stake = 1, startDealerIndex = 0, autoAwardEnabled = true } = input;
  assert(Array.isArray(players) && players.length === 4, 400, "Provide exactly 4 players.");
  assert(Array.isArray(weights) && weights.length === 3 && weights.every((weight) => validAmount(weight)),
    400, "Provide 3 non-negative weights, each up to 10000 with up to 3 decimal places.");
  assert(validAmount(stake, 0.001), 400, "Stake must be positive, up to 10000 with up to 3 decimal places.");
  assert(Number.isInteger(startDealerIndex) && startDealerIndex >= 0 && startDealerIndex < 4, 400, "Invalid first dealer.");
  assert(typeof autoAwardEnabled === "boolean", 400, "Invalid auto-award setting.");

  const roster = players.map((player, index) => ({ id: String(index + 1), name: requireName(player) }));
  return newGame(seriesId, 1, {
    name: requireName(name),
    players: roster,
    inactivePlayers: [],
    settlementConfig: { weights, stake },
    settings: { autoAwardEnabled },
    balanceUnits: Object.fromEntries(roster.map(({ id }) => [id, 0])),
  }, roster[startDealerIndex].id, at);
}

function validateRound(game, round) {
  assert(Number.isInteger(round) && round >= 1 && round <= game.rounds, 400, "Invalid round.");
}

function roundValues(game, values, min, label) {
  assert(isRecord(values) && Object.keys(values).length === game.players.length &&
    game.players.every(({ id }) => Object.hasOwn(values, id)), 400, `Provide ${label} for all four players.`);
  assert(Object.values(values).every((value) => Number.isInteger(value) && value >= min && value <= 13),
    400, `Each value must be an integer between ${min} and 13.`);
}

function setBids(game, { round, bids }, at) {
  validateRound(game, round);
  roundValues(game, bids, 1, "bids");
  assert(!game.highBid, 409, "Resolve or cancel the pending side game before saving bids.");
  const bidderIds = game.players.filter(({ id }) => bids[id] >= 8).map(({ id }) => id);

  // A saved 8+ call replaces the regular entry and opens a side game.
  if (bidderIds.length) {
    delete game.roundData[round];
    delete game.roundHistory[round];
    game.highBid = { active: true, round, bidderIds };
    pushRoundEvent(game, round, { type: "HIGH_BID_TRIGGERED", bids, bidderIds }, at);
  } else if (game.settings.autoAwardEnabled && round < game.rounds &&
    Object.values(bids).reduce((sum, value) => sum + value, 0) < 10) {
    applyAutoAward(game, round, bids, at);
  } else {
    game.roundData[round] = { bids, actuals: {}, points: {}, status: "BIDS_SET" };
    delete game.roundHistory[round];
    pushRoundEvent(game, round, { type: "BIDS_SET", bids }, at);
  }
}

function setActuals(game, { round, actuals }, at) {
  validateRound(game, round);
  const data = game.roundData[round];
  assert(game.highBid?.round !== round && (data?.status === "BIDS_SET" || data?.status === "PLAYED") &&
    game.players.every(({ id }) => Number.isInteger(data.bids[id]) && data.bids[id] >= 1 && data.bids[id] < 8),
  409, "Save four regular bids before saving actuals.");
  roundValues(game, actuals, 0, "actuals");
  assert(Object.values(actuals).reduce((sum, value) => sum + value, 0) === 13, 400, "Actuals must sum to 13.");
  if (data.status === "PLAYED" && game.players.every(({ id }) => data.actuals[id] === actuals[id])) return;
  data.actuals = actuals;
  scorePlayedRound(game, round, at);
}

function closeHighBid(game, payload, at, canceled) {
  const { round, bidderId, bidderWon, stake = game.settlementConfig.stake } = payload;
  validateRound(game, round);
  assert(game.highBid?.round === round, 409, "No pending side game in this round.");
  if (canceled) {
    pushRoundEvent(game, round, { type: "HIGH_BID_CANCELED" }, at);
  } else {
    assert(game.highBid.bidderIds.includes(bidderId), 400, "Select a player who bid 8 or more.");
    assert(typeof bidderWon === "boolean", 400, "Choose whether the bidder won.");
    assert(validAmount(stake, 0.001), 400, "Stake must be positive, up to 10000 with up to 3 decimal places.");
    const opponentIds = game.players.filter(({ id }) => id !== bidderId).map(({ id }) => id);
    const units = Math.round(stake * 1_000_000);
    for (const opponent of opponentIds) {
      if (bidderWon) transfer(game, opponent, bidderId, units);
      else transfer(game, bidderId, opponent, units);
    }
    pushRoundEvent(game, round, {
      type: "HIGH_BID_RESOLVED", bidderId, stake, outcome: bidderWon ? "WIN" : "LOSS", opponentIds,
    }, at);
  }
  game.highBid = null;
}

function reorderPlayers(game, { newOrder, startDealerId }) {
  const roster = new Map(game.players.map((player) => [player.id, player]));
  assert(Array.isArray(newOrder) && newOrder.length === roster.size &&
    new Set(newOrder).size === roster.size && newOrder.every((id) => roster.has(id)),
  400, "Provide all four player IDs in seating order.");
  assert(roster.has(startDealerId), 400, "Choose a dealer from the roster.");

  game.players = newOrder.map((id) => roster.get(id));
  // Freeze the rotation through the latest round anyone has recorded.
  const firstOpen = Math.max(0, ...Object.keys(game.roundEvents).map(Number)) + 1;
  initDealerRotation(game, startDealerId, firstOpen);
}

function canSubstitute(game) {
  return !game.highBid && !Object.values(game.roundEvents).some((events) =>
    events.some(({ type }) => ["BIDS_SET", "PLAYED", "AUTO_AWARDED"].includes(type))
  );
}

function substitutePlayer(game, { outgoingPlayerId, incomingPlayerId, incomingName }) {
  assert(canSubstitute(game), 409,
    "Substitutions are available before play, with no pending side game.");
  const index = game.players.findIndex(({ id }) => id === outgoingPlayerId);
  assert(index !== -1, 400, "Outgoing player is not seated.");
  assert((incomingPlayerId === undefined) !== (incomingName === undefined), 400,
    "Select a bench player or enter a new name.");
  let incoming;
  if (incomingPlayerId !== undefined) {
    const benchIndex = game.inactivePlayers.findIndex(({ id }) => id === incomingPlayerId);
    assert(benchIndex !== -1, 400, "Incoming player is not on the bench.");
    [incoming] = game.inactivePlayers.splice(benchIndex, 1);
  } else {
    const name = requireName(incomingName);
    const id = String(game.players.length + game.inactivePlayers.length + 1);
    incoming = { id, name };
    game.balanceUnits[id] = 0;
  }

  game.inactivePlayers.push(game.players[index]);
  game.players[index] = incoming;
  const dealerId = game.roundInfo[1].dealerId;
  initDealerRotation(game, dealerId === outgoingPlayerId ? incoming.id : dealerId);
}

function settle(game, at) {
  if (game.settlementApplied) return;
  assert(!game.highBid && allRoundsResolved(game), 409, "Complete all five rounds before settling.");
  const result = computeFinalSettlement(game);
  for (const payout of result.payouts) {
    transfer(game, payout.fromPlayerId, payout.toPlayerId, Math.round(payout.amount * 1_000_000));
  }
  game.settlementApplied = true;
  game.resolvedAt = at;
  game.lastSettlementResult = { applied: true, appliedAt: at, ...result };
}

const actions = {
  "set-bids": setBids,
  "set-actuals": setActuals,
  "cancel-highbid": (game, payload, at) => closeHighBid(game, payload, at, true),
  "resolve-highbid": (game, payload, at) => closeHighBid(game, payload, at, false),
  "reorder-players": reorderPlayers,
  substitute: substitutePlayer,
  settings(game, { autoAwardEnabled }) {
    assert(typeof autoAwardEnabled === "boolean", 400, "Invalid auto-award setting.");
    game.settings.autoAwardEnabled = autoAwardEnabled;
  },
  "resolve-game": (game, _, at) => settle(game, at),
};

export function applyCommand(game, action, payload, at) {
  assert(isRecord(payload), 400, "Provide a command payload.");
  if (action === "next-game") {
    assert(game.settlementApplied, 409, "Settle the game before starting the next one.");
    const dealer = game.lastSettlementResult.ranking.at(-1);
    return newGame(game.seriesId, game.gameIndex + 1, game, dealer.id, at);
  }
  assert(Object.hasOwn(actions, action), 400, "Unknown ledger command.");
  assert(!game.settlementApplied || action === "resolve-game", 409, "The game has already been settled.");
  actions[action](game, payload, at);
  return game;
}

export function publicGame(game) {
  const { balanceUnits: _, roundEvents, roundHistory: _history, highBid, ...view } = game;
  const pending = highBid && { ...highBid, attempt: roundEvents[highBid.round].length };
  return {
    ...view,
    highBid: pending,
    recordedRounds: Object.keys(roundEvents).map(Number),
    canSubstitute: canSubstitute(game),
  };
}

export function getSummary(game) {
  const payoutEntries = Object.entries(game.balanceUnits).map(([id, units]) => [id, balanceFromUnits(units)]);
  return {
    players: game.players,
    inactivePlayers: game.inactivePlayers,
    settings: game.settings,
    payouts: Object.fromEntries(payoutEntries),
    settlementApplied: game.settlementApplied,
    settlement: game.lastSettlementResult,
    perfectCounts: perfectCounts(game),
    ...pointTotals(game),
  };
}

export function historyFor(game) {
  assert(game.settlementApplied, 404, "Settled game not found.");
  const { gameId, name, players, roundHistory, roundEvents, resolvedAt, lastSettlementResult } = game;
  const benchNames = Object.fromEntries(game.inactivePlayers.map(({ id, name }) => [id, name]));
  return { gameId, name, players, benchNames, roundHistory, roundEvents, resolvedAt, settlement: lastSettlementResult };
}
