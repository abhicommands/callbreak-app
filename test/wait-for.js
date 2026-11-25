import { setTimeout as wait } from "node:timers/promises";

export async function waitFor(predicate, timeout = 5000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (predicate()) return;
    await wait(25);
  }
  throw new Error("Timed out waiting for the expected update.");
}
