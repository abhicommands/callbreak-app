import { dealHands, legalCards, nextSeat, randomIndex, shuffled, winningPlay } from "../server/src/services/callbreakCards.js";
import { highBidResult, highBidSeatIndices } from "../server/src/services/gameService.js";
import { DEFAULT_MINIMUM_BID, tableSettings } from "../server/src/services/tableSettings.js";
import { HttpError, assert } from "../server/src/utils/errors.js";
import { asObject, bearer, credential, digest, json, matches, readJson, type Payload } from "./protocol";

export const TABLE_ROUTE = /^\/api\/table\/([a-f0-9]{32})(?:\/(setup|join|command|recover|socket|export))?$/;
export const TABLE_KEY = "onlineTable";
const SOCKET_TAG = "online-table";
const SOCKET_PROTOCOL = "callbreak";
const PENDING_MS = 10 * 60_000;
const PRESENCE_MS = 45_000;
const DELIVERY_GRACE_MS = 250;
const ROUNDS = 5;

type Player = { id: string; name: string; token: string };
type JoinRequest = { id: string; token: string; name: string; until: number };
type Play = { seat: number; card: string };
type CompletedTrick = { plays: Play[]; winner: number; winnerId: string; number: number; completedAt: number; automatic?: true };
type Clock = { deadline: number | null; remainingMs: number; limitMs: number };
type Deal = {
  hands: string[][]; bids: (number | null)[]; wins: number[]; turn: number;
  trick: Play[]; lastTrick: CompletedTrick | null; taken?: CompletedTrick[];
  attempts: number; previousBidTotal: number | null;
  clock?: Clock | null;
  lastAuto?: { seat: number; action: "bid" | "play"; value: number | string } | null;
  ledgerBids?: boolean;
  settledBids?: number[];
};
type Common = { name: string; host: string; recovery: string; revision: number; hasLedger: boolean };
type Active = Common & {
  phase: "lobby" | "bidding" | "playing" | "between" | "finished";
  seats: (Player | null)[]; pending: JoinRequest[]; round: number; dealer: number;
  deal: Deal | null; nextPlayer: number;
  seriesId?: string; gameIndex?: number; settings?: ReturnType<typeof tableSettings>;
  turnVersion?: number;
  lastCommand?: { token: string; key: string };
  recentMoves?: { token: string; key: string }[];
};
type Room = Active | (Common & { phase: "ended" });
type Attachment = { token: string; since: number };
type LedgerAccess = {
  exists(): boolean;
  expiresAt(): number | null;
  refresh(txn: DurableObjectTransaction, at: number): Promise<number>;
  schedule(txn: DurableObjectTransaction, deadline?: number | null): Promise<void>;
  write(id: string, action: string, payload: Payload, at: number): void;
  publish(): void;
  snapshot(): unknown;
  pendingTie(): boolean;
  backup(): Response;
};

const betweenDeals = (room: Active) => ["lobby", "between", "finished"].includes(room.phase);
const midDeal = (room: Active) => room.phase === "bidding" || room.phase === "playing";
const occupied = (room: Active) => room.seats.filter((player): player is Player => player !== null);
const allOnline = (room: Active, live: Set<string>) => room.seats.every((player) => player && live.has(player.token));
const rulesFor = (input: unknown) => tableSettings(input === undefined ? undefined :
  asObject(input, ["bidSeconds", "playSeconds", "weights", "stake", "minimumBid"]));
const turnClock = (room?: Room) => room && room.phase !== "ended" && midDeal(room) ? room.deal?.clock : null;
const turnVersion = (room: Active) => room.turnVersion ?? room.revision;
const alarmDeadline = (room: Room) => {
  const deadline = turnClock(room)?.deadline;
  return deadline == null ? deadline : deadline + DELIVERY_GRACE_MS;
};

function appendCard(deal: Deal, seat: number, card: string) {
  const hand = deal.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  deal.trick.push({ seat, card });
  deal.turn = nextSeat(seat);
}

function nameFor(input: unknown) {
  assert(typeof input === "string" && input.trim().length > 0 && input.trim().length <= 80,
    400, "Enter a name between 1 and 80 characters.");
  return (input as string).trim();
}

export class OnlineTable {
  constructor(private ctx: DurableObjectState, private ledger: LedgerAccess) {}

  get room() {
    return this.ctx.storage.kv.get<Room>(TABLE_KEY);
  }

  private requireRoom() {
    const room = this.room;
    if (!room) throw new HttpError(404, "Table not found. It may have expired.");
    const expiresAt = this.ledger.expiresAt();
    if (expiresAt !== null && expiresAt <= Date.now()) throw new HttpError(410, "This table expired.");
    return room;
  }

  private socketToken(socket: WebSocket) {
    return (socket.deserializeAttachment() as Attachment).token;
  }

  ownsSocket(socket: WebSocket) {
    return this.ctx.getTags(socket).includes(SOCKET_TAG);
  }

  private liveTokens(exclude?: WebSocket) {
    const now = Date.now();
    return new Set(this.ctx.getWebSockets(SOCKET_TAG).flatMap((socket) => {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) return [];
      const { token, since } = socket.deserializeAttachment() as Attachment;
      const seen = Math.max(since, this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0);
      return now - seen <= PRESENCE_MS ? [token] : [];
    }));
  }

  private view(room: Room, token: string, live: Set<string>) {
    const host = matches(token, room.host);
    const header = { name: room.name, revision: room.revision, phase: room.phase, host,
      hasLedger: room.hasLedger, expiresAt: this.ledger.expiresAt() };
    if (room.phase === "ended") return header;
    const seat = room.seats.findIndex((player) => player?.token === token);
    const online = room.seats.map((player) => Boolean(player && live.has(player.token)));
    const deal = room.deal;
    const canPlay = Boolean(deal && room.phase === "playing" && deal.turn === seat && online.every(Boolean));
    const now = Date.now();
    return {
      ...header, seat, turnVersion: turnVersion(room), round: room.round, dealer: room.dealer,
      gameIndex: room.gameIndex ?? Number(room.hasLedger),
      settings: room.settings, now,
      pending: room.pending.some((entry) => entry.token === token && entry.until > now),
      requests: host ? room.pending.filter((entry) => entry.until > now).map(({ id, name }) => ({ id, name })) : [],
      seats: room.seats.map((player, index) => player && {
        id: player.id, name: player.name, host: player.token === room.host, online: online[index],
        bid: deal?.bids[index] ?? null, wins: deal?.wins[index] ?? 0, cards: deal?.hands[index].length ?? 0,
      }),
      turn: deal?.turn, trick: deal?.trick ?? [], lastTrick: deal?.lastTrick, taken: deal?.taken ?? [],
      attempts: deal?.attempts, previousBidTotal: deal?.previousBidTotal,
      clock: turnClock(room), lastAuto: deal?.lastAuto,
      hand: seat >= 0 ? deal?.hands[seat] ?? [] : [],
      legal: canPlay && deal ? legalCards(deal.hands[seat], deal.trick) : [],
    };
  }

  private send(socket: WebSocket, room: Room, live: Set<string>, scores = this.ledger.snapshot()) {
    try {
      socket.send(JSON.stringify({ ...this.view(room, this.socketToken(socket), live), scores }));
    } catch {
      // Closing sockets receive the current view on reconnect.
    }
  }

  private publish(exclude?: WebSocket) {
    const room = this.room;
    if (!room) return;
    const live = this.liveTokens(exclude);
    const scores = this.ledger.snapshot();
    for (const socket of this.ctx.getWebSockets(SOCKET_TAG)) {
      if (socket !== exclude) this.send(socket, room, live, scores);
    }
  }

  async socketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socket.deserializeAttachment() as Attachment;
    const now = Date.now();
    if (now - attachment.since >= 4000) socket.serializeAttachment({ ...attachment, since: now });
    if (typeof message === "string" && /^sync:\d{1,8}$/.test(message)) {
      socket.send(JSON.stringify({ sync: message.slice(5), now }));
      return;
    }
    if (message !== "presence") {
      if (typeof message === "string" && message.length < 1024) await this.socketMove(socket, message);
      else socket.close(1008, "Invalid table message");
      return;
    }
    const room = this.room;
    if (!room || (this.ledger.expiresAt() ?? 0) <= Date.now()) {
      socket.close(4004, "Table expired");
    } else if (await this.updatePresence()) {
      this.publish();
    } else {
      this.send(socket, this.room ?? room, this.liveTokens());
    }
  }

  private async socketMove(socket: WebSocket, message: string) {
    const arrival = Date.now();
    let key: unknown;
    try {
      const { key: moveKey, ...move } = asObject(JSON.parse(message), ["key", "action", "revision", "turnVersion", "value"]);
      key = moveKey;
      assert(typeof key === "string" && /^[a-f0-9-]{16,64}$/.test(key), 400, "Invalid move key.");
      assert(move.action === "bid" || move.action === "play", 400, "Invalid move.");
      const room = this.requireRoom();
      assert(room.phase !== "ended" && room.seriesId, 409, "The table is closed.");
      if (room.phase === "ended" || !room.seriesId) return;
      await this.mutate(room.seriesId, "command", this.socketToken(socket), move, "", key as string, arrival);
      socket.send(JSON.stringify({ ack: key }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ack: key ?? null,
        error: error instanceof HttpError ? error.message : "The move could not be confirmed.",
        status: error instanceof HttpError ? error.status : 500 }));
    }
  }

  async socketClosed(socket: WebSocket) {
    if (socket.readyState === WebSocket.OPEN) socket.close(1011, "Connection lost");
    await this.updatePresence(socket);
    this.publish(socket);
  }

  private async connect(request: Request) {
    assert(request.headers.get("upgrade")?.toLowerCase() === "websocket", 426, "WebSocket upgrade required.");
    const [protocol, secret, extra] = (request.headers.get("sec-websocket-protocol") ?? "").split(/,\s*/);
    assert(protocol === SOCKET_PROTOCOL && !extra, 403, "A table credential is required.");
    const token = await digest(credential(secret));
    const room = this.requireRoom();
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [SOCKET_TAG]);
    server.serializeAttachment({ token, since: Date.now() } satisfies Attachment);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    if (room.phase === "ended" || !occupied(room).some((player) => player.token === token)) {
      this.send(server, room, this.liveTokens());
    } else {
      await this.updatePresence();
      this.publish();
    }
    return new Response(null, {
      status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": SOCKET_PROTOCOL },
    });
  }

  private resetClock(room: Active, at: number) {
    if (!room.deal) return;
    room.turnVersion = turnVersion(room) + 1;
    const seconds = room.phase === "bidding" ? room.settings?.bidSeconds : room.settings?.playSeconds;
    const limitMs = (seconds ?? 0) * 1000;
    room.deal.clock = midDeal(room) && limitMs ? { deadline: at + limitMs, remainingMs: limitMs, limitMs } : null;
  }

  private alignClock(room: Active, live: Set<string>, at: number) {
    const clock = turnClock(room);
    if (!clock) return false;
    const running = allOnline(room, live);
    if (running && clock.deadline === null) {
      clock.deadline = at + clock.remainingMs;
      return true;
    }
    if (!running && clock.deadline !== null) {
      clock.remainingMs = Math.max(0, clock.deadline - at);
      clock.deadline = null;
      return true;
    }
    return false;
  }

  private async updatePresence(exclude?: WebSocket) {
    const room = this.room;
    if (!room || room.phase === "ended" || !this.alignClock(room, this.liveTokens(exclude), Date.now())) return false;
    return this.ctx.storage.transaction(async (txn) => {
      const latest = this.room;
      const at = Date.now();
      if (!latest || latest.phase === "ended" || (this.ledger.expiresAt() ?? 0) <= at ||
          !this.alignClock(latest, this.liveTokens(exclude), at)) return false;
      this.ctx.storage.kv.put(TABLE_KEY, latest);
      await this.ledger.schedule(txn, alarmDeadline(latest));
      return true;
    });
  }

  async alarm() {
    const result = await this.ctx.storage.transaction(async (txn) => {
      const room = this.room;
      const at = Date.now();
      if (!room || room.phase === "ended" || (this.ledger.expiresAt() ?? 0) <= at) {
        await this.ledger.schedule(txn);
        return {};
      }
      const live = this.liveTokens();
      let changed = this.alignClock(room, live, at);
      let ledgerChanged = false;
      const deadline = alarmDeadline(room);
      if (room.seriesId && room.deal && deadline != null && deadline <= at) {
        const { deal } = room;
        const seat = deal.turn;
        if (room.phase === "bidding") {
          const value = 1 + randomIndex(4);
          ledgerChanged = this.bid(room, deal, seat, value, room.seriesId, at);
          deal.lastAuto = { seat, action: "bid", value };
        } else {
          const allowed = legalCards(deal.hands[seat], deal.trick);
          const value = allowed[randomIndex(allowed.length)];
          ledgerChanged = this.play(room, deal, seat, value, room.seriesId, at);
          deal.lastAuto = { seat, action: "play", value };
        }
        this.resetClock(room, at);
        room.revision++;
        changed = true;
      }
      if (changed) this.ctx.storage.kv.put(TABLE_KEY, room);
      await this.ledger.schedule(txn, alarmDeadline(room));
      return { changed, ledgerChanged };
    });
    if (result.changed) this.publish();
    if (result.ledgerChanged) this.ledger.publish();
  }

  private startDeal(room: Active) {
    const first = nextSeat(room.dealer);
    room.phase = "bidding";
    room.deal = { hands: dealHands(), bids: [null, null, null, null], wins: [0, 0, 0, 0],
      turn: first, trick: [], lastTrick: null, attempts: 1, previousBidTotal: null };
  }

  private bid(room: Active, deal: Deal, seat: number, value: unknown, seriesId: string, at: number) {
    assert(room.phase === "bidding", 409, "Bidding is closed.");
    assert(typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 13,
      400, "Bid from 1 to 13 tricks.");
    deal.bids[seat] = value as number;
    deal.turn = nextSeat(seat);
    if (deal.bids.includes(null)) return false;
    const total = deal.bids.reduce<number>((sum, bid) => sum + (bid ?? 0), 0);
    if (total < (room.settings?.minimumBid ?? DEFAULT_MINIMUM_BID)) {
      deal.previousBidTotal = total;
      deal.attempts++;
      deal.bids.fill(null);
      return false;
    }
    room.phase = "playing";
    return this.bookBids(room, deal, seriesId, at);
  }

  private ledgerBids(room: Active, deal: Deal) {
    const players = occupied(room).map(({ id, name }) => ({ id, name }));
    return { players, bids: Object.fromEntries(players.map(({ id }, index) => [id, deal.bids[index]])) };
  }

  private bookBids(room: Active, deal: Deal, id: string, at: number) {
    if (deal.ledgerBids) return false;
    this.ledger.write(id, "record-online-bids", { round: room.round, ...this.ledgerBids(room, deal) }, at);
    deal.ledgerBids = true;
    return true;
  }

  private play(room: Active, deal: Deal, seat: number, card: unknown, id: string, at: number) {
    assert(room.phase === "playing", 409, "Wait until bidding is complete.");
    assert(typeof card === "string" && legalCards(deal.hands[seat], deal.trick).includes(card),
      400, "Choose a legal card from your hand.");
    const ledgerChanged = this.bookBids(room, deal, id, at);
    appendCard(deal, seat, card as string);
    if (deal.trick.length < 4) return ledgerChanged;

    const scored = this.completeTrick(room, deal, id, at);
    if (deal.hands.every((hand) => hand.length === 1)) {
      for (let index = 0; index < 4; index++) appendCard(deal, deal.turn, deal.hands[deal.turn][0]);
      return this.completeTrick(room, deal, id, at, true);
    }
    return ledgerChanged || scored;
  }

  private completeTrick(room: Active, deal: Deal, id: string, at: number, automatic = false) {
    const winner = winningPlay(deal.trick).seat;
    deal.wins[winner]++;
    const remaining = deal.hands[winner].length;
    deal.lastTrick = { plays: deal.trick, winner, winnerId: room.seats[winner]!.id,
      number: 13 - remaining, completedAt: at, ...(automatic ? { automatic: true } : {}) };
    (deal.taken ??= []).push(deal.lastTrick);
    deal.trick = [];
    deal.turn = winner;
    deal.settledBids ??= [];
    let ledgerChanged = false;
    for (const bidder of highBidSeatIndices(deal.bids)) {
      if (deal.settledBids.includes(bidder) || highBidResult(deal.bids[bidder], deal.wins[bidder], remaining) === null) continue;
      this.ledger.write(id, "record-online-highbid", { round: room.round, bidderId: room.seats[bidder]!.id,
        won: deal.wins[bidder], remaining }, at);
      deal.settledBids.push(bidder);
      ledgerChanged = true;
    }
    if (remaining) return ledgerChanged;

    const { players, bids } = this.ledgerBids(room, deal);
    this.ledger.write(id, "record-online-round", {
      round: room.round, players,
      bids,
      actuals: Object.fromEntries(players.map(({ id: playerId }, index) => [playerId, deal.wins[index]])),
    }, at);
    room.phase = room.round === ROUNDS ? "finished" : "between";
    return true;
  }

  private command(room: Active, token: string, id: string, data: Payload, at: number, live: Set<string>, arrival: number) {
    const host = matches(token, room.host);
    const seat = room.seats.findIndex((player) => player?.token === token);
    assert(seat >= 0, 403, "You do not have a seat at this table.");
    const { action, value, requestId, target, replace } = data;
    if (action === "bid" || action === "play") {
      assert(allOnline(room, live), 409, "Player offline. Waiting for reconnect.");
      const deal = room.deal;
      if (!deal || deal.turn !== seat) throw new HttpError(409, "It is not your turn.");
      assert(deal.clock?.deadline == null || deal.clock.deadline + DELIVERY_GRACE_MS > arrival, 409, "Time is up.");
      const ledgerChanged = action === "play" ? this.play(room, deal, seat, value, id, at) : this.bid(room, deal, seat, value, id, at);
      deal.lastAuto = null;
      this.resetClock(room, at);
      return { room, ledgerChanged };
    }
    if (action === "leave") {
      assert(!host && betweenDeals(room), 409, "You can give up your seat between deals.");
      room.seats[seat] = null;
      return { room };
    }
    assert(host, 403, "Only the host can manage this table.");
    if (action === "end") {
      const { name, host, recovery, revision, hasLedger } = room;
      const abandoned = midDeal(room) && Boolean(room.deal?.ledgerBids);
      if (abandoned) this.ledger.write(id, "abandon-online-round", { round: room.round }, at);
      return { room: { name, host, recovery, revision, hasLedger, phase: "ended" } satisfies Room, ledgerChanged: abandoned };
    }
    if (action === "settle") {
      assert(room.phase === "finished", 409, "Finish all five deals first.");
      this.ledger.write(id, "settle-game", asObject(value, ["winnerId", "splitTie"]), at);
      return { room, ledgerChanged: true };
    }
    if (action === "settings") {
      assert(room.phase === "lobby", 409, "Change settings before the first deal.");
      room.settings = rulesFor(value);
      return { room };
    }
    if (action === "start" || action === "next" || action === "rematch") {
      const available = { start: "lobby", next: "between", rematch: "finished" } as const;
      assert(room.phase === available[action], 409, "You cannot start a deal right now.");
      assert(allOnline(room, live), 409, "All four players must be connected.");
      if (action !== "next") {
        const players = shuffled(occupied(room)) as Player[];
        room.seats = players;
        room.dealer = randomIndex(4);
        room.round = 1;
        room.gameIndex = (room.gameIndex ?? Number(room.hasLedger)) + 1;
        if (action === "start") {
          players.forEach((player, index) => { player.id = String(index + 1); });
          room.nextPlayer = 5;
          const settings = room.settings ?? tableSettings();
          this.ledger.write(id, "create", { name: room.name, players: players.map(({ name }) => name),
            weights: settings.weights, stake: settings.stake, minimumBid: settings.minimumBid,
            startDealerIndex: room.dealer, autoAwardEnabled: false, mode: "online" }, at);
          room.hasLedger = true;
        } else {
          this.ledger.write(id, "next-online-game", {
            players: players.map(({ id: playerId, name }) => ({ id: playerId, name })),
            startDealerIndex: room.dealer,
          }, at);
        }
      } else {
        room.round++;
        room.dealer = nextSeat(room.dealer);
      }
      this.startDeal(room);
      this.resetClock(room, at);
      return { room, ledgerChanged: action !== "next" };
    }
    if (action === "reject") {
      const index = room.pending.findIndex((entry) => entry.id === requestId);
      assert(index >= 0, 409, "That join request already left.");
      room.pending.splice(index, 1);
      return { room, refresh: false };
    }
    if (action === "approve" || action === "remove") {
      if (typeof target !== "number" || !Number.isInteger(target) || target < 0 || target > 3 || target === seat) {
        throw new HttpError(400, "Select a guest seat.");
      }
      const previous = room.seats[target];
      if (action === "remove") {
        assert(betweenDeals(room) && previous, 409, "A guest seat can be removed between deals.");
        room.seats[target] = null;
        return { room };
      }
      const index = room.pending.findIndex((entry) => entry.id === requestId && entry.until > at);
      assert(index >= 0, 409, "That join request expired.");
      const incoming = room.pending[index];
      if (midDeal(room)) {
        assert(previous && !live.has(previous.token) && replace !== true,
          409, "During a deal, only an offline seat can be restored.");
      } else {
        assert(betweenDeals(room), 409, "There are no seats to change now.");
      }
      room.seats[target] = previous && replace !== true
        ? { ...previous, token: incoming.token }
        : { id: String(room.nextPlayer++), name: incoming.name, token: incoming.token };
      room.pending.splice(index, 1);
      return { room };
    }
    throw new HttpError(400, "Unknown table action.");
  }

  async fetch(request: Request, id: string, route?: string) {
    const arrival = Date.now();
    if (request.method === "GET") {
      if (route === "socket") return this.connect(request);
      const room = this.requireRoom();
      const host = request.headers.has("authorization") && matches(await digest(bearer(request)), room.host);
      if (route === "export") {
        assert(host && room.hasLedger, 403, "Only the host can export this ledger.");
        return this.ledger.backup();
      }
      if (!route) return json({ name: room.name, phase: room.phase, host, hasLedger: room.hasLedger,
        ...(room.phase === "ended" && host ? { revision: room.revision, scores: this.ledger.snapshot() } : {}) });
    }
    if (request.method !== "POST" || !route || !["setup", "join", "recover", "command"].includes(route)) {
      return json({ error: "Method or route not supported." }, 405);
    }
    const token = await digest(bearer(request));
    const { data } = await readJson(request, 4096);
    const fields = asObject(data, route === "setup" ? ["name", "player", "recovery", "settings"] :
      route === "join" ? ["name"] : route === "recover" ? ["newToken"] :
        ["revision", "turnVersion", "action", "value", "requestId", "target", "replace"]);
    const replacement = route === "setup" ? await digest(credential(fields.recovery)) :
      route === "recover" ? await digest(credential(fields.newToken)) : "";
    if (replacement) assert(token !== replacement, 400, "Use separate table and recovery codes.");
    const key = request.headers.get("idempotency-key");
    if (route === "command") assert(key && /^[a-f0-9-]{16,64}$/.test(key), 400, "Provide an idempotency key.");
    const status = await this.mutate(id, route, token, fields, replacement, key, arrival);
    return json({ accepted: true }, status);
  }

  private async mutate(id: string, route: string, token: string, fields: Payload,
    replacement: string, key: string | null, arrival: number) {
    const result = await this.ctx.storage.transaction(async (txn) => {
      const at = Date.now();
      let updated: Room;
      let ledgerChanged = false;
      let refresh = true;
      if (route === "setup") {
        const existing = this.room;
        if (existing && matches(token, existing.host) && matches(replacement, existing.recovery)) {
          this.requireRoom();
          return { status: 200 };
        }
        assert(!existing && !this.ledger.exists(), 409, "This table already exists.");
        updated = { name: nameFor(fields.name), host: token, recovery: replacement, hasLedger: false,
          revision: 0, phase: "lobby", seats: [{ id: "1", name: nameFor(fields.player), token }, null, null, null],
          pending: [], nextPlayer: 2, round: 0, dealer: 0, deal: null, seriesId: id, gameIndex: 0,
          settings: rulesFor(fields.settings) };
      } else {
        const room = this.requireRoom();
        if (route === "recover") {
          assert(matches(token, room.recovery), 403, "The host recovery code is incorrect.");
          assert(!roomHasToken(room, replacement) || matches(replacement, room.host), 409, "Use a new seat code.");
          if (matches(replacement, room.host)) return { status: 200 };
          const previous = room.phase !== "ended" && occupied(room).find((player) => player.token === room.host);
          if (previous) previous.token = replacement;
          room.host = replacement;
          updated = room;
          refresh = false;
        } else {
          if (room.phase === "ended") {
            assert(route === "command" && matches(token, room.host) && ["end", "settle"].includes(fields.action as string),
              410, "The host ended this table.");
            if (fields.action === "end" || !this.ledger.pendingTie()) return { status: 200 };
            assert(fields.revision === room.revision, 409, "Reload the table to review the latest scores.");
            this.ledger.write(id, "settle-game", asObject(fields.value, ["winnerId", "splitTie"]), at);
            updated = room;
            ledgerChanged = true;
          } else if (route === "join") {
            const name = nameFor(fields.name);
            room.pending = room.pending.filter((entry) => entry.until > at);
            if (roomHasToken(room, token)) return { status: 200 };
            assert(!matches(token, room.recovery), 403, "Keep the host recovery code private.");
            const free = room.seats.indexOf(null);
            if (room.phase === "lobby" && free !== -1) {
              room.seats[free] = { id: String(room.nextPlayer++), name, token };
            } else {
              assert(room.pending.length < 8, 409, "The host has too many pending requests.");
              room.pending.push({ id: crypto.randomUUID(), name, token, until: at + PENDING_MS });
              refresh = false;
            }
            updated = room;
          } else {
            const move = fields.action === "bid" || fields.action === "play";
            if ((room.lastCommand?.token === token && room.lastCommand.key === key) ||
              (move && room.recentMoves?.some((entry) => entry.token === token && entry.key === key))) return { status: 200 };
            assert(move && fields.turnVersion !== undefined
              ? fields.turnVersion === turnVersion(room) : fields.revision === room.revision,
            409, move ? "That turn has already moved on." : "The table updated. Review it and try again.");
            const change = this.command(room, token, id, fields, at, this.liveTokens(), arrival);
            updated = change.room;
            ledgerChanged = Boolean(change.ledgerChanged);
            refresh = change.refresh !== false;
            if (updated.phase !== "ended") {
              updated.lastCommand = { token, key: key! };
              if (move) updated.recentMoves = [...(updated.recentMoves ?? []).slice(-15), updated.lastCommand];
            }
          }
        }
      }
      updated.revision++;
      if (updated.phase !== "ended") {
        updated.seriesId ??= id;
        this.alignClock(updated, this.liveTokens(), at);
      }
      this.ctx.storage.kv.put(TABLE_KEY, updated);
      if (refresh) await this.ledger.refresh(txn, at);
      await this.ledger.schedule(txn, alarmDeadline(updated));
      return { status: route === "setup" ? 201 : 200, changed: true, ledgerChanged };
    });
    if (result.changed) this.publish();
    if (result.ledgerChanged) this.ledger.publish();
    return result.status;
  }
}

function roomHasToken(room: Room, token: string) {
  return room.phase !== "ended" && (occupied(room).some((player) => player.token === token) ||
    room.pending.some((entry) => entry.token === token));
}
