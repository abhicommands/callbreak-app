import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { test } from "node:test";
import { dealHands, legalCards, nextSeat, seatPosition, winningPlay } from "../server/src/services/callbreakCards.js";
import { applyCommand, createGame, getSummary } from "../server/src/services/gameService.js";
import { calcPoints } from "../server/src/utils/gameLogic.js";
import { localWorker } from "./local-worker.js";
import { waitFor } from "./wait-for.js";

const hex = (size) => randomBytes(size).toString("hex");

test("Callbreak enforces following suit, overtaking and trump", () => {
  const hands = dealHands();
  assert.deepEqual(hands.map((hand) => hand.length), [13, 13, 13, 13]);
  assert.equal(new Set(hands.flat()).size, 52);
  const order = ["S", "H", "C", "D"].flatMap((suit) =>
    ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].map((rank) => suit + rank));
  for (const hand of hands) assert.deepEqual(hand, order.filter((card) => hand.includes(card)));
  const hearts = [{ seat: 0, card: "H10" }];
  assert.deepEqual(legalCards(["H3", "HJ", "HQ", "SA"], hearts), ["HJ", "HQ"]);
  assert.deepEqual(legalCards(["H3", "SA"], hearts), ["H3"]);
  assert.deepEqual(legalCards(["DA", "S2", "SA"], hearts), ["S2", "SA"]);
  const trumped = [...hearts, { seat: 1, card: "SK" }];
  assert.deepEqual(legalCards(["DA", "S2", "SA"], trumped), ["SA"]);
  assert.deepEqual(legalCards(["DA", "S2"], trumped), ["DA", "S2"]);
  assert.deepEqual(legalCards(["HA", "H3", "SA"], trumped), ["HA", "H3"]);
  assert.deepEqual(legalCards(["DA", "CJ"], hearts), ["DA", "CJ"]);
  assert.deepEqual(legalCards(["S3", "SA", "D3"], [{ seat: 0, card: "S10" }]), ["SA"]);
  assert.deepEqual(legalCards(["S3", "D3"], [{ seat: 0, card: "S10" }]), ["S3"]);
  assert.equal(winningPlay([...trumped, { seat: 2, card: "HA" }]).seat, 1);
  assert.equal(winningPlay([...trumped, { seat: 2, card: "SA" }]).seat, 2);
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(seatPosition(seat, seat), "south");
    assert.equal(seatPosition(nextSeat(seat), seat), "east");
    assert.equal(seatPosition(nextSeat(nextSeat(seat)), seat), "north");
    assert.equal(seatPosition(nextSeat(nextSeat(nextSeat(seat))), seat), "west");
  }
});

test("both ledgers require a first-place decision and split or award the payout consistently", () => {
  for (const mode of [undefined, "online"]) {
    const game = createGame("table", { name: "Friday", players: ["A", "B", "C", "D"], weights: [1, 2, 3],
      mode, autoAwardEnabled: false }, 1000);
    const bids = { 1: 4, 2: 4, 3: 2, 4: 2 };
    const actuals = { 1: 5, 2: 5, 3: 2, 4: 1 };
    for (let round = 1; round <= 5; round++) {
      if (mode === "online") {
        applyCommand(game, "record-online-bids", { round, players: game.players, bids }, 1000 + round);
        applyCommand(game, "record-online-round", { round, players: game.players, bids, actuals }, 1000 + round);
      } else {
        applyCommand(game, "set-bids", { round, bids }, 1000 + round);
        applyCommand(game, "set-actuals", { round, actuals }, 1000 + round);
      }
    }
    assert.deepEqual(getSummary(game).pendingTie.map(({ id }) => id), ["1", "2"]);
    assert.throws(() => applyCommand(game, "settle-game", {}, 1006), /split the tie/);
    assert.throws(() => applyCommand(game, "settle-game", { winnerId: "3" }, 1006), /tied players/);
    const split = structuredClone(game);
    applyCommand(split, "settle-game", { splitTie: true }, 1006);
    assert.deepEqual(getSummary(split).settlement.winnerIds, ["1", "2"]);
    assert.deepEqual(getSummary(split).gamePayouts, { 1: 8, 2: 8, 3: -4, 4: -12 });
    assert.deepEqual(getSummary(split).pendingTie, []);
    applyCommand(game, "settle-game", { winnerId: "2" }, 1006);
    assert.deepEqual(getSummary(game).settlement.winnerIds, ["2"]);
    assert.deepEqual(getSummary(game).payouts, { 1: -2, 2: 18, 3: -4, 4: -12 });
  }
});

test("the online high-bid ledger uses the same opponent transfers as the in-person ledger", () => {
  for (const won of [true, false]) {
    const settings = { name: "Friday", players: ["A", "B", "C", "D"], weights: [1, 2, 3], stake: 2 };
    const bids = { 1: 8, 2: 2, 3: 2, 4: 2 };
    const manual = createGame("manual", settings, 1000);
    const online = createGame("online", { ...settings, mode: "online" }, 1000);
    applyCommand(manual, "set-bids", { round: 1, bids }, 1001);
    applyCommand(manual, "resolve-highbid", { round: 1, bidderId: "1", bidderWon: won }, 1002);
    applyCommand(online, "record-online-bids", { round: 1, players: online.players, bids }, 1001);
    assert.throws(() => applyCommand(online, "record-online-highbid", { round: 1, bidderId: "1", won: 4, remaining: 4 }, 1001),
      /undecided/);
    const locked = { round: 1, bidderId: "1", won: won ? 8 : 3, remaining: 4 };
    applyCommand(online, "record-online-highbid", locked, 1002);
    assert.deepEqual(getSummary(online).gamePayouts, getSummary(manual).gamePayouts);
    assert.equal(getSummary(online).totalsPoints[1], 0);
    assert.throws(() => applyCommand(online, "record-online-highbid", locked, 1002), /already scored/);
    applyCommand(online, "abandon-online-round", { round: 1 }, 1003);
    assert.deepEqual(getSummary(online).gamePayouts, getSummary(manual).gamePayouts);
    assert.equal(getSummary(online).projectedPoints[1], 0);
  }
});

test("online scoring finishes five deals and settles only when the roster stayed intact", () => {
  for (const substitute of [false, true]) {
    const game = createGame("table", { name: "Friday", players: ["A", "B", "C", "D"], weights: [1, 2, 3],
      mode: "online", autoAwardEnabled: false }, 1000);
    let players = game.players;
    for (let round = 1; round <= 5; round++) {
      if (substitute && round === 2) players = [...players.slice(0, 3), { id: "5", name: "E" }];
      const last = players[3].id;
      applyCommand(game, "record-online-round", {
        round, players, bids: { 1: 3, 2: 2, 3: 2, [last]: 2 }, actuals: { 1: 4, 2: 4, 3: 3, [last]: 2 },
      }, 1000 + round);
    }
    assert.deepEqual(Object.keys(game.roundData), ["1", "2", "3", "4", "5"]);
    assert.equal(getSummary(game).totalsPoints[1], 15.5);
    if (substitute) {
      assert.equal(game.settlementSkipped, true);
      assert.equal(game.settlementApplied, false);
      assert.equal(getSummary(game).totalsPoints[4], 2);
      assert.equal(getSummary(game).totalsPoints[5], 8);
    } else {
      assert.equal(game.settlementApplied, true);
      assert.equal(getSummary(game).settlement.ranking.length, 4);
      assert.equal(Object.values(game.balanceUnits).reduce((sum, balance) => sum + balance), 0);
      const rematch = applyCommand(game, "next-online-game", { players: [...game.players].reverse(), startDealerIndex: 2 }, 1006);
      assert.equal(rematch.gameIndex, 2);
      assert.deepEqual(getSummary(rematch).payouts, getSummary(game).payouts);
      assert.deepEqual(rematch.roundData, {});
      assert.equal(rematch.roundInfo[1].dealerId, rematch.players[2].id);
    }
  }
});

function harness(t, origin) {
  const id = hex(16);
  const recovery = hex(32);
  const path = `/api/table/${id}`;
  const ledger = `/api/ledger/${id}`;
  const sockets = new Set();
  t.after(() => { for (const socket of sockets) socket.close(); });

  function actor(name, token = hex(32)) {
    const player = { name, token, view: null };
    player.connect = async () => {
      player.view = null;
      const socket = new WebSocket(new URL(`${path}/socket`, origin.replace("http", "ws")), ["callbreak", token]);
      player.socket = socket;
      sockets.add(socket);
      player.replies = new Map();
      socket.addEventListener("message", (event) => {
        if (event.data === "pong") return;
        const body = JSON.parse(event.data);
        if ("ack" in body) player.replies.set(body.ack, body);
        else if ("sync" in body) player.synced = body;
        else player.view = body;
      });
      const ping = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 4000);
      socket.addEventListener("close", () => clearInterval(ping), { once: true });
      await waitFor(() => player.view);
    };
    return player;
  }

  const players = ["Host", "Arun", "Bina", "Cory"].map((name) => actor(name));
  async function request(url, { player, body, key = randomUUID() } = {}) {
    const headers = body ? { "Content-Type": "application/json", "Idempotency-Key": key } : {};
    if (player) headers.Authorization = `Bearer ${player.token}`;
    const response = await fetch(new URL(url, origin), {
      method: body ? "POST" : "GET", body: body && JSON.stringify(body), headers,
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, data: await response.json() };
  }

  const command = (player, action, data = {}, key) =>
    request(`${path}/command`, { player, key, body: { revision: player.view.revision, action, ...data } });

  async function apply(player, action, data = {}) {
    const previous = player.view.revision;
    const result = await command(player, action, data);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    await waitFor(() => player.view.revision > previous);
    return player.view;
  }

  async function setup(settings = { bidSeconds: 0, playSeconds: 0 }) {
    const result = await request(`${path}/setup`, { player: players[0],
      body: { name: "Friday", player: players[0].name, recovery, settings } });
    assert.equal(result.status, 201);
    await players[0].connect();
  }

  async function join(player) {
    const result = await request(`${path}/join`, { player, body: { name: player.name } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    await player.connect();
  }

  async function bidAll(seats, values) {
    for (const value of values) {
      const host = seats[0];
      const revision = host.view.revision;
      const turn = seats.find((player) => player.view.seat === host.view.turn);
      await waitFor(() => turn.view.revision === revision);
      await apply(turn, "bid", { value });
      await waitFor(() => host.view.revision > revision);
    }
  }

  async function playDeal(seats, onMove) {
    let played = 0;
    const host = seats[0];
    while (host.view.phase === "playing") {
      const revision = host.view.revision;
      const turn = seats.find((player) => player.view.seat === host.view.turn);
      await waitFor(() => turn.view.revision === revision && turn.view.legal.length);
      await apply(turn, "play", { value: turn.view.legal[0] });
      await waitFor(() => host.view.revision > revision);
      played++;
      if (onMove) onMove(host.view, played);
      assert.ok(played <= 48);
    }
    return played;
  }

  return { id, path, ledger, recovery, players, actor, request, command, apply, setup, join, bidAll, playDeal };
}

test("four authenticated players rebid the same cards, recover seats, substitute, and populate a restorable ledger", { timeout: 120_000 }, async (t) => {
  const worker = await localWorker();
  t.after(() => worker.dispose());
  await worker.start();
  const game = harness(t, worker.origin);
  const [host, arun, bina, cory] = game.players;
  await game.setup();
  assert.equal((await game.command(host, "start")).status, 409);
  for (const guest of [arun, bina, cory]) await game.join(guest);
  await waitFor(() => host.view.seats.every((seat) => seat?.online));
  await waitFor(() => arun.view.revision === host.view.revision);
  assert.equal((await game.command(arun, "start")).status, 403);
  await game.apply(host, "start");
  await waitFor(() => game.players.every((player) => player.view.hand.length === 13));
  const original = game.players.map((player) => player.view.hand);
  assert.equal(new Set(original.flat()).size, 52);
  const corySeat = cory.view.seat;
  const coryId = String(corySeat + 1);
  const hostSeat = host.view.seat;
  assert.equal(host.view.seats.findIndex((seat) => seat.host), hostSeat);
  assert.equal(host.view.turn, (host.view.dealer + 1) % 4);

  const visitor = game.actor("Visitor");
  await visitor.connect();
  assert.deepEqual(visitor.view.hand, []);
  assert.equal(Object.hasOwn(visitor.view, "hands"), false);
  assert.equal((await game.request(`${game.path}/export`, { player: visitor })).status, 403);
  assert.equal((await game.command(game.players.find((player) => player.view.seat !== host.view.turn),
    "bid", { value: 3 })).status, 409);
  await game.bidAll(game.players, [2, 2, 2, 2]);
  await waitFor(() => game.players.every((player) => player.view.attempts === 2));
  assert.deepEqual(game.players.map((player) => player.view.hand), original);
  assert.deepEqual(host.view.seats.map((seat) => seat.bid), [null, null, null, null]);
  await game.bidAll(game.players, [3, 2, 2, 2]);
  assert.equal(host.view.phase, "playing");

  cory.socket.close();
  await waitFor(() => host.view.seats[corySeat].online === false);
  assert.equal((await game.command(arun, "play", { value: original[1][0] })).data.error,
    "Player offline. Waiting for reconnect.");
  const newBrowser = game.actor("Cory on another phone");
  await game.join(newBrowser);
  assert.deepEqual(newBrowser.view.hand, []);
  await waitFor(() => host.view.requests.length === 1);
  const { id: requestId } = host.view.requests[0];
  assert.equal((await game.command(host, "approve", { requestId, target: corySeat, replace: true })).status, 409);
  await game.apply(host, "approve", { requestId, target: corySeat });
  await waitFor(() => newBrowser.view.seat === corySeat);
  assert.deepEqual(newBrowser.view.hand, original[3]);
  assert.equal(newBrowser.view.seats[corySeat].name, "Cory");
  await cory.connect();
  assert.deepEqual(cory.view.hand, []);
  assert.equal(cory.view.seat, -1);
  assert.equal((await game.command(cory, "play", { value: original[3][0] })).status, 403);
  host.socket.close();
  await waitFor(() => arun.view.seats[hostSeat].online === false);
  assert.equal((await game.command(arun, "play", { value: original[1][0] })).status, 409);
  const recoveredHost = game.actor("Recovered host");
  const recovery = await game.request(`${game.path}/recover`, {
    player: { token: game.recovery }, body: { newToken: recoveredHost.token },
  });
  assert.equal(recovery.status, 200);
  await recoveredHost.connect();
  const seats = [recoveredHost, arun, bina, newBrowser];
  const turn = seats.find((player) => player.view.seat === recoveredHost.view.turn);
  await waitFor(() => turn.view.legal.length);
  const otherCard = seats.find((player) => player !== turn).view.hand[0];
  assert.equal((await game.command(turn, "play", { value: otherCard })).status, 400);
  assert.equal(await game.playDeal(seats), 48);
  assert.equal(recoveredHost.view.taken.length, 13);
  assert.equal(new Set(recoveredHost.view.taken.flatMap(({ plays }) => plays.map(({ card }) => card))).size, 52);
  const [penultimate, finalTrick] = recoveredHost.view.taken.slice(-2);
  assert.equal(finalTrick.number, 13);
  assert.equal(finalTrick.automatic, true);
  assert.equal(finalTrick.plays[0].seat, penultimate.winner);
  assert.deepEqual(finalTrick.plays.map(({ seat }) => seat), [0, 1, 2, 3].map((offset) => (penultimate.winner + offset) % 4));
  assert.equal(finalTrick.winner, winningPlay(finalTrick.plays).seat);
  assert.equal(recoveredHost.view.clock, null);
  await waitFor(() => seats.every((player) => player.view.phase === "between" && !player.view.hand.length));

  const first = (await game.request(`${game.ledger}/snapshot`)).data;
  const scores = first.game.roundData[1];
  for (const [id, tricks] of Object.entries(scores.actuals)) {
    assert.equal(recoveredHost.view.taken.filter(({ winnerId }) => winnerId === id).length, tricks);
  }
  assert.equal(scores.status, "PLAYED");
  assert.equal(Object.values(scores.actuals).reduce((a, b) => a + b), 13);
  assert.deepEqual(scores.points, Object.fromEntries(Object.keys(scores.bids).map((id) =>
    [id, calcPoints(scores.bids[id], scores.actuals[id])])));
  assert.equal(first.game.players[corySeat].name, "Cory");

  await worker.stop();
  await worker.start();
  await Promise.all(seats.map((player) => player.connect()));
  await waitFor(() => recoveredHost.view.seats.every((seat) => seat?.online));
  assert.equal(recoveredHost.view.phase, "between");
  assert.deepEqual((await game.request(`${game.ledger}/snapshot`)).data.game.roundData, first.game.roundData);

  await game.apply(recoveredHost, "remove", { target: corySeat });
  assert.equal((await game.command(recoveredHost, "next")).status, 409);
  const replacement = game.actor("Dev");
  await game.join(replacement);
  await waitFor(() => recoveredHost.view.requests.length === 1);
  await game.apply(recoveredHost, "approve", { requestId: recoveredHost.view.requests[0].id, target: corySeat, replace: true });
  seats[3] = replacement;
  await waitFor(() => recoveredHost.view.seats[corySeat]?.online);
  await game.apply(recoveredHost, "next");
  await game.bidAll(seats, [10, 10, 1, 1]);
  let scoredBeforeLastCard = false;
  assert.equal(await game.playDeal(seats, (view, played) => {
    if (played < 48 && view.scores.summary.highBids.length) {
      scoredBeforeLastCard = true;
      assert.ok(Object.values(view.scores.summary.gamePayouts).some(Boolean));
    }
  }), 48);
  assert.equal(scoredBeforeLastCard, true);
  const final = (await game.request(`${game.ledger}/snapshot`)).data;
  const second = final.game.roundData[2];
  const newId = final.game.players[corySeat].id;
  assert.equal(final.game.players[corySeat].name, "Dev");
  assert.equal(final.game.inactivePlayers[0].name, "Cory");
  assert.equal(final.summary.totalsPoints[coryId], scores.points[coryId]);
  assert.equal(final.summary.totalsPoints[newId], second.points[newId]);
  assert.equal(Object.hasOwn(second.points, coryId), false);
  assert.equal(final.game.highBid, null);

  for (let round = 3; round <= 5; round++) {
    await game.apply(recoveredHost, "next");
    await game.bidAll(seats, [3, 2, 2, 2]);
    assert.equal(await game.playDeal(seats), 48);
  }
  assert.equal(recoveredHost.view.phase, "finished");
  const completed = (await game.request(`${game.ledger}/snapshot`)).data;
  assert.equal(completed.game.settlementSkipped, true);
  await game.apply(recoveredHost, "rematch");
  assert.equal(recoveredHost.view.gameIndex, 2);
  assert.equal(recoveredHost.view.hand.length, 13);
  const history = await game.request(`${game.ledger}/history`);
  assert.equal(history.data.currentGameId, "2");
  assert.deepEqual(history.data.games.map((entry) => [entry.gameIndex, entry.settlementApplied]), [[1, true], [2, false]]);
  const archived = await game.request(`${game.ledger}/history/1`);
  assert.deepEqual(archived.data.ledger.game.roundData, completed.game.roundData);
  await game.apply(recoveredHost, "end");
  await waitFor(() => replacement.view.phase === "ended");
  assert.equal(Object.hasOwn(replacement.view, "hand"), false);
  assert.equal((await game.request(`${game.path}/join`, { player: visitor, body: { name: visitor.name } })).status, 410);
  const archive = await game.request(`${game.path}/export`, { player: recoveredHost });
  assert.equal(archive.status, 200);
  assert.equal(archive.data.events.filter(({ action }) => action === "record-online-highbid").length, 2);
  assert.equal(archive.data.events.filter(({ action }) => action === "record-online-round").length, 5);
  const restoredId = hex(16);
  const restored = await game.request(`/api/ledger/${restoredId}/setup`, {
    player: game.actor("Restore"), body: { expectedRevision: 0, action: "restore", recoveryKey: hex(32), payload: archive.data },
  });
  assert.equal(restored.status, 201);
  assert.deepEqual(restored.data.view.game.roundData, {});
  const restoredHistory = await game.request(`/api/ledger/${restoredId}/history/1`);
  assert.deepEqual(restoredHistory.data.ledger.game.roundData, completed.game.roundData);
  assert.deepEqual(restoredHistory.data.ledger.summary.gamePayouts, completed.summary.gamePayouts);
  assert.equal((await game.request(`${game.ledger}/snapshot`)).status, 200);
});

test("live moves survive unrelated activity and an HTTP retry cannot duplicate a WebSocket move", { timeout: 30_000 }, async (t) => {
  const worker = await localWorker();
  t.after(() => worker.dispose());
  await worker.start();
  const game = harness(t, worker.origin);
  const [host, ...guests] = game.players;
  await game.setup();
  for (const guest of guests) await game.join(guest);
  await waitFor(() => host.view.seats.every((seat) => seat?.online));
  await game.apply(host, "start");
  const bidder = game.players.find((player) => player.view.seat === host.view.turn);
  await waitFor(() => bidder.view.revision === host.view.revision);
  const body = { revision: bidder.view.revision, turnVersion: bidder.view.turnVersion, action: "bid", value: 3 };
  const guest = game.actor("Waiting guest");
  await game.join(guest);
  await waitFor(() => bidder.view.revision > body.revision);
  assert.equal(bidder.view.turnVersion, body.turnVersion);
  bidder.socket.send("sync:1");
  await waitFor(() => bidder.synced?.sync === "1");
  assert.ok(Math.abs(Date.now() - bidder.synced.now) < 1000);
  const key = randomUUID();
  bidder.socket.send(JSON.stringify({ ...body, key }));
  await waitFor(() => bidder.replies.has(key));
  assert.deepEqual(bidder.replies.get(key), { ack: key });
  await waitFor(() => host.view.turnVersion > body.turnVersion);
  await game.bidAll(game.players, [2]);
  const after = host.view.revision;
  assert.equal((await game.request(`${game.path}/command`, { body, key, player: bidder })).status, 200);
  const stale = await game.request(`${game.path}/command`, { body, player: bidder });
  assert.equal(stale.status, 409);
  assert.equal(host.view.revision, after);
});

test("watching an idle table does not keep it alive", { timeout: 30_000 }, async (t) => {
  const worker = await localWorker({ idleSeconds: 2 });
  t.after(() => worker.dispose());
  await worker.start();
  const game = harness(t, worker.origin);
  await game.setup();
  const host = game.players[0];
  const expiry = host.view.expiresAt;
  host.socket.send("ping");
  host.socket.send("presence");
  await wait(400);
  assert.equal(host.view.expiresAt, expiry);
  await wait(Math.max(expiry - Date.now(), 0) + 250);
  const response = await game.request(game.path);
  assert.ok([404, 410].includes(response.status));
});

test("configured timers pause for an offline player and make legal automatic bids and card plays", { timeout: 40_000 }, async (t) => {
  const worker = await localWorker();
  t.after(() => worker.dispose());
  await worker.start();
  const game = harness(t, worker.origin);
  const [host, ...guests] = game.players;
  await game.setup({ bidSeconds: 3, playSeconds: 3, weights: [10, 20, 30], stake: 2, minimumBid: 10 });
  for (const guest of guests) await game.join(guest);
  await waitFor(() => host.view.seats.every((seat) => seat?.online));
  await game.apply(host, "start");
  assert.equal(host.view.clock.limitMs, 3000);
  const expiry = host.view.expiresAt;
  const pausedRevision = host.view.revision;
  guests[0].socket.close();
  await waitFor(() => host.view.clock?.deadline === null);
  assert.ok(host.view.clock.remainingMs > 0);
  await wait(3200);
  assert.equal(host.view.revision, pausedRevision);
  assert.equal(host.view.lastAuto, undefined);

  await guests[0].connect();
  await waitFor(() => host.view.lastAuto?.action === "bid");
  assert.ok(host.view.lastAuto.value >= 1 && host.view.lastAuto.value <= 4);
  assert.equal(host.view.expiresAt, expiry);
  const initialLedger = (await game.request(`${game.ledger}/snapshot`)).data.game;
  assert.equal(initialLedger.minimumBid, 10);
  assert.deepEqual(initialLedger.settlementConfig, { weights: [10, 20, 30], stake: 2 });
  await game.bidAll(game.players, [4, 3, 3]);
  const actor = game.players.find((player) => player.view.seat === host.view.turn);
  await waitFor(() => actor.view.legal.length > 0);
  const legal = actor.view.legal;
  const playingExpiry = host.view.expiresAt;
  await waitFor(() => host.view.lastAuto?.action === "play");
  assert.equal(host.view.lastAuto.seat, actor.view.seat);
  assert.ok(legal.includes(host.view.lastAuto.value));
  assert.equal(host.view.expiresAt, playingExpiry);
  await waitFor(() => actor.view.hand.length === 12);
});
