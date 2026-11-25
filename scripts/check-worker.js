import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";

export async function checkWorker(origin) {
  for (const path of ["/", "/ledger/00000000000000000000000000000000"]) {
    const response = await fetch(new URL(path, origin), {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200, `Expected the app shell at ${path}`);
    assert.match(await response.text(), /<title>Callbreak Ledger<\/title>/);
  }

  const response = await fetch(new URL("/api/healthcheck", origin), { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 404, "Expected an API response for an unknown endpoint.");
  assert.deepEqual(await response.json(), { error: "API route not found." });
}

if (import.meta.main) {
  const origin = new URL(process.argv[2]);
  for (let attempt = 1; ; attempt++) {
    try {
      await checkWorker(origin);
      console.log(`Smoke test passed at ${origin.origin}`);
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await wait(3000);
    }
  }
}
