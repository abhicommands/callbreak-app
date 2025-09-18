import {
  getSession,
  setSession,
  listSessions,
  generateGameId,
  generatePlayerId,
  generateSeriesId,
} from "../store/sessionStore.js";
import { HttpError, assert } from "../utils/errors.js";
import {
  ensurePayoutLedger,
  ensurePerfectCounts,
  ensureHistoryStructs,
  pushRoundEvent,
  snapshotRound,
  totalsPoints,
  allRoundsResolved,
  initDealerRotation,
  applyAutoAward,
  scorePlayedRound,
  computeFinalSettlement,
} from "../utils/gameLogic.js";

const sessionRedirects = new Map();

function requireSession(gameId, { allowArchived = false } = {}) {
  const session = getSession(gameId);
  if (!session) throw new HttpError(404, "Game not found");
  if (session.archived && !allowArchived) throw new HttpError(404, "Game not found");
  return session;
}

function ensureSettings(session) {
  if (!session.settings) session.settings = {};
  if (typeof session.settings.autoAwardEnabled !== "boolean") {
    session.settings.autoAwardEnabled = true;
  }
}

function ensureInactivePlayers(session) {
  if (!session.inactivePlayers) session.inactivePlayers = [];
}

function noRoundsStarted(session) {
  for (let round = 1; round <= session.rounds; round++) {
    const status = session.roundData?.[round]?.status;
    if (status != null) return false;
  }
  return true;
}

export function setGameRedirect(fromGameId, toGameId) {
  if (fromGameId && toGameId) sessionRedirects.set(fromGameId, toGameId);
}

export function getGameRedirect(gameId) {
  return sessionRedirects.get(gameId) || null;
}

export function listSeriesGames(seriesId) {
  return listSessions()
    .filter((session) => (session.seriesId || session.gameId) === seriesId)
    .map((session) => ({
      seriesId: session.seriesId,
      gameId: session.gameId,
      gameIndex: session.gameIndex || 1,
      name: session.name,
      createdAt: session.createdAt,
      resolvedAt: session.resolvedAt || null,
      archived: !!session.archived,
      settlementApplied: !!session.settlementApplied,
    }))
    .sort((a, b) => a.gameIndex - b.gameIndex);
}

export function createGame(body = {}) {
  const {
    name,
    players = [],
    weights,
    stake = 1,
    startDealerId = null,
    startDealerName = null,
    startDealerIndex = null,
    seriesId = null,
    autoAwardEnabled = true,
  } = body;

  assert(name && Array.isArray(players) && players.length === 4, 400, "Provide game name and exactly 4 players.");

  assert(
    Array.isArray(weights) &&
      weights.length === 3 &&
      weights.every((x) => Number.isFinite(Number(x)) && Number(x) >= 0),
    400,
    "weights must be [w2,w3,w4] non-negative numbers (e.g., [1,2,3])."
  );

  const stakeNum = Number(stake);
  assert(Number.isFinite(stakeNum) && stakeNum > 0, 400, "stake must be a positive number");

  const newSeriesId = seriesId || generateSeriesId(10);
  const maxIndex = listSeriesGames(newSeriesId).reduce(
    (max, game) => Math.max(max, game.gameIndex || 0),
    0
  );
  const gameIndex = maxIndex + 1;

  const gameId = generateGameId(8);
  const adminKey = generateGameId(12);
  const normalizedPlayers = players.map((playerName) => ({
    id: generatePlayerId(),
    name: String(playerName).trim(),
  }));

  const session = {
    seriesId: newSeriesId,
    gameIndex,
    gameId,
    name: String(name).trim(),
    rounds: 5,
    createdAt: Date.now(),
    archived: false,
    players: normalizedPlayers,
    adminKey,
    settlementConfig: {
      weights: weights.map(Number),
      stake: stakeNum,
      locked: true,
    },
    settings: {
      autoAwardEnabled: Boolean(autoAwardEnabled),
    },
    inactivePlayers: [],
    roundInfo: {},
    roundData: {},
    perfectCounts: Object.fromEntries(normalizedPlayers.map((p) => [p.id, 0])),
    payoutLedger: Object.fromEntries(normalizedPlayers.map((p) => [p.id, 0])),
    highBid: null,
    settlementApplied: false,
    lastSettlementResult: undefined,
    roundHistory: {},
    roundEvents: {},
  };

  let resolvedDealerId = null;
  if (startDealerId && normalizedPlayers.some((p) => p.id === startDealerId)) {
    resolvedDealerId = startDealerId;
  } else if (typeof startDealerName === "string" && startDealerName.trim()) {
    const target = normalizedPlayers.find(
      (p) => p.name.toLowerCase() === startDealerName.trim().toLowerCase()
    );
    if (target) resolvedDealerId = target.id;
  } else if (Number.isInteger(Number(startDealerIndex))) {
    const idx = Number(startDealerIndex);
    if (idx >= 0 && idx < normalizedPlayers.length) resolvedDealerId = normalizedPlayers[idx].id;
  }

  initDealerRotation(session, resolvedDealerId || normalizedPlayers[0].id);

  setSession(session);

  return {
    seriesId: session.seriesId,
    gameIndex: session.gameIndex,
    gameId,
    adminKey,
    players: normalizedPlayers,
    settlementConfig: session.settlementConfig,
    roundInfo: session.roundInfo,
    startDealerId: resolvedDealerId || normalizedPlayers[0].id,
    settings: session.settings,
  };
}

export function getPublicGame(gameId) {
  const session = requireSession(gameId);
  ensureSettings(session);
  ensureInactivePlayers(session);
  const { adminKey, ...publicSession } = session;
  return { ...publicSession, gameId };
}

export function getSummary(gameId) {
  const session = requireSession(gameId);
  ensureSettings(session);
  ensureInactivePlayers(session);
  ensurePayoutLedger(session);
  ensurePerfectCounts(session);

  const response = {
    seriesId: session.seriesId,
    gameIndex: session.gameIndex,
    gameId: session.gameId,
    name: session.name,
    players: session.players,
    payouts: { ...session.payoutLedger },
    settlementApplied: !!session.settlementApplied,
    totalsPoints: totalsPoints(session),
    roundInfo: session.roundInfo,
    perfectCounts: session.perfectCounts,
    settings: session.settings,
    inactivePlayers: session.inactivePlayers,
  };

  if (session.settlementApplied && session.lastSettlementResult) {
    response.settlement = session.lastSettlementResult;
  } else if (allRoundsResolved(session)) {
    try {
      response.settlement = { applied: false, ...computeFinalSettlement(session) };
    } catch {
      // ignore compute errors until valid
    }
  }

  return response;
}

function assertAdmin(session, adminKey) {
  if (adminKey !== session.adminKey) throw new HttpError(403, "Unauthorized");
}

export function setBids(gameId, adminKey, round, bids) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);
  if (session.settlementApplied) {
    throw new HttpError(400, "Game already settled; editing disabled.");
  }
  if (session.settlementApplied) {
    throw new HttpError(400, "Game already settled; editing disabled.");
  }

  const roundNumber = Number(round);
  assert(Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= session.rounds, 400, "Invalid round");
  assert(bids && typeof bids === "object", 400, "bids is required");

  const validIds = new Set(session.players.map((p) => p.id));
  const incomingIds = Object.keys(bids);
  assert(
    incomingIds.length === session.players.length && incomingIds.every((id) => validIds.has(id)),
    400,
    "Provide bids for all 4 valid players."
  );

  const normalized = {};
  let anyHigh = false;
  let sum = 0;

  for (const id of incomingIds) {
    const value = Number(bids[id]);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new HttpError(400, "Each bid must be an integer");
    }
    if (value < 1) throw new HttpError(400, "Each bid must be >= 1");
    if (value > 13) throw new HttpError(400, "Bid must be <= 13");
    if (value >= 8) anyHigh = true;
    normalized[id] = value;
    sum += value;
  }

  if (anyHigh) {
    const bidderIds = incomingIds.filter((id) => normalized[id] >= 8);
    session.highBid = { active: true, round: roundNumber, bidderIds };
    pushRoundEvent(session, roundNumber, {
      type: "HIGH_BID_TRIGGERED",
      bidderIds: [...bidderIds],
    });
    throw new HttpError(409, "High bid triggered", {
      highBidTriggered: true,
      bidderIds,
      round: roundNumber,
      message:
        "At least one bid is ≥ 8. Resolve the side game, or edit bids to be < 8.",
    });
  }

  if (session.settings.autoAwardEnabled && sum < 10 && roundNumber !== 5) {
    applyAutoAward(session, roundNumber, normalized);
    if (session.highBid?.active && session.highBid.round === roundNumber) session.highBid = null;
    return { autoAwarded: true, roundData: session.roundData[roundNumber] };
  }

  const roundData = (session.roundData[roundNumber] = session.roundData[roundNumber] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  roundData.bids = normalized;
  roundData.actuals = {};
  roundData.points = {};
  roundData.status = "BIDS_SET";
  pushRoundEvent(session, roundNumber, { type: "BIDS_SET", bids: { ...roundData.bids } });

  if (session.highBid?.active && session.highBid.round === roundNumber) session.highBid = null;
  return { autoAwarded: false, roundData };
}

export function resolveHighBid(
  gameId,
  adminKey,
  { round, bidderId, winnerId = null, stake, bidderWon } = {}
) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);

  const roundNumber = Number(round);
  assert(Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= session.rounds, 400, "Invalid round");

  if (!session.highBid?.active || session.highBid.round !== roundNumber) {
    throw new HttpError(400, "No active high bid for this round");
  }

  const ids = new Set(session.players.map((p) => p.id));
  if (!ids.has(bidderId)) throw new HttpError(400, "Invalid bidderId");
  if (!session.highBid.bidderIds.includes(bidderId)) {
    throw new HttpError(400, "Bidder is not part of the high bid");
  }

  ensurePayoutLedger(session);
  const stakeValue = Number(stake || session.settlementConfig?.stake || 1);
  assert(Number.isFinite(stakeValue) && stakeValue > 0, 400, "Invalid stake value");

  const opponents = session.players.filter((player) => player.id !== bidderId);
  const opponentIds = opponents.map((player) => player.id);
  const bidderWins = bidderWon ?? winnerId === bidderId;

  if (bidderWins) {
    const payout = stakeValue * opponents.length;
    for (const player of session.players) {
      if (player.id === bidderId) session.payoutLedger[player.id] += payout;
      else session.payoutLedger[player.id] -= stakeValue;
    }
    pushRoundEvent(session, roundNumber, {
      type: "HIGH_BID_RESOLVED",
      bidderId,
      stake: stakeValue,
      outcome: "WIN",
      opponentIds,
    });
  } else {
    const payout = stakeValue * opponents.length;
    for (const player of session.players) {
      if (player.id === bidderId) session.payoutLedger[player.id] -= payout;
      else session.payoutLedger[player.id] += stakeValue;
    }
    pushRoundEvent(session, roundNumber, {
      type: "HIGH_BID_RESOLVED",
      bidderId,
      stake: stakeValue,
      outcome: "LOSS",
      opponentIds,
    });
  }

  session.highBid = null;
  return { ok: true, payoutLedger: session.payoutLedger };
}

export function cancelHighBid(gameId, adminKey, round) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);
  if (session.settlementApplied) {
    throw new HttpError(400, "Game already settled; editing disabled.");
  }

  const roundNumber = Number(round);
  assert(Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= session.rounds, 400, "Invalid round");

  if (!session.highBid?.active || session.highBid.round !== roundNumber) {
    throw new HttpError(400, "No active high bid for this round");
  }

  const roundData = (session.roundData[roundNumber] = session.roundData[roundNumber] || {
    bids: {},
    actuals: {},
    points: {},
    status: undefined,
  });
  delete roundData.locked;

  roundData.bids = {};
  roundData.status = undefined;
  session.highBid = null;

  pushRoundEvent(session, roundNumber, { type: "HIGH_BID_CANCELED" });

  return { ok: true, roundData };
}

export function setActuals(gameId, adminKey, round, actuals) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);
  if (session.settlementApplied) {
    throw new HttpError(400, "Game already settled; editing disabled.");
  }

  const roundNumber = Number(round);
  assert(Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= session.rounds, 400, "Invalid round");

  const roundData = session.roundData[roundNumber];
  if (!roundData || !roundData.bids) throw new HttpError(400, "Set bids before actuals");
  delete roundData.locked;

  const validIds = new Set(session.players.map((p) => p.id));
  const incomingIds = Object.keys(actuals || {});
  assert(
    incomingIds.length === session.players.length && incomingIds.every((id) => validIds.has(id)),
    400,
    "Provide actuals for all 4 valid players."
  );

  let sum = 0;
  roundData.actuals = {};

  for (const id of incomingIds) {
    const value = Number(actuals[id]);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 13) {
      throw new HttpError(400, "Each actual must be an integer between 0 and 13");
    }
    roundData.actuals[id] = value;
    sum += value;
  }

  if (sum !== 13) throw new HttpError(400, "Sum of actuals must be 13");

  scorePlayedRound(session, roundNumber);
  return { ok: true, roundData: session.roundData[roundNumber] };
}

export function resolveGame(gameId, adminKey) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);
  if (!allRoundsResolved(session)) throw new HttpError(400, "All 5 rounds must be resolved first.");
  if (session.settlementApplied) throw new HttpError(400, "Settlement already applied.");

  const result = computeFinalSettlement(session);
  ensurePayoutLedger(session);
  for (const payout of result.payouts) {
    session.payoutLedger[payout.fromPlayerId] -= payout.amount;
    session.payoutLedger[payout.toPlayerId] += payout.amount;
  }
  session.settlementApplied = true;
  session.resolvedAt = Date.now();
  session.lastSettlementResult = {
    applied: true,
    appliedAt: session.resolvedAt,
    ...result,
  };

  return { ok: true, payoutLedger: { ...session.payoutLedger } };
}

export function startNextGame(gameId, adminKey) {
  const previous = requireSession(gameId);
  assertAdmin(previous, adminKey);
  ensureSettings(previous);
  ensureInactivePlayers(previous);
  if (!previous.settlementApplied) throw new HttpError(400, "Resolve game before starting a new one.");

  const newGameId = generateGameId(8);
  const newAdminKey = generateGameId(12);
  const seriesId = previous.seriesId || previous.gameId;
  const gameIndex = (previous.gameIndex || 1) + 1;

  const nextSession = {
    seriesId,
    gameIndex,
    gameId: newGameId,
    name: previous.name,
    rounds: 5,
    createdAt: Date.now(),
    archived: false,
    players: previous.players.map((player) => ({ ...player })),
    adminKey: newAdminKey,
    settlementConfig: { ...previous.settlementConfig },
    settings: { ...previous.settings },
    inactivePlayers: [...(previous.inactivePlayers || [])],
    roundInfo: {},
    roundData: {},
    perfectCounts: Object.fromEntries(previous.players.map((p) => [p.id, 0])),
    payoutLedger: { ...previous.payoutLedger },
    highBid: null,
    settlementApplied: false,
    lastSettlementResult: undefined,
    roundHistory: {},
    roundEvents: {},
  };

  let startDealerId = nextSession.players[0].id;
  const ranking = previous.lastSettlementResult?.ranking;
  if (Array.isArray(ranking) && ranking.length === 4) {
    const loser = ranking[ranking.length - 1];
    if (loser?.id) startDealerId = loser.id;
  }

  initDealerRotation(nextSession, startDealerId);

  previous.archived = true;
  setGameRedirect(gameId, newGameId);
  setSession(nextSession);

  return {
    seriesId,
    gameIndex,
    gameId: newGameId,
    adminKey: newAdminKey,
    roundInfo: nextSession.roundInfo,
  };
}

export function reorderPlayers(gameId, adminKey, newOrder, startDealerId = null) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);
  ensureInactivePlayers(session);
  if (session.settlementApplied) {
    throw new HttpError(400, "Game already settled; editing disabled.");
  }

  assert(Array.isArray(newOrder) && newOrder.length === session.players.length, 400, "newOrder must include all 4 player ids");

  const idSet = new Set(newOrder);
  const validIds = new Set(session.players.map((p) => p.id));
  assert(idSet.size === validIds.size && [...idSet].every((id) => validIds.has(id)), 400, "Invalid player IDs");

  session.players = newOrder.map((id) => session.players.find((p) => p.id === id));

  const dealerId = startDealerId && session.players.some((p) => p.id === startDealerId)
    ? startDealerId
    : session.players[0].id;

  initDealerRotation(session, dealerId);

  return { ok: true, players: session.players, roundInfo: session.roundInfo };
}

export function substitutePlayer(
  gameId,
  adminKey,
  { outgoingPlayerId, incomingPlayerId = null, incomingName = null } = {}
) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);
  ensureInactivePlayers(session);

  if (session.settlementApplied) {
    throw new HttpError(400, "Game already settled; editing disabled.");
  }

  if (!noRoundsStarted(session)) {
    throw new HttpError(400, "Substitutions are allowed before the first round starts.");
  }

  if (!outgoingPlayerId) {
    throw new HttpError(400, "Provide outgoingPlayerId to substitute");
  }

  const replaceIndex = session.players.findIndex((player) => player.id === outgoingPlayerId);
  if (replaceIndex === -1) {
    throw new HttpError(400, "Outgoing player not found in active roster");
  }

  let incomingPlayer = null;

  if (incomingPlayerId) {
    const benchIndex = session.inactivePlayers.findIndex((player) => player.id === incomingPlayerId);
    if (benchIndex === -1) {
      throw new HttpError(400, "Incoming player not found in bench");
    }
    incomingPlayer = session.inactivePlayers.splice(benchIndex, 1)[0];
  } else {
    const trimmed = (incomingName || "").trim();
    if (!trimmed) throw new HttpError(400, "Enter a name for the new player");
    incomingPlayer = {
      id: generatePlayerId(),
      name: trimmed,
    };
  }

  const outgoingPlayer = session.players[replaceIndex];

  // Add outgoing to bench if not already present
  if (!session.inactivePlayers.some((player) => player.id === outgoingPlayer.id)) {
    session.inactivePlayers.push({ ...outgoingPlayer });
  }

  // Replace active roster slot
  session.players[replaceIndex] = { ...incomingPlayer };

  // Ensure stats entries exist for incoming player
  ensurePayoutLedger(session);
  ensurePerfectCounts(session);
  if (!(incomingPlayer.id in session.payoutLedger)) {
    session.payoutLedger[incomingPlayer.id] = 0;
  }
  if (!(incomingPlayer.id in session.perfectCounts)) {
    session.perfectCounts[incomingPlayer.id] = 0;
  }

  // Rebuild dealer rotation preserving existing first dealer when possible
  const desiredDealer = session.roundInfo?.[1]?.dealerId;
  const dealerInRoster = desiredDealer && session.players.some((player) => player.id === desiredDealer);
  initDealerRotation(session, dealerInRoster ? desiredDealer : session.players[0].id);

  return {
    ok: true,
    players: session.players,
    inactivePlayers: session.inactivePlayers,
    roundInfo: session.roundInfo,
  };
}

export function setBidders(gameId, adminKey, round, bidderOrder) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);

  const roundNumber = Number(round);
  assert(Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= session.rounds, 400, "Invalid round");

  const validIds = new Set(session.players.map((p) => p.id));
  assert(Array.isArray(bidderOrder) && bidderOrder.length === session.players.length, 400, "bidderOrder must include all 4 players");
  assert(bidderOrder.every((id) => validIds.has(id)), 400, "Invalid bidderOrder ids");

  session.roundInfo[roundNumber] = session.roundInfo[roundNumber] || {};
  session.roundInfo[roundNumber].bidderOrder = bidderOrder;
  session.roundInfo[roundNumber].dealerId = bidderOrder[bidderOrder.length - 1];

  return { ok: true, roundInfo: session.roundInfo[roundNumber] };
}

export function getSeriesByGame(gameId) {
  const session = requireSession(gameId);
  ensureSettings(session);
  const seriesId = session.seriesId || session.gameId;
  return { seriesId, currentGameId: session.gameId, games: listSeriesGames(seriesId) };
}

export function getSeriesById(seriesId) {
  const games = listSeriesGames(seriesId);
  if (!games.length) throw new HttpError(404, "Series not found");
  return { seriesId, games };
}

export function getGameHistory(gameId) {
  const session = requireSession(gameId, { allowArchived: true });
  ensureSettings(session);
  if (!session.settlementApplied) {
    throw new HttpError(403, "HISTORY_LOCKED_UNTIL_GAME_RESOLVED", {
      message: "Game history becomes available after the game is resolved.",
    });
  }

  return {
    seriesId: session.seriesId,
    gameIndex: session.gameIndex,
    gameId: session.gameId,
    name: session.name,
    players: session.players,
    roundHistory: session.roundHistory || {},
    roundEvents: session.roundEvents || {},
    resolvedAt: session.resolvedAt || null,
  };
}

export function getHighBidState(gameId) {
  const session = requireSession(gameId);
  ensureSettings(session);
  return session.highBid || null;
}

export function updateGameSettings(gameId, adminKey, updates = {}) {
  const session = requireSession(gameId);
  assertAdmin(session, adminKey);
  ensureSettings(session);

  if (Object.prototype.hasOwnProperty.call(updates, "autoAwardEnabled")) {
    session.settings.autoAwardEnabled = Boolean(updates.autoAwardEnabled);
  }

  return { ok: true, settings: { ...session.settings } };
}
