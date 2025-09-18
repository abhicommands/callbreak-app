// src/pages/Home.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../api";

export default function Home() {
  const [name, setName] = useState("Callbreak Series");
  const [players, setPlayers] = useState([
    "Player 1",
    "Player 2",
    "Player 3",
    "Player 4",
  ]);
  const [weights, setWeights] = useState(["1", "2", "3"]); // strings for easy typing
  const [startDealerIndex, setStartDealerIndex] = useState(0);
  const [autoAwardEnabled, setAutoAwardEnabled] = useState(true);
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  async function onCreate() {
    try {
      setBusy(true);
      setErr("");

      if (players.some((p) => !p.trim()))
        throw new Error("All 4 player names are required.");

      const parsedWeights = weights.map((w) => {
        if (w === "" || w == null) throw new Error("Weights cannot be empty.");
        const n = Number(w);
        if (!Number.isFinite(n) || n < 0)
          throw new Error("Weights must be non-negative numbers.");
        return n;
      });
      if (parsedWeights.length !== 3)
        throw new Error("Provide exactly 3 weight values.");

      // No stake sent; backend will default stake=1
      const { gameId, adminKey } = await createGame({
        name,
        players,
        weights: parsedWeights,
        startDealerIndex,
        autoAwardEnabled,
      });

      localStorage.setItem(`adminKey:${gameId}`, adminKey);
      navigate(`/game/${gameId}`);
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <h1>Nepali Callbreak</h1>

      <section style={card}>
        <h2>Create Game</h2>

        <label style={label}>Game name</label>
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 8,
          }}
        >
          {players.map((p, i) => (
            <input
              key={i}
              style={input}
              value={p}
              placeholder={`Player ${i + 1}`}
              onChange={(e) => {
                const copy = [...players];
                copy[i] = e.target.value;
                setPlayers(copy);
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            marginTop: 12,
          }}
        >
          <div>
            <label style={labelSm}>Weight (2nd)</label>
            <input
              inputMode="decimal"
              style={input}
              value={weights[0]}
              onChange={(e) =>
                setWeights((w) => [e.target.value, w[1], w[2]])
              }
              placeholder="1"
            />
          </div>
          <div>
            <label style={labelSm}>Weight (3rd)</label>
            <input
              inputMode="decimal"
              style={input}
              value={weights[1]}
              onChange={(e) =>
                setWeights((w) => [w[0], e.target.value, w[2]])
              }
              placeholder="2"
            />
          </div>
          <div>
            <label style={labelSm}>Weight (4th)</label>
            <input
              inputMode="decimal"
              style={input}
              value={weights[2]}
              onChange={(e) =>
                setWeights((w) => [w[0], w[1], e.target.value])
              }
              placeholder="3"
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={label}>First dealer</label>
          <select
            value={startDealerIndex}
            onChange={(e) => setStartDealerIndex(Number(e.target.value))}
            style={{ ...input, width: "100%", maxWidth: 240 }}
          >
            {players.map((p, i) => (
              <option key={i} value={i}>
                {p?.trim() ? p : `Player ${i + 1}`}
              </option>
            ))}
          </select>
        </div>

        <label
          style={{
            ...label,
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
          }}
        >
          <input
            type="checkbox"
            checked={autoAwardEnabled}
            onChange={(e) => setAutoAwardEnabled(e.target.checked)}
          />
          Auto-award rounds 1–4 when bids total &lt; 10
        </label>

        <button
          onClick={onCreate}
          style={{ ...btn, marginTop: 12 }}
          disabled={busy}
        >
          {busy ? "Creating…" : "Create Game"}
        </button>
        {err && <div style={errBox}>{err}</div>}
      </section>

      <section style={card}>
        <h2>Open Game</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...input, flex: 1 }}
            placeholder="GAME ID"
            value={openId}
            onChange={(e) => setOpenId(e.target.value.toUpperCase())}
          />
          <button
            onClick={() => openId && navigate(`/game/${openId}`)}
            style={btn}
          >
            Open
          </button>
        </div>
      </section>
    </div>
  );
}

const wrap = { maxWidth: 900, margin: "24px auto", padding: "0 12px" };
const card = {
  border: "1px solid #e5e5e5",
  padding: 16,
  borderRadius: 12,
  background: "#fff",
  marginTop: 16,
};
const label = { display: "block", marginTop: 8, fontWeight: 600 };
const labelSm = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 13,
};
const input = {
  padding: 8,
  border: "1px solid #ccc",
  borderRadius: 8,
  width: "100%",
};
const btn = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};
const errBox = {
  color: "crimson",
  background: "#fff1f2",
  border: "1px solid #fecdd3",
  padding: 10,
  borderRadius: 8,
  marginTop: 10,
};
