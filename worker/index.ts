import { DurableObject } from "cloudflare:workers";
import {
  applyCommand,
  createGame,
  getSummary,
  historyFor,
  publicGame,
} from "../server/src/services/gameService.js";
import { HttpError, assert } from "../server/src/utils/errors.js";
import {
  asObject, bearer, credential, digest, eventFromExport, failure, json, matches, payloadFor, readJson,
  type Event,
} from "./protocol";

interface Env {
  LEDGER: DurableObjectNamespace<Ledger>;
  LEDGER_IDLE_SECONDS?: string;
}

type Game = ReturnType<typeof createGame>;
type LedgerRow = { revision: number; editor: string; recovery: string; game: string };
type GameMetadata = { gameId: string; gameIndex: number; createdAt: number; settlementApplied: boolean };
type AuditRow = { revision: number; action: string; payload: string; at: number };
type Receipt = { revision: number; fingerprint: string };

const ROUTE = /^\/api\/ledger\/([a-f0-9]{32})(?:\/(snapshot|socket|command|setup|editor|recover|export|history)(?:\/([1-9][0-9]*))?)?$/;
const FORMAT = "callbreak-ledger";
const VERSION = 1;
const MAX_EVENTS = 5_000;
const BACKUP_BYTES = 4 * 1024 * 1024;
const IDLE_SECONDS = 24 * 60 * 60;
const EXPIRY_KEY = "expiresAt";
const EXPIRED_MESSAGE = "This ledger expired. Restore a backup from the home page to continue.";

function snapshot(game: Game, revision: number, expiresAt: number | null) {
  return { version: VERSION, revision, expiresAt, game: publicGame(game), summary: getSummary(game) };
}

function parseGame(data: string): Game {
  return JSON.parse(data);
}

export class Ledger extends DurableObject<Env> {
  private get sql() {
    return this.ctx.storage.sql;
  }

  private initializeSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL,
        editor TEXT NOT NULL, recovery TEXT NOT NULL, game TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        game_index INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, game TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        revision INTEGER PRIMARY KEY, action TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipt (
        command_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, fingerprint TEXT NOT NULL
      );
    `);
  }

  private findLedger() {
    const schema = this.sql.exec("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'ledger'");
    if (!schema.toArray().length) return undefined;
    return this.sql.exec<LedgerRow>("SELECT revision, editor, recovery, game FROM ledger WHERE id = 1").toArray()[0];
  }

  private expiresAt() {
    return this.ctx.storage.kv.get<number>(EXPIRY_KEY) ?? null;
  }

  private requireActive(expiresAt: number | null) {
    if (expiresAt !== null && expiresAt <= Date.now()) throw new HttpError(410, EXPIRED_MESSAGE);
  }

  private requireLedger() {
    const row = this.findLedger();
    if (!row) throw new HttpError(404, "Ledger not found.");
    this.requireActive(this.expiresAt());
    return row;
  }

  async alarm() {
    const expiresAt = this.expiresAt();
    if (expiresAt === null) return;
    if (expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }

    const sockets = this.ctx.getWebSockets();
    await this.ctx.storage.deleteAll();
    for (const socket of sockets) {
      try {
        socket.close(4004, "Ledger expired");
      } catch {
        // The client may already have disconnected.
      }
    }
  }

  private recordEvent(event: Event) {
    this.sql.exec("INSERT INTO audit VALUES (?, ?, ?, ?)", event.revision, event.action,
      JSON.stringify(event.payload), event.at);
  }

  private archive(game: Game) {
    this.sql.exec("INSERT INTO history VALUES (?, ?, ?)", game.gameIndex, game.createdAt, JSON.stringify(game));
  }

  private broadcast(view: ReturnType<typeof snapshot>) {
    const message = JSON.stringify(view);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A disconnected client fetches a snapshot when it reconnects.
      }
    }
  }

  private openSocket(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required." }, 426);
    }
    const row = this.requireLedger();
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(snapshot(parseGame(row.game), row.revision, this.expiresAt())));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Read-only connection");
  }

  private history(gameId?: string) {
    const active = parseGame(this.requireLedger().game);
    if (gameId) {
      if (active.gameId === gameId) return json(historyFor(active));
      const [entry] = this.sql.exec<{ game: string }>("SELECT game FROM history WHERE game_index = ?", gameId);
      if (!entry) return json({ error: "Settled game not found." }, 404);
      return json(historyFor(parseGame(entry.game)));
    }
    const archives = this.sql.exec<{ game_index: number; created_at: number }>(
      "SELECT game_index, created_at FROM history ORDER BY game_index",
    );
    const games: GameMetadata[] = Array.from(archives, ({ game_index, created_at }) => ({
      gameId: String(game_index), gameIndex: game_index, createdAt: created_at, settlementApplied: true,
    }));
    const { gameIndex, createdAt, settlementApplied } = active;
    games.push({ gameId: active.gameId, gameIndex, createdAt, settlementApplied });
    return json({ currentGameId: active.gameId, games });
  }

  private async editorRead(request: Request, route: string) {
    const verifier = await digest(bearer(request));
    assert(matches(verifier, this.requireLedger().editor), 403, "A valid editor credential is required.");
    if (route === "editor") return json({ authorized: true });
    const events = Array.from(this.sql.exec<AuditRow>("SELECT * FROM audit ORDER BY revision"), (row) =>
      ({ ...row, payload: JSON.parse(row.payload) }));
    return json({ format: FORMAT, version: VERSION, events });
  }

  private restore(seriesId: string, payload: unknown) {
    const { format, version, events } = asObject(payload, ["format", "version", "events"]);
    if (format !== FORMAT || version !== VERSION || !Array.isArray(events) ||
        !events.length || events.length > MAX_EVENTS) {
      throw new HttpError(400, "Unsupported or oversized ledger backup.");
    }
    let active: Game | undefined;
    const archives: Game[] = [];
    const checked = events.map(eventFromExport);
    for (const { action, payload, at } of checked) {
      if (!active) active = createGame(seriesId, payload, at);
      else if (action !== "recover") {
        const next = applyCommand(active, action, payload, at);
        if (next !== active) archives.push(active);
        active = next;
      }
    }
    if (!active) throw new HttpError(400, "Backup is empty.");
    return { active, archives, events: checked };
  }

  private async write(request: Request, seriesId: string, route: string) {
    const key = request.headers.get("idempotency-key");
    if (!key || !/^[a-f0-9-]{16,64}$/.test(key)) throw new HttpError(400, "Provide an idempotency key.");
    const token = bearer(request);
    const { raw, data } = await readJson(request, route === "setup" ? BACKUP_BYTES : 16_384);
    const { expectedRevision, action, payload, recoveryKey, newEditorKey } = asObject(data,
      route === "setup" ? ["expectedRevision", "action", "payload", "recoveryKey"] :
        route === "recover" ? ["expectedRevision", "newEditorKey"] :
          ["expectedRevision", "action", "payload"]);
    if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, "Provide a valid expected revision.");
    }
    const [verifier, fingerprint, replacement] = await Promise.all([
      digest(token),
      digest(route + "\n" + raw),
      route === "setup" ? digest(credential(recoveryKey)) :
        route === "recover" ? digest(credential(newEditorKey)) : Promise.resolve(null),
    ]);
    if (replacement) assert(!matches(verifier, replacement), 400, "Use separate editor and recovery credentials.");

    const result = await this.ctx.storage.transaction(async (txn) => {
      const row = this.findLedger();
      const currentExpiry = row ? this.expiresAt() : null;
      if (row) {
        this.requireActive(currentExpiry);
        assert(matches(verifier, route === "recover" ? row.recovery : row.editor), 403, "Invalid credential.");
        const [receipt] = this.sql.exec<Receipt>("SELECT revision, fingerprint FROM receipt WHERE command_key = ?", key);
        if (receipt) {
          assert(matches(fingerprint, receipt.fingerprint), 409, "Idempotency key already used for a different request.");
          return {
            view: snapshot(parseGame(row.game), row.revision, currentExpiry),
            committedRevision: receipt.revision,
            replayed: true,
          };
        }
      }
      const previous = row?.revision ?? 0;
      if (previous !== expectedRevision) {
        throw new HttpError(409, "The ledger changed. Review the latest scores and try again.",
          { code: "STALE_REVISION", revision: previous });
      }
      assert(previous < MAX_EVENTS, 409, "This ledger has reached its command limit.");
      const at = Date.now();
      const idleSeconds = Number(this.env.LEDGER_IDLE_SECONDS ?? IDLE_SECONDS);
      assert(Number.isSafeInteger(idleSeconds) && idleSeconds > 0 && idleSeconds <= IDLE_SECONDS,
        500, "Invalid ledger expiration configuration.");
      const expiresAt = at + idleSeconds * 1000;
      let revision = previous + 1;
      let game;
      if (route === "setup") {
        assert(!row && replacement, 409, "Ledger already exists.");
        this.initializeSchema();
        if (action === "restore") {
          const restored = this.restore(seriesId, payload);
          game = restored.active;
          revision = restored.events.length;
          for (const archived of restored.archives) this.archive(archived);
          for (const event of restored.events) this.recordEvent(event);
        } else {
          assert(action === "create", 400, "Choose create or restore.");
          const fields = payloadFor("create", payload);
          game = createGame(seriesId, fields, at);
          this.recordEvent({ revision, action: "create", payload: fields, at });
        }
        this.sql.exec("INSERT INTO ledger VALUES (1, ?, ?, ?, ?)", revision, verifier, replacement!, JSON.stringify(game));
      } else {
        if (!row) throw new HttpError(404, "Ledger not found.");
        const active = parseGame(row.game);
        if (route === "recover") {
          game = active;
          this.recordEvent({ revision, action: "recover", payload: {}, at });
          this.sql.exec("UPDATE ledger SET editor = ?, revision = ? WHERE id = 1", replacement!, revision);
        } else {
          if (typeof action !== "string") throw new HttpError(400, "Provide a ledger command.");
          const fields = payloadFor(action, payload);
          game = applyCommand(active, action, fields, at);
          if (game !== active) this.archive(active);
          this.recordEvent({ revision, action, payload: fields, at });
          this.sql.exec("UPDATE ledger SET revision = ?, game = ? WHERE id = 1", revision, JSON.stringify(game));
        }
      }
      this.sql.exec("INSERT INTO receipt VALUES (?, ?, ?)", key, revision, fingerprint);
      this.ctx.storage.kv.put(EXPIRY_KEY, expiresAt);
      // The first alarm and the ledger commit are atomic. Later saves move the deadline;
      // the existing alarm wakes up at its original time and rechecks the saved deadline.
      if (currentExpiry === null) await txn.setAlarm(expiresAt);
      return { view: snapshot(game, revision, expiresAt), committedRevision: revision, replayed: false };
    });

    if (!result.replayed) this.broadcast(result.view);
    return json(result, route === "setup" && !result.replayed ? 201 : 200);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const match = new URL(request.url).pathname.match(ROUTE);
      if (!match) return json({ error: "Route not found." }, 404);
      const [, seriesId, route = "snapshot", gameId] = match;
      if (gameId && route !== "history") return json({ error: "Route not found." }, 404);
      if (request.method === "GET") {
        if (route === "socket") return this.openSocket(request);
        if (route === "history") return this.history(gameId);
        if (route === "editor" || route === "export") return await this.editorRead(request, route);
        if (route === "snapshot") {
          const row = this.requireLedger();
          return json(snapshot(parseGame(row.game), row.revision, this.expiresAt()));
        }
      }
      if (request.method === "POST" && ["setup", "command", "recover"].includes(route)) {
        return await this.write(request, seriesId, route);
      }
      return json({ error: "Method or route not supported." }, 405);
    } catch (error) {
      return failure(error);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(ROUTE);
    if (!match) return json({ error: "API route not found." }, 404);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin && (request.method !== "GET" || match[2] === "socket")) {
      return json({ error: "Use the ledger origin." }, 403);
    }
    try {
      return await env.LEDGER.get(env.LEDGER.idFromName(match[1])).fetch(request);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
