import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../../api.js";

export const tablePath = (id) => `/api/table/${id}`;
export const seatKey = (id) => `callbreak:table:seat:${id}`;
export const hostKey = (id) => `callbreak:table:recovery:${id}`;

export function useTable(tableId, token) {
  const [connection, setConnection] = useState(null);
  const transport = useRef(null);
  const path = tablePath(tableId);

  const sendMove = useCallback(async (body) => {
    const key = crypto.randomUUID();
    try {
      if (transport.current) {
        await transport.current(body, key);
        return;
      }
    } catch (error) {
      if (error.status && error.status < 500) throw error;
    }
    await request(`${path}/command`, { token, key, body, signal: AbortSignal.timeout(5000) });
  }, [path, token]);

  useEffect(() => {
    let closed = false;
    let terminal = false;
    let opening = false;
    let socket;
    let retry;
    let heartbeat;
    let handshake;
    let lastSeen;
    let lastWallSeen;
    let lastPing = -Infinity;
    let ticks;
    let view;
    let online = false;
    let delay = 150;
    let sample;
    let sentProbe;
    let probe = 0;
    const pending = new Map();

    const update = (extra = {}) => setConnection({
      token, view, connected: online, serverOffset: sample?.offset ?? view?.serverOffset, ...extra,
    });
    const send = (message) => {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(message);
      return true;
    };

    function sync() {
      const id = String(++probe);
      if (send(`sync:${id}`)) sentProbe = { id, at: performance.now() };
    }

    function ping() {
      const now = performance.now();
      if (now - lastPing >= 3500 && send("ping")) lastPing = now;
    }

    function failPending() {
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error("Move confirmation was interrupted."));
      }
      pending.clear();
    }

    function move(body, key) {
      return new Promise((resolve, reject) => {
        if (!send(JSON.stringify({ ...body, key }))) {
          reject(new Error("Table connection interrupted."));
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error("Move confirmation timed out."));
        }, 1600);
        pending.set(key, { resolve, reject, timer });
      });
    }

    function retryConnection() {
      online = false;
      update();
      if (closed || terminal || !navigator.onLine) return;
      clearTimeout(retry);
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5000);
    }

    async function connect() {
      if (closed || terminal || opening || socket || !navigator.onLine) return;
      opening = true;
      try {
        const info = await request(path, { token, signal: AbortSignal.timeout(5000) });
        if (closed) return;
        if (info.phase === "ended") {
          view = info;
          terminal = true;
          update();
          return;
        }
        const url = new URL(`${path}/socket`, location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const nextSocket = new WebSocket(url, ["callbreak", token]);
        socket = nextSocket;
        handshake = setTimeout(() => nextSocket.close(), 5000);
        nextSocket.onopen = () => {
          lastSeen = performance.now();
          lastWallSeen = Date.now();
          lastPing = -Infinity;
          sample = undefined;
          ticks = 0;
          ping();
          sync();
          heartbeat = setInterval(() => {
            const current = performance.now();
            if (current - lastSeen > 12_000) {
              nextSocket.close();
              return;
            }
            ping();
            if (++ticks % 2 === 0) {
              sync();
              send("presence-v2");
            }
          }, 4000);
        };
        nextSocket.onmessage = (event) => {
          if (closed) return;
          lastSeen = performance.now();
          lastWallSeen = Date.now();
          if (event.data === "pong") return;
          const next = JSON.parse(event.data);
          if ("presence" in next) {
            if (view?.seats && view.revision === next.revision && view.seats.some((p, i) => p && p.online !== next.presence[i])) {
              view = { ...view, seats: view.seats.map((p, i) => p && { ...p, online: next.presence[i] }) };
              update();
            }
            return;
          }
          if ("ack" in next) {
            const entry = pending.get(next.ack);
            if (!entry) return;
            pending.delete(next.ack);
            clearTimeout(entry.timer);
            if (next.error) entry.reject(Object.assign(new Error(next.error), { status: next.status }));
            else entry.resolve();
            return;
          }
          if ("sync" in next) {
            if (sentProbe?.id !== next.sync) return;
            const elapsed = lastSeen - sentProbe.at;
            if (!sample || elapsed <= sample.elapsed || lastSeen - sample.at > 20_000) {
              sample = { offset: next.now - (sentProbe.at + elapsed / 2), at: lastSeen, elapsed };
              update();
            }
            return;
          }
          if (view?.revision > next.revision) return;
          // Active tables still send a heartbeat when a background tab's timers are throttled.
          ping();
          view = { ...next, serverOffset: next.now - lastSeen };
          clearTimeout(handshake);
          online = true;
          delay = 150;
          transport.current = move;
          terminal = next.phase === "ended";
          update();
          if (terminal) nextSocket.close();
        };
        nextSocket.onclose = (event) => {
          clearInterval(heartbeat);
          clearTimeout(handshake);
          failPending();
          socket = undefined;
          if (transport.current === move) transport.current = null;
          if (closed || terminal) return;
          if (event.code === 4004) {
            terminal = true;
            online = false;
            view = null;
            update({ error: "This table expired." });
          } else {
            retryConnection();
          }
        };
      } catch (error) {
        if (closed) return;
        if ([404, 410].includes(error.status)) {
          terminal = true;
          view = null;
          update({ error: error.message });
        } else {
          retryConnection();
        }
      } finally {
        opening = false;
      }
    }

    function resume() {
      if (closed || terminal || document.visibilityState !== "visible") return;
      if (socket?.readyState === WebSocket.OPEN) {
        if (performance.now() - lastSeen > 8000 || Date.now() - lastWallSeen > 8000) {
          delay = 150;
          socket.close();
        } else {
          ping();
          sync();
          send("presence-v2");
        }
      } else {
        clearTimeout(retry);
        connect();
      }
    }
    function onOffline() {
      clearTimeout(retry);
      online = false;
      update();
      socket?.close();
    }

    connect();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", onOffline);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      clearTimeout(handshake);
      failPending();
      if (transport.current === move) transport.current = null;
      socket?.close();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", onOffline);
    };
  }, [path, token]);

  return { ...(connection?.token === token ? connection : {}), sendMove };
}
