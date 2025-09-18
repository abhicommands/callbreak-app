const sessions = new Map();

export function getSession(gameId) {
  return sessions.get(gameId) || null;
}

export function setSession(game) {
  if (!game || !game.gameId) {
    throw new Error("Cannot store session without gameId");
  }
  sessions.set(game.gameId, game);
}

export function removeSession(gameId) {
  sessions.delete(gameId);
}

export function listSessions() {
  return Array.from(sessions.values());
}

export function clearSessions() {
  sessions.clear();
}

export function generateGameId(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export function generatePlayerId(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

export function generateSeriesId(len = 10) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}
