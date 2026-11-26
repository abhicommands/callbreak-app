import { assert } from "../utils/errors.js";
import { validAmount } from "../utils/gameLogic.js";

export const PACE_OPTIONS = {
  Fast: { bidSeconds: 8, playSeconds: 5 },
  Standard: { bidSeconds: 20, playSeconds: 15 },
  Relaxed: { bidSeconds: 35, playSeconds: 25 },
  Untimed: { bidSeconds: 0, playSeconds: 0 },
};

export const PAYOUT_OPTIONS = [[1, 2, 3], [5, 10, 15], [10, 20, 30]];
export const DEFAULT_MINIMUM_BID = 9;

export function validMinimumBid(value) {
  return Number.isInteger(value) && value >= 4 && value <= 13;
}

export function tableSettings(settings = {}) {
  const { bidSeconds = PACE_OPTIONS.Standard.bidSeconds, playSeconds = PACE_OPTIONS.Standard.playSeconds,
    weights = PAYOUT_OPTIONS[0], stake = 1, minimumBid = DEFAULT_MINIMUM_BID } = settings;
  assert([bidSeconds, playSeconds].every((value) =>
    value === 0 || (Number.isInteger(value) && value >= 3 && value <= 120)),
  400, "Turn timers must be off or between 3 and 120 seconds.");
  assert(Array.isArray(weights) && weights.length === 3 && weights.every((weight) => validAmount(weight)),
    400, "Enter three payout values from 0 to 10000 with up to three decimals.");
  assert(validAmount(stake, 0.001), 400, "Enter a positive stake up to 10000 with up to three decimals.");
  assert(validMinimumBid(minimumBid), 400, "The minimum combined bid must be between 4 and 13.");
  return { bidSeconds, playSeconds, weights, stake, minimumBid };
}
