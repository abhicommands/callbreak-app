import { useCallback, useEffect, useState } from "react";
import { ledgerPath, request } from "../../../api.js";

export default function useGameSubscription(seriesId) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const acceptSnapshot = useCallback((next) => {
    if (next?.version !== 1 || next.game?.seriesId !== seriesId) return;
    setSnapshot((current) =>
      !current || next.revision > current.revision ||
      (next.revision === current.revision && (next.expiresAt !== current.expiresAt || next.tableEnded !== current.tableEnded)) ? next : current);
    setError("");
  }, [seriesId]);

  useEffect(() => {
    let stopped = false;
    let socket;
    let timer;
    let delay = 500;
    const path = ledgerPath(seriesId);

    function retry() {
      if (stopped) return;
      setConnected(false);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15_000);
    }

    function showUnavailable(message) {
      setConnected(false);
      setSnapshot(null);
      setError(message);
    }

    async function connect() {
      try {
        const view = await request(`${path}/snapshot`);
        if (stopped) return;
        acceptSnapshot(view);
        const url = new URL(`${path}/socket`, window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url);
        socket.onmessage = (event) => {
          if (stopped) return;
          const next = JSON.parse(event.data);
          acceptSnapshot(next);
          setConnected(true);
          delay = 500;
        };
        socket.onclose = (event) => {
          if (stopped) return;
          if (event.code === 4004) {
            showUnavailable("This ledger expired. Restore a backup from the home page to continue.");
          } else {
            retry();
          }
        };
      } catch (err) {
        if (stopped) return;
        if (err.status === 404) {
          showUnavailable("Ledger not found. If it expired, restore a backup from the home page.");
        } else if (err.status === 410) {
          showUnavailable(err.message);
        } else {
          setError(err.message || "Unable to load the ledger.");
          retry();
        }
      }
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [seriesId, acceptSnapshot]);

  return { snapshot, error, connected, acceptSnapshot };
}
