import { isRecord } from "../server/src/services/gameService.js";
import { HttpError, assert } from "../server/src/utils/errors.js";

export type Payload = Record<string, unknown>;
export type Event = { revision: number; action: string; payload: Payload; at: number };

const fields: Record<string, string[]> = {
  create: ["name", "players", "weights", "stake", "startDealerIndex", "autoAwardEnabled", "mode", "minimumBid"],
  "record-online-round": ["round", "players", "bids", "actuals"],
  "record-online-bids": ["round", "players", "bids"],
  "record-online-highbid": ["round", "bidderId", "won", "remaining"],
  "start-online-side": ["round", "players", "bids", "bidderId"],
  "score-online-side": ["round", "won", "remaining"],
  "close-online-side": ["round", "canceled"],
  "abandon-online-round": ["round"],
  "next-online-game": ["players", "startDealerIndex"],
  "set-bids": ["round", "bids"],
  "set-actuals": ["round", "actuals"],
  "resolve-highbid": ["round", "bidderId", "bidderWon", "stake"],
  "cancel-highbid": ["round"],
  "resolve-game": [],
  "settle-game": ["winnerId", "splitTie"],
  "next-game": [],
  "reorder-players": ["newOrder", "startDealerId"],
  substitute: ["outgoingPlayerId", "incomingPlayerId", "incomingName"],
  settings: ["autoAwardEnabled"],
  recover: [],
};

const allowedKeys = (obj: object, keys: string[]) => Object.keys(obj).every((key) => keys.includes(key));

export function asObject(value: unknown, keys?: string[]): Payload {
  if (!isRecord(value) || (keys && !allowedKeys(value as object, keys))) {
    throw new HttpError(400, "Invalid request fields.");
  }
  return value as Payload;
}

export function payloadFor(action: string, value: unknown): Payload {
  assert(Object.hasOwn(fields, action), 400, "Unknown ledger command.");
  return asObject(value, fields[action]);
}

export function eventFromExport(input: unknown, index: number): Event {
  const { action, payload, revision, at } = asObject(input, ["action", "payload", "revision", "at"]);
  if (typeof action !== "string" || revision !== index + 1 || typeof at !== "number" ||
      !Number.isSafeInteger(at) || at < 0 || at > 8_640_000_000_000_000 ||
      (index === 0) !== (action === "create")) {
    throw new HttpError(400, "Invalid event in ledger backup.");
  }
  return { action, payload: payloadFor(action, payload), revision, at };
}

export async function readJson(request: Request, maxBytes: number) {
  assert(request.headers.get("content-type")?.split(";")[0].trim() === "application/json",
    415, "Send an application/json request.");
  if (!request.body) throw new HttpError(400, "Missing JSON body.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request exceeds the ledger size limit.");
    }
    raw += decoder.decode(value, { stream: true });
  }
  try {
    return { raw, data: JSON.parse(raw + decoder.decode()) as unknown };
  } catch {
    throw new HttpError(400, "Malformed JSON.");
  }
}

export function credential(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(403, "A valid private credential is required.");
  }
  return value;
}

export function bearer(request: Request) {
  return credential(request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]);
}

export async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function matches(actual: string, expected: string) {
  let diff = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function failure(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message, ...error.data }, error.status);
  // Do not log request content or credentials.
  console.error("Ledger request failed unexpectedly.");
  return json({ error: "The ledger could not complete the request." }, 500);
}
