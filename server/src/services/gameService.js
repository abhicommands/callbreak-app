import { assert } from "../utils/errors.js";
import {
  allRoundsResolved,
  applyAutoAward,
  balanceFromUnits,
  computeFinalSettlement,
  initDealerRotation,
  pendingSettlementTie,
  perfectCounts,
  pointTotals,
  pushRoundEvent,
  scorePlayedRound,
  transfer,
  validAmount,
} from "../utils/gameLogic.js";
import { DEFAULT_MINIMUM_BID, validMinimumBid } from "./tableSettings.js";

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const HIGH_BID_MINIMUM = 8;
export const highBidSeatIndices = (bids) => bids.flatMap((bid, index) => bid >= HIGH_BID_MINIMUM ? [index] : []);

export function highBidResult(bid, won, remaining) {
  if (won >= bid) return true;
  if (won + remaining < bid) return false;
  return null;
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
    ...(source.mode === "online" ? { mode: source.mode, minimumBid: source.minimumBid } : {}),
  };
  initDealerRotation(game, dealerId);
  return game;
}

export function createGame(seriesId, input, at) {
  const { name, players, weights, stake = 1, startDealerIndex = 0, autoAwardEnabled = true, mode,
    minimumBid = DEFAULT_MINIMUM_BID } = input;
  assert(Array.isArray(players) && players.length === 4, 400, "Provide exactly 4 players.");
  assert(Array.isArray(weights) && weights.length === 3 && weights.every((weight) => validAmount(weight)),
    400, "Provide 3 non-negative weights, each up to 10000 with up to 3 decimal places.");
  assert(validAmount(stake, 0.001), 400, "Stake must be positive, up to 10000 with up to 3 decimal places.");
  assert(Number.isInteger(startDealerIndex) && startDealerIndex >= 0 && startDealerIndex < 4, 400, "Invalid first dealer.");
  assert(typeof autoAwardEnabled === "boolean", 400, "Invalid auto-award setting.");
  assert(mode === undefined || mode === "online", 400, "Invalid ledger mode.");
  assert(validMinimumBid(minimumBid), 400, "Invalid minimum bid.");

  const roster = players.map((player, index) => ({ id: String(index + 1), name: requireName(player) }));
  return newGame(seriesId, 1, {
    name: requireName(name),
    players: roster,
    inactivePlayers: [],
    settlementConfig: { weights, stake },
    settings: { autoAwardEnabled },
    balanceUnits: Object.fromEntries(roster.map(({ id }) => [id, 0])),
    mode,
    minimumBid,
  }, roster[startDealerIndex].id, at);
}

function onlineRoster(game, players) {
  assert(Array.isArray(players) && players.length === 4 && players.every((player) =>
    isRecord(player) && typeof player.id === "string" && /^[1-9][0-9]{0,8}$/.test(player.id)),
  400, "Provide four online players.");
  const known = new Map([...game.players, ...game.inactivePlayers].map((player) => [player.id, player]));
  const balanceUnits = { ...game.balanceUnits };
  const roster = players.map(({ id, name }) => {
    const cleanName = requireName(name);
    assert(!known.has(id) || known.get(id).name === cleanName, 400, "A saved player cannot be renamed.");
    const player = { id, name: cleanName };
    known.set(id, player);
    balanceUnits[id] ??= 0;
    return player;
  });
  const ids = new Set(roster.map(({ id }) => id));
  assert(ids.size === 4, 400, "Each seat needs a different player ID.");
  return { players: roster, inactivePlayers: [...known.values()].filter(({ id }) => !ids.has(id)), balanceUnits };
}

function prepareOnlineRound(game, round, players, bids) {
  const completed = Object.values(game.roundData).filter(({ status }) => status === "PLAYED").length;
  assert(game.mode === "online" && round === completed + 1,
    409, "Save online rounds in order.");
  validateRound(game, round);
  const roster = onlineRoster(game, players);
  const dealerSeat = game.players.findIndex(({ id }) => id === game.roundInfo[round].dealerId);
  assert(dealerSeat !== -1, 409, "No dealer for this round.");
  if (round > 1 && game.players.some(({ id }, index) => id !== roster.players[index].id)) {
    game.rosterChanged = true;
  }
  Object.assign(game, roster);
  initDealerRotation(game, roster.players[dealerSeat].id, round);

  roundValues(game, bids, 1, "bids");
  const minimum = game.minimumBid ?? DEFAULT_MINIMUM_BID;
  assert(Object.values(bids).reduce((sum, value) => sum + value, 0) >= minimum,
    400, `Bids must total at least ${minimum}.`);
}

function recordOnlineBids(game, { round, players, bids }, at) {
  assert(!game.roundData[round], 409, "Bids are already locked.");
  prepareOnlineRound(game, round, players, bids);
  saveRegularBids(game, round, bids, at);
}

function recordOnlineHighBid(game, { round, bidderId, won, remaining }, at) {
  const data = game.roundData[round];
  const bid = data?.bids[bidderId];
  assert(game.mode === "online" && data?.status === "BIDS_SET" && bid >= HIGH_BID_MINIMUM,
    409, "No active online high bid for this player.");
  assert(Number.isInteger(won) && Number.isInteger(remaining) && won >= 0 && remaining >= 0 && won + remaining <= 13,
    400, "Invalid trick count.");
  const result = highBidResult(bid, won, remaining);
  assert(result !== null && !game.roundEvents[round].some((event) =>
    event.type === "HIGH_BID_RESOLVED" && event.bidderId === bidderId), 409, "High bid is undecided or already scored.");
  applyHighBidOutcome(game, { round, bidderId, bidderWon: result }, at);
}

function recordOnlineRound(game, { round, players, bids, actuals }, at) {
  const locked = game.roundData[round];
  prepareOnlineRound(game, round, players, bids);
  if (locked) {
    assert(locked.status === "BIDS_SET" && game.players.every(({ id }) => locked.bids[id] === bids[id]),
      409, "These bids do not match the locked deal.");
    for (const id of game.players.map(({ id }) => id).filter((id) => bids[id] >= HIGH_BID_MINIMUM)) {
      assert(game.roundEvents[round].some((event) => event.type === "HIGH_BID_RESOLVED" && event.bidderId === id &&
        (event.outcome === "WIN") === (actuals?.[id] >= bids[id])), 409, "Finish scoring the high bids first.");
    }
  } else {
    // Earlier backups saved only completed deals.
    game.roundData[round] = { bids, actuals: {}, points: {}, status: "BIDS_SET" };
  }
  saveActuals(game, round, actuals, at);
  if (round === game.rounds) {
    if (game.rosterChanged) {
      game.settlementSkipped = true;
      game.resolvedAt = at;
    } else if (!locked || !pendingSettlementTie(game).length) {
      settle(game, at, locked ? {} : null);
    }
  }
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
  const bidderIds = game.players.filter(({ id }) => bids[id] >= HIGH_BID_MINIMUM).map(({ id }) => id);

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
    saveRegularBids(game, round, bids, at);
  }
}

function saveRegularBids(game, round, bids, at) {
  game.roundData[round] = { bids, actuals: {}, points: {}, status: "BIDS_SET" };
  delete game.roundHistory[round];
  pushRoundEvent(game, round, { type: "BIDS_SET", bids }, at);
}

function setActuals(game, { round, actuals }, at) {
  validateRound(game, round);
  const data = game.roundData[round];
  assert(game.highBid?.round !== round && (data?.status === "BIDS_SET" || data?.status === "PLAYED") &&
    game.players.every(({ id }) => Number.isInteger(data.bids[id]) && data.bids[id] >= 1 && data.bids[id] < HIGH_BID_MINIMUM),
  409, "Save four regular bids before saving actuals.");
  saveActuals(game, round, actuals, at);
}

function saveActuals(game, round, actuals, at) {
  const data = game.roundData[round];
  roundValues(game, actuals, 0, "actuals");
  assert(Object.values(actuals).reduce((sum, value) => sum + value, 0) === 13, 400, "Actuals must sum to 13.");
  if (data.status === "PLAYED" && game.players.every(({ id }) => data.actuals[id] === actuals[id])) return;
  data.actuals = actuals;
  scorePlayedRound(game, round, at);
}

function closeHighBid(game, payload, at, canceled) {
  const { round, bidderId } = payload;
  validateRound(game, round);
  assert(game.highBid?.round === round, 409, "No pending side game in this round.");
  if (canceled) {
    pushRoundEvent(game, round, { type: "HIGH_BID_CANCELED" }, at);
  } else {
    assert(game.highBid.bidderIds.includes(bidderId), 400, "Select a player who bid 8 or more.");
    applyHighBidOutcome(game, payload, at);
  }
  game.highBid = null;
}

function highBidTransfers({ bidderId, stake, outcome, opponentIds }) {
  return opponentIds.map((opponent) => outcome === "WIN" ? [opponent, bidderId, stake] : [bidderId, opponent, stake]);
}

function applyHighBidOutcome(game, { round, bidderId, bidderWon, stake = game.settlementConfig.stake }, at) {
  assert(typeof bidderWon === "boolean", 400, "Choose whether the bidder won.");
  assert(validAmount(stake, 0.001), 400, "Stake must be positive, up to 10000 with up to 3 decimal places.");
  const event = { type: "HIGH_BID_RESOLVED", bidderId, stake, outcome: bidderWon ? "WIN" : "LOSS",
    opponentIds: game.players.filter(({ id }) => id !== bidderId).map(({ id }) => id) };
  for (const [from, to, amount] of highBidTransfers(event)) transfer(game, from, to, Math.round(amount * 1_000_000));
  pushRoundEvent(game, round, event, at);
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
  return game.mode !== "online" && !game.highBid && !Object.values(game.roundEvents).some((events) =>
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

function settle(game, at, choice = null) {
  if (game.settlementApplied) return;
  assert(!game.highBid && allRoundsResolved(game), 409, "Complete all five rounds before settling.");
  assert(!game.settlementSkipped, 409, "Payouts are unavailable for this game.");
  const result = computeFinalSettlement(game, choice);
  for (const payout of result.payouts) {
    transfer(game, payout.fromPlayerId, payout.toPlayerId, Math.round(payout.amount * 1_000_000));
  }
  game.settlementApplied = true;
  game.resolvedAt = at;
  game.lastSettlementResult = { applied: true, appliedAt: at, ...result };
}

const actions = {
  "record-online-bids": recordOnlineBids,
  "record-online-highbid": recordOnlineHighBid,
  "abandon-online-round"(game, { round }, at) {
    assert(game.mode === "online" && game.roundData[round]?.status === "BIDS_SET", 409, "No active online deal.");
    delete game.roundData[round];
    pushRoundEvent(game, round, { type: "ABANDONED" }, at);
  },
  "record-online-round": recordOnlineRound,
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
  "settle-game": (game, choice, at) => settle(game, at, choice),
};

export function applyCommand(game, action, payload, at) {
  assert(isRecord(payload), 400, "Provide a command payload.");
  if (game.mode === "online") {
    if (action === "next-online-game") {
      assert(game.settlementApplied || game.settlementSkipped, 409, "Finish all five deals first.");
      const { players, startDealerIndex } = payload;
      assert(Number.isInteger(startDealerIndex) && startDealerIndex >= 0 && startDealerIndex < 4,
        400, "Invalid first dealer.");
      const roster = onlineRoster(game, players);
      return newGame(game.seriesId, game.gameIndex + 1, { ...game, ...roster },
        roster.players[startDealerIndex].id, at);
    }
    assert(["record-online-round", "record-online-bids", "record-online-highbid", "abandon-online-round", "settle-game"].includes(action),
      409, "This ledger is updated by the online table.");
  }
  if (action === "next-game") {
    assert(game.settlementApplied, 409, "Settle the game before starting the next one.");
    const dealer = game.lastSettlementResult.ranking.at(-1);
    return newGame(game.seriesId, game.gameIndex + 1, game, dealer.id, at);
  }
  assert(Object.hasOwn(actions, action), 400, "Unknown ledger command.");
  assert(!game.settlementApplied || ["resolve-game", "settle-game"].includes(action), 409, "The game has already been settled.");
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
  const highBids = Object.values(game.roundEvents).flat().filter(({ type }) => type === "HIGH_BID_RESOLVED");
  const gameUnits = Object.fromEntries(payoutEntries.map(([id]) => [id, 0]));
  const fromSettlement = (game.lastSettlementResult?.payouts ?? [])
    .map(({ fromPlayerId, toPlayerId, amount }) => [fromPlayerId, toPlayerId, amount]);
  for (const [from, to, amount] of [...highBids.flatMap(highBidTransfers), ...fromSettlement]) {
    const units = Math.round(amount * 1_000_000);
    gameUnits[from] -= units;
    gameUnits[to] += units;
  }
  return {
    players: game.players,
    inactivePlayers: game.inactivePlayers,
    settings: game.settings,
    payouts: Object.fromEntries(payoutEntries),
    gamePayouts: Object.fromEntries(Object.entries(gameUnits).map(([id, units]) => [id, balanceFromUnits(units)])),
    highBids,
    scoredPlayerIds: [...new Set(Object.values(game.roundData).flatMap(({ bids }) => Object.keys(bids)))],
    pendingTie: pendingSettlementTie(game),
    settlementApplied: game.settlementApplied,
    settlement: game.lastSettlementResult,
    perfectCounts: perfectCounts(game),
    ...pointTotals(game),
  };
}

export function historyFor(game) {
  assert(game.settlementApplied || game.settlementSkipped, 404, "Settled game not found.");
  const { gameId, name, players, roundHistory, roundEvents, resolvedAt, lastSettlementResult } = game;
  const benchNames = Object.fromEntries(game.inactivePlayers.map(({ id, name }) => [id, name]));
  return { gameId, name, players, benchNames, roundHistory, roundEvents, resolvedAt, settlement: lastSettlementResult,
    ...(game.mode === "online" ? { ledger: { game: publicGame(game), summary: getSummary(game) } } : {}) };
}
