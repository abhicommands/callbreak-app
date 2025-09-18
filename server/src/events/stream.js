import {
  getPublicGame,
  getSummary,
  getGameRedirect,
} from "../services/gameService.js";

const gameStreams = new Map(); // gameId -> Set<{ id, res, heartbeat }>

function sendEvent(res, event, payload) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addHeartbeat(client) {
  client.heartbeat = setInterval(() => {
    if (client.res.writableEnded) {
      clearInterval(client.heartbeat);
      return;
    }
    client.res.write(": ping\n\n");
  }, 25000);
}

export function registerGameStream(gameId, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const redirectTarget = getGameRedirect(gameId);
  if (redirectTarget) {
    sendEvent(res, "redirect", { gameId: redirectTarget });
    res.end();
    return;
  }

  const client = { id: Date.now() + Math.random(), res, heartbeat: null };
  addHeartbeat(client);

  const existing = gameStreams.get(gameId) || new Set();
  existing.add(client);
  gameStreams.set(gameId, existing);

  const cleanup = () => {
    clearInterval(client.heartbeat);
    const set = gameStreams.get(gameId);
    if (set) {
      set.delete(client);
      if (set.size === 0) gameStreams.delete(gameId);
    }
  };

  res.on("close", cleanup);
  res.on("error", cleanup);

  try {
    const snapshot = {
      game: getPublicGame(gameId),
      summary: getSummary(gameId),
    };
    sendEvent(res, "snapshot", snapshot);
  } catch (err) {
    sendEvent(res, "error", {
      message: err?.message || "Unable to load game",
    });
  }
}

export function broadcastGameUpdate(gameId) {
  const listeners = gameStreams.get(gameId);
  if (!listeners || listeners.size === 0) return;

  let snapshot;
  try {
    snapshot = {
      game: getPublicGame(gameId),
      summary: getSummary(gameId),
    };
  } catch (err) {
    const redirectTarget = getGameRedirect(gameId);
    if (redirectTarget) {
      for (const client of listeners) {
        if (client.res.writableEnded) continue;
        sendEvent(client.res, "redirect", { gameId: redirectTarget });
        client.res.end();
      }
      return;
    }
    snapshot = {
      error: true,
      message: err?.message || "Game not available",
    };
  }

  for (const client of listeners) {
    if (client.res.writableEnded) continue;
    if (snapshot?.error) sendEvent(client.res, "error", snapshot);
    else sendEvent(client.res, "snapshot", snapshot);
  }
}
