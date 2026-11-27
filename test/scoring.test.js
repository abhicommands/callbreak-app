import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCommand, createGame, getSummary } from "../server/src/services/gameService.js";
import { calcPoints, computeFinalSettlement } from "../server/src/utils/gameLogic.js";

const config = { name: "Ledger", players: ["A", "B", "C", "D"], weights: [1, 2, 3] };
const seats = (a, b, c, d) => ({ 1: a, 2: b, 3: c, 4: d });
const create = (fields = {}) => createGame("series", { ...config, ...fields }, 1);
const run = (game, action, body) => applyCommand(game, action, body, 2);

test("scores in tenths and projects several pending regular calls", () => {
  const game = create();
  run(game, "set-bids", { round: 1, bids: seats(4, 2, 2, 2) });
  run(game, "set-actuals", { round: 1, actuals: seats(5, 2, 3, 3) });
  run(game, "set-bids", { round: 2, bids: seats(4, 1, 1, 1) });
  run(game, "set-bids", { round: 3, bids: seats(4, 2, 2, 2) });
  assert.equal(getSummary(game).totalsPoints[1], 8.2);
  assert.equal(getSummary(game).projectedPoints[1], 12.2);
  run(game, "set-bids", { round: 5, bids: seats(2, 1, 1, 1) });
  assert.equal(getSummary(game).projectedPoints[1], 14.2);
  assert.equal(game.roundData[5].status, "BIDS_SET");
  run(game, "set-actuals", { round: 3, actuals: seats(3, 4, 3, 3) });
  assert.equal(getSummary(game).totalsPoints[1], 4.2);
  assert.equal(getSummary(game).projectedPoints[1], 6.2);
  assert.equal(calcPoints(4, 3), -4);
  assert.equal(calcPoints(4, 6), 4.2);
});

test("perfect calls are derived from the current saved scores and auto-awards", () => {
  const game = create();
  run(game, "set-bids", { round: 1, bids: seats(2, 2, 2, 2) });
  run(game, "set-bids", { round: 2, bids: seats(4, 3, 3, 3) });
  const entry = { round: 2, actuals: seats(4, 3, 3, 3) };
  run(game, "set-actuals", entry);
  run(game, "set-actuals", entry);
  assert.deepEqual(getSummary(game).perfectCounts, seats(2, 2, 2, 2));
  run(game, "set-actuals", { round: 2, actuals: seats(5, 2, 3, 3) });
  assert.deepEqual(getSummary(game).perfectCounts, seats(1, 1, 2, 2));
  run(game, "set-bids", { round: 2, bids: seats(4, 3, 3, 3) });
  assert.deepEqual(getSummary(game).perfectCounts, seats(1, 1, 1, 1));
});

function setScores(game, perPlayer) {
  for (let round = 1; round <= 5; round++) {
    const points = Object.fromEntries(perPlayer.map((scores, index) => [String(index + 1), scores[round - 1]]));
    game.roundData[round] = { status: "PLAYED", points, bids: seats(2, 2, 2, 2), actuals: seats(4, 3, 3, 3) };
  }
}

test("settlement prioritizes the shuffled sequence and then identical scores", () => {
  const game = create();
  setScores(game, [[3, 1, 5, 2, 4], [2, 2, 2, 2, 2], [5, 7, 5, 6, 7], [1, 2.1, 3, 4, 5]]);
  const result = computeFinalSettlement(game);
  assert.deepEqual(result.ranking.map(({ id }) => id), ["1", "2", "3", "4"]);
});

test("winner and loser multipliers use strict boundaries and balances carry exactly", () => {
  const game = create({ weights: [0.1, 2.123, 3], stake: 0.123 });
  setScores(game, [[4, 4, 4, 3, 5], [2, 2, 2, 3, 1], [1, 1, 1, -1, -2], [-1, -2, -3, 2, 1]]);
  const at20 = computeFinalSettlement(game);
  assert.equal(at20.ranking[0].total, 20);
  assert.deepEqual(at20.payouts.map(({ units }) => units), [0.1, 2.123, 6]);
  game.roundData[1].points[1] = 4.1;
  const above20 = computeFinalSettlement(game);
  assert.equal(above20.winnerOver20, true);
  assert.deepEqual(above20.payouts.map(({ units }) => units), [0.2, 4.246, 12]);
  assert.deepEqual(above20.perPlayerDelta, seats(2.022858, -0.0246, -0.522258, -1.476));

  run(game, "resolve-game", {});
  const before = getSummary(game).payouts;
  run(game, "resolve-game", {});
  assert.deepEqual(getSummary(game).payouts, before);
  const next = run(game, "next-game", {});
  assert.equal(next.roundInfo[1].dealerId, "4");
  assert.deepEqual(getSummary(next).payouts, before);
  assert.deepEqual(getSummary(next).totalsPoints, seats(0, 0, 0, 0));
});

test("pregame bench substitutions retain the replaced seat's rotation and balances", () => {
  const game = create({ startDealerIndex: 2 });
  assert.deepEqual(Object.values(game.roundInfo).map((info) => info.dealerId), ["3", "4", "1", "2", "3"]);
  game.balanceUnits[3] = -150_000;
  game.balanceUnits[1] = 150_000;
  run(game, "substitute", { outgoingPlayerId: "3", incomingName: "E" });
  assert.equal(game.roundInfo[1].dealerId, "5");
  assert.equal(game.inactivePlayers[0].id, "3");
  assert.equal(getSummary(game).payouts[3], -0.15);
  run(game, "substitute", { outgoingPlayerId: "5", incomingPlayerId: "3" });
  assert.equal(game.roundInfo[1].dealerId, "3");
  run(game, "set-bids", { round: 1, bids: seats(4, 3, 3, 3) });
  run(game, "set-actuals", { round: 1, actuals: seats(4, 3, 3, 3) });
  assert.equal(getSummary(game).perfectCounts[5], 0);
});
