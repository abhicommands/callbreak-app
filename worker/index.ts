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
  type Event, type Payload,
} from "./protocol";
import { OnlineTable, TABLE_KEY, TABLE_ROUTE } from "./onlineTable";

interface Env {
  LEDGER: DurableObjectNamespace<Ledger>;
  LEDGER_IDLE_SECONDS?: string;
}

type Game = ReturnType<typeof createGame>;
type LedgerRow = { revision: number; editor: string; recovery: string; game: string };
type AuditRow = { revision: number; action: string; payload: string; at: number };
type Receipt = { revision: number; fingerprint: string };

const ROUTE = /^\/api\/ledger\/([a-f0-9]{32})(?:\/(snapshot|socket|command|setup|editor|recover|export|history|visit)(?:\/([1-9][0-9]*))?)?$/;
const FORMAT = "callbreak-ledger";
const VERSION = 1;
const MAX_EVENTS = 5_000;
const BACKUP_BYTES = 4 * 1024 * 1024;
const IDLE_SECONDS = 7 * 24 * 60 * 60;
const EXPIRY_KEY = "expiresAt";
const EXPIRED_MESSAGE = "This ledger expired. Restore a backup from the home page to continue.";

function snapshot(game: Game, revision: number, expiresAt: number | null, onlineTable = false) {
  return { version: VERSION, revision, expiresAt, game: publicGame(game), summary: getSummary(game),
    ...(onlineTable ? { onlineTable } : {}) };
}

function parseGame(data: string): Game {
  return JSON.parse(data);
}

export class Ledger extends DurableObject<Env> {
  private table = new OnlineTable(this.ctx, {
    exists: () => Boolean(this.findLedger()),
    expiresAt: () => this.expiresAt(),
    refresh: (txn, at) => this.refreshExpiry(txn, at, this.expiresAt()),
    schedule: async (txn, deadline) => {
      const expiry = this.expiresAt();
      if (expiry === null) return;
      const next = Math.min(expiry, deadline ?? expiry);
      if (next !== await txn.getAlarm()) await txn.setAlarm(next);
    },
    write: (seriesId, action, payload, at) => this.writeOnlineLedger(seriesId, action, payload, at),
    publish: () => {
      const row = this.requireLedger();
      this.broadcast(snapshot(parseGame(row.game), row.revision, this.expiresAt(), true));
    },
    backup: () => this.backup(),
    snapshot: () => {
      const row = this.findLedger();
      return row ? snapshot(parseGame(row.game), row.revision, this.expiresAt(), true) : null;
    },
    pendingTie: () => {
      const row = this.findLedger();
      return Boolean(row && getSummary(parseGame(row.game)).pendingTie.length);
    },
  });

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

  private async refreshExpiry(txn: DurableObjectTransaction, at: number, current: number | null) {
    const idleSeconds = Number(this.env.LEDGER_IDLE_SECONDS ?? IDLE_SECONDS);
    assert(Number.isSafeInteger(idleSeconds) && idleSeconds > 0 && idleSeconds <= IDLE_SECONDS,
      500, "Invalid ledger expiration configuration.");
    const expiresAt = at + idleSeconds * 1000;
    this.ctx.storage.kv.put("retentionVersion", 2);
    this.ctx.storage.kv.put(EXPIRY_KEY, expiresAt);
    // The first alarm is committed with the saved state. Later saves only move the deadline.
    if (current === null) await txn.setAlarm(expiresAt);
    return expiresAt;
  }

  private extendLegacyDeadline() {
    const previous = this.expiresAt();
    if (previous && !this.env.LEDGER_IDLE_SECONDS && !this.ctx.storage.kv.get("retentionVersion")) {
      this.ctx.storage.kv.put(EXPIRY_KEY, previous + 6 * 86_400_000);
      this.ctx.storage.kv.put("retentionVersion", 2);
    }
  }

  async alarm() {
    return this.ctx.blockConcurrencyWhile(() => this.handleAlarm());
  }

  private async handleAlarm() {
    this.extendLegacyDeadline();
    const expiresAt = this.expiresAt();
    if (expiresAt === null) return;
    if (expiresAt > Date.now()) {
      if (this.table.room) return this.table.alarm();
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }

    const kept = await this.ctx.storage.transaction(async (txn) => {
      const deadline = this.expiresAt();
      if (deadline === null || deadline > Date.now()) return true;
      const row = this.findLedger();
      if (row && Object.values(parseGame(row.game).balanceUnits).some(Boolean)) {
        const game = parseGame(row.game);
        if (!game.settlementApplied && !("closedAt" in game) && !("settlementSkipped" in game) && !getSummary(game).pendingTie.length) {
          this.writeOnlineLedger(game.seriesId, "close-group-game", {}, Date.now());
        }
        this.table.closeForGroup();
        this.ctx.storage.kv.delete(EXPIRY_KEY);
        await txn.deleteAlarm();
        return true;
      }
      return false;
    });
    if (kept) {
      this.table.notify();
      const row = this.findLedger();
      if (row) this.broadcast(snapshot(parseGame(row.game), row.revision, this.expiresAt(), Boolean(this.table.room)));
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

  private recordEvent(event: Event, restoring = false) {
    const used = this.ctx.storage.kv.get<number>("exportBytes") ?? this.sql.exec<{bytes: number}>(
      "SELECT coalesce(sum(length(cast(json_object('revision',revision,'action',action,'payload',json(payload),'at',at) as blob))+1),0) AS bytes FROM audit"
    ).one().bytes;
    const bytes = used + new TextEncoder().encode(JSON.stringify(event)).length + 1;
    const closing = ["mark-paid", "finish-group-game", "close-group-game"].includes(event.action);
    const reserve = closing || restoring ? 0 : 3;
    assert(event.revision <= MAX_EVENTS - reserve && (restoring || bytes <= BACKUP_BYTES - 512 - reserve * 128),
      409, "This group has reached its history limit. Export its ledger before starting a new group.");
    this.ctx.storage.kv.put("exportBytes", bytes);
    this.sql.exec("INSERT INTO audit VALUES (?, ?, ?, ?)", event.revision, event.action,
      JSON.stringify(event.payload), event.at);
  }

  private archive(game: Game) {
    this.sql.exec("INSERT INTO history VALUES (?, ?, ?)", game.gameIndex, game.createdAt, JSON.stringify(game));
  }

  private broadcast(view: ReturnType<typeof snapshot>) {
    const message = JSON.stringify(view);
    for (const socket of this.ctx.getWebSockets()) {
      if (this.table.ownsSocket(socket)) continue;
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
    server.send(JSON.stringify(snapshot(parseGame(row.game), row.revision, this.expiresAt(), Boolean(this.table.room))));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (this.table.ownsSocket(socket)) return this.table.socketMessage(socket, message);
    socket.close(1008, "Read-only connection");
  }

  webSocketClose(socket: WebSocket, code: number) {
    if (socket.readyState === WebSocket.CLOSING) {
      socket.close(code === 1005 || code === 1006 ? undefined : code);
    }
    if (this.table.ownsSocket(socket)) return this.table.socketClosed(socket);
  }

  webSocketError(socket: WebSocket) {
    if (this.table.ownsSocket(socket)) return this.table.socketClosed(socket);
  }

  private history(gameId?: string, before?: number) {
    const active = parseGame(this.requireLedger().game);
    if (gameId) {
      if (active.gameId === gameId) return json(historyFor(active));
      const [entry] = this.sql.exec<{ game: string }>("SELECT game FROM history WHERE game_index = ?", gameId);
      if (!entry) return json({ error: "Settled game not found." }, 404);
      return json(historyFor(parseGame(entry.game)));
    }
    const limit = before === undefined ? MAX_EVENTS : 25;
    const rows = this.sql.exec<{ game_index: number; created_at: number; status: string }>(
      `SELECT game_index, created_at, CASE WHEN json_extract(game,'$.settlementApplied') THEN 'Posted'
        WHEN json_extract(game,'$.settlementSkipped') THEN 'Payout skipped' ELSE 'Ended' END AS status
        FROM history WHERE game_index < ? ORDER BY game_index DESC LIMIT ?`, before ?? Number.MAX_SAFE_INTEGER, limit + 1,
    ).toArray();
    const entries = rows.slice(0, limit);
    const games = entries.map(({ game_index, created_at, status }) => ({
      gameId: String(game_index), gameIndex: game_index, createdAt: created_at, status, settlementApplied: status === "Posted",
    })).reverse();
    const status = active.settlementApplied ? "Posted" : "settlementSkipped" in active && active.settlementSkipped ?
      "Payout skipped" : "closedAt" in active ? "Ended" : getSummary(active).pendingTie.length ? "Awaiting tie decision" : "In progress";
    if (before === undefined || active.gameIndex < before) games.push({ gameId: active.gameId, gameIndex: active.gameIndex,
      createdAt: active.createdAt, settlementApplied: active.settlementApplied, status });
    return json({ currentGameId: active.gameId, games, nextBefore: rows.length > limit ? entries.at(-1)?.game_index : null });
  }

  private async editorRead(request: Request, route: string) {
    const verifier = await digest(bearer(request));
    const row = this.requireLedger();
    assert(matches(verifier, this.table.room?.host ?? row.editor), 403, "A valid editor credential is required.");
    if (route === "editor") return json({ authorized: true, hostId: Object.entries(this.table.memberTokens()).find(([, code]) => code === verifier)?.[0] });
    return this.backup();
  }

  private backup() {
    const events = Array.from(this.sql.exec<AuditRow>("SELECT * FROM audit ORDER BY revision"), (row) =>
      ({ ...row, payload: JSON.parse(row.payload) }));
    return json({ format: FORMAT, version: VERSION, events });
  }

  private writeOnlineLedger(seriesId: string, action: string, payload: Payload, at: number) {
    const row = this.findLedger();
    const revision = (row?.revision ?? 0) + 1;
    const fields = payloadFor(action, payload);
    if (action === "create") {
      assert(!row, 409, "This ledger already exists.");
      this.initializeSchema();
      const game = createGame(seriesId, fields, at);
      this.sql.exec("INSERT INTO ledger VALUES (1, ?, '', '', ?)", revision, JSON.stringify(game));
    } else {
      if (!row) throw new HttpError(404, "Ledger not found.");
      assert(revision + (action === "next-online-game" ? 32 : 0) <= MAX_EVENTS, 409, "This ledger has reached its history limit.");
      const active = parseGame(row.game);
      const game = applyCommand(active, action, fields, at);
      if (active !== game) this.archive(active);
      this.sql.exec("UPDATE ledger SET revision = ?, game = ? WHERE id = 1", revision, JSON.stringify(game));
    }
    this.recordEvent({ revision, action, payload: fields, at });
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
      const room = this.table.room;
      if (room) assert(route === "command" && ["group-next", "mark-paid"].includes(String(action)), 409,
        "This ledger is updated by the online table.");
      const row = this.findLedger();
      const currentExpiry = row ? this.expiresAt() : null;
      if (row) {
        this.requireActive(currentExpiry);
        assert(matches(verifier, route === "recover" ? row.recovery : room?.host ?? row.editor), 403, "Invalid credential.");
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
          for (const event of restored.events) this.recordEvent(event, true);
        } else {
          assert(action === "create", 400, "Choose create or restore.");
          const fields = payloadFor("create", payload);
          assert(fields.mode === undefined, 400, "Create online ledgers from the table.");
          game = createGame(seriesId, fields, at);
          this.recordEvent({ revision, action: "create", payload: fields, at });
        }
        this.sql.exec("INSERT INTO ledger VALUES (1, ?, ?, ?, ?)", revision, verifier, replacement!, JSON.stringify(game));
      } else {
        if (!row) throw new HttpError(404, "Ledger not found.");
        const active = parseGame(row.game);
        if (route === "recover") {
          game = active;
          this.table.replaceMemberToken(row.editor, replacement!);
          this.recordEvent({ revision, action: "recover", payload: {}, at });
          this.sql.exec("UPDATE ledger SET editor = ?, revision = ? WHERE id = 1", replacement!, revision);
        } else {
          if (typeof action !== "string") throw new HttpError(400, "Provide a ledger command.");
          assert(!["record-online-round", "record-online-bids", "record-online-highbid", "abandon-online-round", "next-online-game",
            "start-online-side", "score-online-side", "close-online-side", "seat-online-game", "close-group-game"]
            .includes(action), 409, "Online games are recorded by the table.");
          if (action === "resolve-game") {
            assert(!getSummary(active).pendingTie.length, 409, "Choose a winner or split the tie in the ledger.");
          }
          const fields = payloadFor(action, payload);
          if (action === "finish-group-game") {
            assert(!room && !active.settlementApplied && !("closedAt" in active), 409, "This game is already finished.");
          }
          if (action === "group-next" && room) {
            assert(room.phase === "ended" || room.phase === "finished", 409, "Finish or end the table first.");
            if (room.phase === "ended" && !active.settlementApplied && !("settlementSkipped" in active) && !("closedAt" in active)) {
              applyCommand(active, "close-group-game", {}, at);
              this.recordEvent({ revision, action: "close-group-game", payload: {}, at });
              revision++;
            }
            this.table.remember(room);
          }
          game = applyCommand(active, action, fields, at);
          if (action === "group-next") {
            const host = room?.host ?? row.editor;
            const recovery = room?.recovery ?? row.recovery;
            this.sql.exec("UPDATE ledger SET editor = ?, recovery = ? WHERE id = 1", host, recovery);
            if (fields.mode === "online") {
              assert(game.players.some((p: {id: string}) => p.id === fields.hostId), 400, "Choose your seat.");
              const highestId = Math.max(...Object.keys(game.balanceUnits).map(Number), ...Object.keys(this.table.memberTokens()).map(Number));
              this.table.prepareGroup(seriesId, game.gameIndex, game.name, game.players, String(fields.hostId),
                host, recovery, fields.settings, highestId + 1);
            } else this.ctx.storage.kv.delete(TABLE_KEY);
          }
          if (game !== active) this.archive(active);
          this.recordEvent({ revision, action, payload: fields, at });
          this.sql.exec("UPDATE ledger SET revision = ?, game = ? WHERE id = 1", revision, JSON.stringify(game));
        }
      }
      this.sql.exec("INSERT INTO receipt VALUES (?, ?, ?)", key, revision, fingerprint);
      const expiresAt = await this.refreshExpiry(txn, at, currentExpiry);
      return { view: snapshot(game, revision, expiresAt, Boolean(this.table.room)), committedRevision: revision, replayed: false };
    });

    if (!result.replayed) {
      this.broadcast(result.view);
      if (this.table.room) this.table.notify();
      else if (action === "group-next") {
        for (const socket of this.ctx.getWebSockets("online-table")) socket.close(1000, "In-person game started");
      }
    }
    return json(result, route === "setup" && !result.replayed ? 201 : 200);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      this.extendLegacyDeadline();
      const deadline = this.expiresAt();
      if (deadline !== null && deadline <= Date.now()) {
        const row = this.findLedger();
        if (row && Object.values(parseGame(row.game).balanceUnits).some(Boolean)) {
          await this.ctx.blockConcurrencyWhile(() => this.handleAlarm());
        }
      }
      const { pathname } = new URL(request.url);
      const table = pathname.match(TABLE_ROUTE);
      if (table) return await this.table.fetch(request, table[1], table[2]);
      const match = pathname.match(ROUTE);
      if (!match) return json({ error: "Route not found." }, 404);
      const [, seriesId, route = "snapshot", gameId] = match;
      if (gameId && route !== "history") return json({ error: "Route not found." }, 404);
      if (route === "visit" && request.method === "POST") {
        const token = await digest(bearer(request));
        const room = this.table.room;
        const row = this.findLedger();
        const member = matches(token, room?.host ?? row?.editor ?? "") ||
          (room && room.phase !== "ended" && room.seats.some((p) => p?.token === token)) ||
          Object.values(this.table.memberTokens()).includes(token);
        assert(member, 403, "Open with a member or editor credential.");
        await this.ctx.storage.transaction(async (txn) => {
          const at = Date.now();
          const deadline = this.expiresAt();
          this.requireActive(deadline);
          if (!deadline || at - (this.ctx.storage.kv.get<number>("lastVisit") ?? 0) > 3_600_000) {
            this.ctx.storage.kv.put("lastVisit", at);
            await this.refreshExpiry(txn, at, deadline);
          }
        });
        return json({ expiresAt: this.expiresAt() });
      }
      if (request.method === "GET") {
        if (route === "socket") return this.openSocket(request);
        if (route === "history") {
          const before = new URL(request.url).searchParams.get("before");
          if (before !== null) assert(Number.isSafeInteger(Number(before)) && Number(before) > 0, 400, "Invalid history page.");
          return this.history(gameId, before === null ? undefined : Number(before));
        }
        if (route === "editor" || route === "export") return await this.editorRead(request, route);
        if (route === "snapshot") {
          const row = this.requireLedger();
          return json(snapshot(parseGame(row.game), row.revision, this.expiresAt(), Boolean(this.table.room)));
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
    const match = url.pathname.match(ROUTE) ?? url.pathname.match(TABLE_ROUTE);
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
