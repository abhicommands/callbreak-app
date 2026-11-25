import { checkWorker } from "../scripts/check-worker.js";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { test } from "node:test";
import { waitFor } from "./wait-for.js";
import { localWorker } from "./local-worker.js";

const randomHex = (bytes) => randomBytes(bytes).toString("hex");
const seats = (a, b, c, d) => ({ 1: a, 2: b, 3: c, 4: d });

test("the Worker authorizes, commits, broadcasts, restores, and survives a restart", { timeout: 60_000 }, async (t) => {
  const worker = await localWorker();
  t.after(() => worker.dispose());
  await worker.start();
  await checkWorker(worker.origin);
  const id = randomHex(16);
  const editor = randomHex(32);
  const recovery = randomHex(32);
  const setup = {
    expectedRevision: 0, action: "create", recoveryKey: recovery,
    payload: { name: "The Thursday Game", players: ["A", "B", "C", "D"], weights: [1, 2, 3] },
  };

  async function request(endpoint, { body, token, key = randomUUID(), seriesId = id } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) Object.assign(headers, { "Content-Type": "application/json", "Idempotency-Key": key });
    const response = await fetch(`${worker.origin}/api/ledger/${seriesId}/${endpoint}`, {
      method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body),
    });
    const raw = await response.text();
    assert.ok(!raw.includes(editor) && !raw.includes(recovery), "Credentials must stay out of responses");
    return { status: response.status, data: JSON.parse(raw) };
  }

  let revision;
  const command = (action, payload = {}, options = {}) =>
    request("command", {
      token: editor, body: { expectedRevision: revision, action, payload }, ...options,
    });
  const apply = async (action, payload, options) => {
    const { status, data } = await command(action, payload, options);
    assert.equal(status, 200, JSON.stringify(data));
    revision = data.view.revision;
    return data.view;
  };

  const setupKey = randomUUID();
  const initial = await request("setup", { token: editor, key: setupKey, body: setup });
  assert.equal(initial.status, 201);
  assert.ok(initial.data.view.expiresAt > Date.now() + 86_390_000);
  revision = initial.data.view.revision;
  assert.equal((await request("setup", { token: editor, key: setupKey, body: setup })).data.replayed, true);

  const deeplink = await fetch(`${worker.origin}/ledger/${id}`);
  assert.equal(deeplink.status, 200);
  assert.match(await deeplink.text(), /<title>Callbreak Ledger<\/title>/);
  assert.equal(deeplink.headers.get("referrer-policy"), "no-referrer");

  const stream = new WebSocket(`${worker.origin.replace("http", "ws")}/api/ledger/${id}/socket`);
  t.after(() => stream.close());
  const updates = [];
  stream.addEventListener("message", ({ data }) => updates.push(JSON.parse(data)));
  await waitFor(() => updates.length === 1);
  assert.equal(updates[0].version, 1);

  const invalid = await command("set-actuals", { round: 1, actuals: seats(5, 2, 3, 3) });
  assert.equal(invalid.status, 409);
  assert.equal((await command("settings", { autoAwardEnabled: false }, { token: null })).status, 403);
  assert.equal((await request("export")).status, 403);
  assert.deepEqual((await request("snapshot")).data, initial.data.view);

  const pregameSide = await apply("set-bids", { round: 1, bids: seats(8, 2, 2, 2) });
  assert.equal((await command("substitute", { outgoingPlayerId: "1", incomingName: "E" })).status, 409);
  assert.equal((await command("set-bids", { round: 1, bids: seats(4, 2, 2, 2) })).status, 409);
  assert.deepEqual((await request("snapshot")).data, pregameSide);
  await apply("cancel-highbid", { round: 1 });

  const settings = await Promise.all([
    command("settings", { autoAwardEnabled: false }),
    command("settings", { autoAwardEnabled: true }),
  ]);
  assert.deepEqual(settings.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(settings.find(({ status }) => status === 409).data.code, "STALE_REVISION");
  revision = settings.find(({ status }) => status === 200).data.view.revision;
  await apply("settings", { autoAwardEnabled: true });

  await apply("set-bids", { round: 1, bids: seats(4, 2, 2, 2) });
  const bidKey = randomUUID();
  const actualBody = { expectedRevision: revision, action: "set-actuals", payload: { round: 1, actuals: seats(5, 2, 3, 3) } };
  const actualView = await apply(actualBody.action, actualBody.payload, { key: bidKey });
  assert.equal(actualView.summary.totalsPoints[1], 4.1);
  const retry = await request("command", { token: editor, key: bidKey, body: actualBody });
  assert.equal(retry.data.replayed, true);
  assert.equal(retry.data.view.revision, revision);
  assert.equal((await request("command", {
    token: editor, key: bidKey, body: { ...actualBody, payload: { ...actualBody.payload, round: 2 } },
  })).status, 409);
  const repeated = await apply(actualBody.action, actualBody.payload);
  assert.deepEqual(repeated.summary.perfectCounts, seats(0, 1, 0, 0));

  assert.equal((await command("set-actuals", { round: 1, actuals: seats(0, 0, 0, 0) })).status, 400);
  assert.deepEqual((await request("snapshot")).data, repeated);

  await apply("set-bids", { round: 2, bids: seats(4, 1, 1, 1) });
  const projected = await apply("set-bids", { round: 3, bids: seats(4, 2, 2, 2) });
  assert.equal(projected.summary.totalsPoints[1], 8.2);
  assert.equal(projected.summary.projectedPoints[1], 12.2);
  await waitFor(() => updates.some((view) => view.revision === projected.revision));
  assert.deepEqual(updates.find((view) => view.revision === projected.revision), projected);

  const pending = await apply("set-bids", { round: 3, bids: seats(8, 2, 2, 2) });
  assert.equal(pending.summary.projectedPoints[1], 8.2);
  assert.equal((await command("set-bids", { round: 4, bids: seats(8, 2, 2, 2) })).status, 409);
  assert.equal((await command("substitute", { outgoingPlayerId: "1", incomingName: "E" })).status, 409);
  assert.equal((await command("set-actuals", { round: 3, actuals: seats(5, 2, 3, 3) })).status, 409);
  assert.deepEqual((await request("snapshot")).data, pending);
  await apply("cancel-highbid", { round: 3 });
  assert.equal((await command("set-actuals", { round: 3, actuals: seats(5, 2, 3, 3) })).status, 409);
  await apply("set-bids", { round: 3, bids: seats(8, 2, 2, 2) });
  const side = await apply("resolve-highbid", { round: 3, bidderId: "1", bidderWon: true, stake: 0.12 });
  assert.deepEqual(side.summary.payouts, seats(0.36, -0.12, -0.12, -0.12));
  assert.equal(side.game.highBid, null);
  assert.equal(side.game.roundData[3], undefined);

  const reseated = await apply("reorder-players", { newOrder: ["3", "2", "1", "4"], startDealerId: "2" });
  assert.deepEqual(reseated.game.roundInfo[1], side.game.roundInfo[1]);
  assert.deepEqual(reseated.game.roundInfo[3], side.game.roundInfo[3]);
  assert.equal(reseated.game.roundInfo[4].dealerId, "2");

  for (const round of [3, 4, 5]) {
    await apply("set-bids", { round, bids: seats(4, 2, 2, 2) });
    await apply("set-actuals", { round, actuals: seats(5, 2, 3, 3) });
  }
  const settled = await apply("resolve-game");
  const alreadySettled = await apply("resolve-game");
  assert.deepEqual(settled.summary.payouts, alreadySettled.summary.payouts);
  const nextKey = randomUUID();
  const nextBody = { expectedRevision: revision, action: "next-game", payload: {} };
  const next = await apply("next-game", {}, { key: nextKey });
  assert.equal(next.game.gameIndex, 2);
  assert.deepEqual(next.summary.payouts, settled.summary.payouts);
  assert.equal((await request("command", { token: editor, key: nextKey, body: nextBody })).data.replayed, true);

  const settledHistory = (await request("history/1")).data;
  assert.equal(settledHistory.roundHistory[1].dealerId, "1");
  assert.equal(settledHistory.roundEvents[3].filter((event) => event.type === "HIGH_BID_RESOLVED").length, 1);

  const newEditor = randomHex(32);
  const recoverKey = randomUUID();
  const recoverBody = { expectedRevision: revision, newEditorKey: newEditor };
  const recovered = await request("recover", { token: recovery, body: recoverBody, key: recoverKey });
  assert.equal(recovered.status, 200);
  assert.equal((await request("recover", { token: recovery, body: recoverBody, key: recoverKey })).data.replayed, true);
  assert.equal((await request("editor", { token: editor })).status, 403);
  assert.equal((await request("editor", { token: newEditor })).status, 200);
  const backup = (await request("export", { token: newEditor })).data;
  assert.deepEqual(backup.events.at(-1).payload, {});
  assert.ok(!JSON.stringify(backup).includes(newEditor));

  const restoredId = randomHex(16);
  const restoredKey = randomHex(32);
  const restore = {
    expectedRevision: 0, action: "restore", recoveryKey: randomHex(32),
    payload: structuredClone(backup),
  };
  restore.payload.events[1].revision = 100;
  assert.equal((await request("setup", { token: restoredKey, seriesId: restoredId, body: restore })).status, 400);
  assert.equal((await request("snapshot", { seriesId: restoredId })).status, 404);
  restore.payload = backup;
  assert.equal((await request("setup", { token: restoredKey, seriesId: restoredId, body: restore })).status, 201);
  assert.deepEqual((await request("history/1", { seriesId: restoredId })).data, settledHistory);
  assert.deepEqual((await request("export", { token: restoredKey, seriesId: restoredId })).data, backup);

  await worker.stop();
  await worker.start();
  assert.deepEqual((await request("snapshot")).data, recovered.data.view);
  assert.deepEqual((await request("history/1")).data, settledHistory);
  assert.equal((await request("command", { token: newEditor, key: nextKey, body: nextBody })).data.replayed, true);
  const restored = (await request("snapshot", { seriesId: restoredId })).data;
  assert.ok(restored.expiresAt >= recovered.data.view.expiresAt);
  assert.deepEqual(restored, {
    ...recovered.data.view,
    expiresAt: restored.expiresAt,
    game: { ...recovered.data.view.game, seriesId: restoredId },
  });
});

test("inactivity alarms delete the ledger and a backup restores it with a fresh deadline", { timeout: 45_000 }, async (t) => {
  const worker = await localWorker({ idleSeconds: 5 });
  t.after(() => worker.dispose());
  await worker.start();

  const config = { name: "Expiry test", players: ["A", "B", "C", "D"], weights: [1, 2, 3] };
  const newLedger = (action = "create", payload = config) => ({
    id: randomHex(16),
    editor: randomHex(32),
    setup: { expectedRevision: 0, action, payload, recoveryKey: randomHex(32) },
  });
  function request(ledger, route, { editor = false, key = randomUUID(), body } = {}) {
    const headers = {};
    if (editor) headers.Authorization = `Bearer ${ledger.editor}`;
    if (body) Object.assign(headers, { "Content-Type": "application/json", "Idempotency-Key": key });
    return fetch(`${worker.origin}/api/ledger/${ledger.id}/${route}`, {
      method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body),
    });
  }
  async function setup(ledger) {
    const response = await request(ledger, "setup", { editor: true, body: ledger.setup });
    assert.equal(response.status, 201);
    return (await response.json()).view;
  }
  async function listen(ledger) {
    const socket = new WebSocket(`${worker.origin.replace("http", "ws")}/api/ledger/${ledger.id}/socket`);
    t.after(() => socket.close());
    const closed = once(socket, "close").then(([event]) => event.code);
    await once(socket, "message");
    return { closed };
  }

  const idle = newLedger();
  const edited = newLedger();
  const [idleView, firstView] = await Promise.all([setup(idle), setup(edited)]);
  const [idleSocket, editedSocket] = await Promise.all([listen(idle), listen(edited)]);
  await wait(1800);

  const viewer = await request(idle, "snapshot");
  assert.equal((await viewer.json()).expiresAt, idleView.expiresAt);
  const key = randomUUID();
  const body = { expectedRevision: firstView.revision, action: "set-bids", payload: { round: 1, bids: seats(4, 2, 2, 2) } };
  const saved = await request(edited, "command", { editor: true, key, body });
  assert.equal(saved.status, 200);
  const { view } = await saved.json();
  assert.ok(view.expiresAt > firstView.expiresAt);
  const duplicate = await request(edited, "command", { editor: true, key, body });
  assert.equal((await duplicate.json()).view.expiresAt, view.expiresAt);

  const backup = await (await request(edited, "export", { editor: true })).json();
  assert.equal((await (await request(edited, "snapshot")).json()).expiresAt, view.expiresAt);

  // Check the logical deadlines separately from the runtime's alarm delivery.
  await wait(Math.max(idleView.expiresAt, firstView.expiresAt) - Date.now() + 50);
  assert.ok([404, 410].includes((await request(idle, "snapshot")).status));
  assert.equal((await request(edited, "snapshot")).status, 200);

  // Alarm closure proves physical cleanup happened without an editor being present.
  assert.deepEqual(await Promise.all([idleSocket.closed, editedSocket.closed]), [4004, 4004]);
  assert.equal((await request(idle, "snapshot")).status, 404);
  assert.equal((await request(edited, "snapshot")).status, 404);
  assert.equal((await request(edited, "export", { editor: true })).status, 404);

  const restoredLedger = newLedger("restore", backup);
  const restored = await setup(restoredLedger);
  assert.ok(restored.expiresAt > view.expiresAt);
  assert.deepEqual(restored.summary, view.summary);
  assert.notEqual(restored.game.seriesId, view.game.seriesId);
});
