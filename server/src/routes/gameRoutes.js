import { Router } from "express";
import {
  createGameHandler,
  getGameHandler,
  getSummaryHandler,
  setBidsHandler,
  resolveHighBidHandler,
  cancelHighBidHandler,
  setActualsHandler,
  resolveGameHandler,
  nextGameHandler,
  reorderPlayersHandler,
  setBiddersHandler,
  seriesByGameHandler,
  seriesByIdHandler,
  historyHandler,
  streamHandler,
  updateSettingsHandler,
  substitutePlayerHandler,
} from "../controllers/gameController.js";

const router = Router();

router.post("/create-game", createGameHandler);
router.get("/game/:gameId", getGameHandler);
router.get("/game/:gameId/summary", getSummaryHandler);
router.get("/game/:gameId/stream", streamHandler);
router.post("/game/:gameId/set-bids", setBidsHandler);
router.post("/game/:gameId/resolve-highbid", resolveHighBidHandler);
router.post("/game/:gameId/cancel-highbid", cancelHighBidHandler);
router.post("/game/:gameId/set-actuals", setActualsHandler);
router.post("/game/:gameId/resolve-game", resolveGameHandler);
router.post("/game/:gameId/next-game", nextGameHandler);
router.post("/game/:gameId/reorder-players", reorderPlayersHandler);
router.post("/game/:gameId/set-bidders", setBiddersHandler);
router.post("/game/:gameId/settings", updateSettingsHandler);
router.post("/game/:gameId/substitute", substitutePlayerHandler);
router.get("/series/by-game/:gameId", seriesByGameHandler);
router.get("/series/:seriesId/games", seriesByIdHandler);
router.get("/game/:gameId/history", historyHandler);

export default router;
