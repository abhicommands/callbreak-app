import {
  createGame,
  getPublicGame,
  getSummary,
  setBids,
  resolveHighBid,
  setActuals,
  resolveGame,
  startNextGame,
  reorderPlayers,
  setBidders,
  cancelHighBid,
  getSeriesByGame,
  getSeriesById,
  getGameHistory,
  updateGameSettings,
  substitutePlayer,
} from "../services/gameService.js";
import { asHttpError } from "../utils/errors.js";
import { broadcastGameUpdate, registerGameStream } from "../events/stream.js";

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const httpErr = asHttpError(error);
      const payload = { error: httpErr.message };
      if (httpErr.data && typeof httpErr.data === "object") {
        Object.assign(payload, httpErr.data);
      }
      res.status(httpErr.status).json(payload);
    }
  };
}

export const createGameHandler = handle(async (req, res) => {
  const response = createGame(req.body || {});
  res.json(response);
});

export const getGameHandler = handle(async (req, res) => {
  const response = getPublicGame(req.params.gameId);
  res.json(response);
});

export const getSummaryHandler = handle(async (req, res) => {
  const response = getSummary(req.params.gameId);
  res.json(response);
});

export const setBidsHandler = handle(async (req, res) => {
  const { adminKey, round, bids } = req.body || {};
  try {
    const response = setBids(req.params.gameId, adminKey, round, bids);
    res.json({ ok: true, ...response });
    broadcastGameUpdate(req.params.gameId);
  } catch (error) {
    if (error?.data?.highBidTriggered) {
      broadcastGameUpdate(req.params.gameId);
    }
    throw error;
  }
});

export const resolveHighBidHandler = handle(async (req, res) => {
  const { adminKey, round, bidderId, winnerId, stake, bidderWon } =
    req.body || {};
  const response = resolveHighBid(req.params.gameId, adminKey, {
    round,
    bidderId,
    winnerId,
    stake,
    bidderWon,
  });
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const cancelHighBidHandler = handle(async (req, res) => {
  const { adminKey, round } = req.body || {};
  const response = cancelHighBid(req.params.gameId, adminKey, round);
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const setActualsHandler = handle(async (req, res) => {
  const { adminKey, round, actuals } = req.body || {};
  const response = setActuals(req.params.gameId, adminKey, round, actuals);
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const resolveGameHandler = handle(async (req, res) => {
  const { adminKey } = req.body || {};
  const response = resolveGame(req.params.gameId, adminKey);
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const nextGameHandler = handle(async (req, res) => {
  const { adminKey } = req.body || {};
  const response = startNextGame(req.params.gameId, adminKey);
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
  broadcastGameUpdate(response.gameId);
});

export const reorderPlayersHandler = handle(async (req, res) => {
  const { adminKey, newOrder, startDealerId } = req.body || {};
  const response = reorderPlayers(
    req.params.gameId,
    adminKey,
    newOrder,
    startDealerId
  );
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const substitutePlayerHandler = handle(async (req, res) => {
  const { adminKey, outgoingPlayerId, incomingPlayerId, incomingName } =
    req.body || {};
  const response = substitutePlayer(req.params.gameId, adminKey, {
    outgoingPlayerId,
    incomingPlayerId,
    incomingName,
  });
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const setBiddersHandler = handle(async (req, res) => {
  const { adminKey, round, bidderOrder } = req.body || {};
  const response = setBidders(
    req.params.gameId,
    adminKey,
    round,
    bidderOrder
  );
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});

export const seriesByGameHandler = handle(async (req, res) => {
  const response = getSeriesByGame(req.params.gameId);
  res.json(response);
});

export const seriesByIdHandler = handle(async (req, res) => {
  const response = getSeriesById(req.params.seriesId);
  res.json(response);
});

export const historyHandler = handle(async (req, res) => {
  const response = getGameHistory(req.params.gameId);
  res.json(response);
});

export const streamHandler = handle(async (req, res) => {
  registerGameStream(req.params.gameId, res);
});

export const updateSettingsHandler = handle(async (req, res) => {
  const { adminKey, autoAwardEnabled } = req.body || {};
  const response = updateGameSettings(req.params.gameId, adminKey, {
    autoAwardEnabled,
  });
  res.json(response);
  broadcastGameUpdate(req.params.gameId);
});
