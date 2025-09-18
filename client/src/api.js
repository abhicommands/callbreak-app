// src/api.js
const BASE = "/api";

async function jsonOrThrow(res) {
  const txt = await res.text();
  let data = {};
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = { error: txt };
  }
  if (!res.ok) {
    const err = new Error(
      data?.error || res.statusText || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- Core game ----------
export async function createGame(body) {
  const r = await fetch(`${BASE}/create-game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function getGame(gameId) {
  const r = await fetch(`${BASE}/game/${gameId}`);
  return jsonOrThrow(r);
}

export async function getSummary(gameId) {
  const r = await fetch(`${BASE}/game/${gameId}/summary`);
  return jsonOrThrow(r);
}

// ---------- Admin actions (new set) ----------
export async function setBids(
  gameId,
  body /* { adminKey, round, bids:{[pid]:number} } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/set-bids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function resolveHighBid(
  gameId,
  body /* { adminKey, round, bidderId, stake, bidderWon } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/resolve-highbid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function setActuals(
  gameId,
  body /* { adminKey, round, actuals:{[pid]:number} } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/set-actuals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function cancelHighBid(
  gameId,
  body /* { adminKey, round } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/cancel-highbid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function resolveGame(gameId, body /* { adminKey } */) {
  const r = await fetch(`${BASE}/game/${gameId}/resolve-game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function nextGame(gameId, body /* { adminKey } */) {
  const r = await fetch(`${BASE}/game/${gameId}/next-game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

// ---------- Seating / settings ----------
export async function reorderPlayers(
  gameId,
  body /* { adminKey, newOrder:[pid,pid,pid,pid] } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/reorder-players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function setBidders(
  gameId,
  body /* { adminKey, round, bidderOrder:[pid,...](dealer last) } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/set-bidders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function updateGameSettings(
  gameId,
  body /* { adminKey, autoAwardEnabled } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}

export async function substitutePlayer(
  gameId,
  body /* { adminKey, outgoingPlayerId, incomingPlayerId?, incomingName? } */
) {
  const r = await fetch(`${BASE}/game/${gameId}/substitute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(r);
}
