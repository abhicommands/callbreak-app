import { useEffect, useRef, useState } from "react";
import { getGame, getSummary } from "../../../api";

export default function useGameSubscription(gameId, options = {}) {
  const { onRedirect } = options;
  const [game, setGame] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!gameId) return undefined;

    let cancelled = false;
    setLoading(true);
    setError("");
    setConnected(false);

    const bootstrap = async () => {
      try {
        const [initialGame, initialSummary] = await Promise.all([
          getGame(gameId),
          getSummary(gameId),
        ]);
        if (!cancelled) {
          setGame(initialGame);
          setSummary(initialSummary);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load game");
          setLoading(false);
        }
      }

      if (cancelled) return;

      const stream = new EventSource(`/api/game/${gameId}/stream`);
      eventSourceRef.current = stream;

      stream.addEventListener("open", () => {
        if (!cancelled) setConnected(true);
      });

      stream.addEventListener("snapshot", (event) => {
        try {
          const payload = JSON.parse(event.data || "{}");
          if (payload.game) setGame(payload.game);
          if (payload.summary) setSummary(payload.summary);
          if (payload.message) setError(payload.message);
          else setError("");
        } catch (err) {
          setError(err.message || "Failed to parse stream update");
        }
      });

      stream.addEventListener("redirect", (event) => {
        try {
          const payload = JSON.parse(event.data || "{}");
          if (payload?.gameId && typeof onRedirect === "function") {
            onRedirect(payload.gameId);
          }
          setError("");
        } catch (err) {
          setError(err.message || "Failed to process redirect");
        } finally {
          if (!cancelled) {
            setConnected(false);
            stream.close();
            if (eventSourceRef.current === stream) {
              eventSourceRef.current = null;
            }
          }
        }
      });

      stream.addEventListener("error", (event) => {
        let message = "Lost connection to live updates";
        if (event?.data) {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed?.message) message = parsed.message;
          } catch {
            message = event.data;
          }
        }
        if (!cancelled) {
          setConnected(false);
          setError(message);
        }
      });
    };

    bootstrap();

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [gameId, onRedirect]);

  return { game, summary, loading, error, connected };
}
