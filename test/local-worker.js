import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function localWorker({ idleSeconds } = {}) {
  const persistence = await mkdtemp(join(tmpdir(), "callbreak-worker-"));
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));

  const origin = `http://127.0.0.1:${port}`;
  const detached = process.platform !== "win32";
  let child;

  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    if (detached) process.kill(-child.pid, "SIGTERM");
    else child.kill();
    await exited;
    child = undefined;
  }

  return {
    origin,
    async start() {
      let output = "";
      child = spawn(process.execPath, [
        "node_modules/wrangler/bin/wrangler.js", "dev", "--env", "", "--local",
        "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", persistence,
        ...(idleSeconds ? ["--var", `LEDGER_IDLE_SECONDS:${idleSeconds}`] : []),
      ], {
        cwd: root, detached, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      });
      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
      }

      for (let attempt = 0; attempt < 160 && child.exitCode === null; attempt++) {
        try {
          const response = await fetch(`${origin}/api/healthcheck`, { signal: AbortSignal.timeout(500) });
          if (response.status === 404 && (await response.json()).error === "API route not found.") return;
        } catch {
          // Retry until Wrangler starts serving the Worker.
        }
        await wait(150);
      }
      throw new Error(`Wrangler failed to start.\n${output}`);
    },
    stop,
    async dispose() {
      await stop();
      await rm(persistence, { recursive: true, force: true });
    },
  };
}
