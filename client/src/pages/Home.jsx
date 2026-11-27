// src/pages/Home.jsx
import React, { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { editorStorageKey, recoveryStorageKey, setupLedger } from "../api.js";

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
  const [autoAwardEnabled, setAutoAwardEnabled] = useState(false);
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [backupFile, setBackupFile] = useState(null);
  const pending = useRef(null);
  const navigate = useNavigate();

  async function submit(payload, action) {
    const input = JSON.stringify({ action, payload });
    if (pending.current?.input !== input) {
      pending.current = { input, ...setupLedger(payload, action) };
    }
    const attempt = pending.current;
    // Keep locally generated credentials available even if the setup response is lost.
    localStorage.setItem(editorStorageKey(attempt.seriesId), attempt.editorKey);
    sessionStorage.setItem(recoveryStorageKey(attempt.seriesId), attempt.recoveryKey);
    try {
      await attempt.submit();
    } catch (error) {
      if (error.status && error.status < 500) {
        localStorage.removeItem(editorStorageKey(attempt.seriesId));
        sessionStorage.removeItem(recoveryStorageKey(attempt.seriesId));
        pending.current = null;
      }
      throw error;
    }
    navigate(`/ledger/${attempt.seriesId}`);
  }

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

      await submit({
        name,
        rulesVersion: 2,
        players,
        weights: parsedWeights,
        startDealerIndex,
        autoAwardEnabled,
      }, "create");
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(event) {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (!backupFile || backupFile.size >= 4 * 1024 * 1024) throw new Error("Select a ledger backup under 4 MiB.");
      await submit(JSON.parse(await backupFile.text()), "restore");
    } catch (error) {
      setErr(error.message || "Restore failed.");
    } finally {
      setBusy(false);
    }
  }

  function openLedger(event) {
    event.preventDefault();
    const match = openId.trim().toLowerCase().match(/(?:^|\/(ledger|group)\/)([a-f0-9]{32})\/?$/);
    if (match) navigate("/" + (match[1] ?? "ledger") + "/" + match[2]);
    else setErr("Enter a ledger link or series ID.");
  }

  return (
    <div style={wrap}>
      <Link to="/" style={{ color: "#253755" }}>Callbreak</Link>
      <h1>Callbreak Ledger</h1>

      <section style={card}>
        <h2>Create Ledger</h2>
        <p>Use the same group link for future games. Paid-up groups expire after seven inactive days.</p>

        <label htmlFor="series-name" style={label}>Ledger name</label>
        <input
          style={input}
          id="series-name"
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
              aria-label={`Player ${i + 1}`}
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
          {busy ? "Creating…" : "Create Ledger"}
        </button>
      </section>

      <section style={card}>
        <h2>Open Ledger</h2>
        <form onSubmit={openLedger} className="ledger-actions">
          <input
            style={{ ...input, flex: 1 }}
            placeholder="Viewer link or series ID"
            aria-label="Viewer link or series ID"
            value={openId}
            onChange={(event) => setOpenId(event.target.value)}
          />
          <button style={btn}>Open</button>
        </form>
      </section>

      <section style={card}>
        <h2>Restore Ledger</h2>
        <p>Upload a ledger export to restore its scores, balances, and history under a new viewer link.</p>
        <form onSubmit={onRestore} className="ledger-actions">
          <input aria-label="Ledger backup" type="file" accept=".json,application/json" required
            onChange={(event) => setBackupFile(event.target.files[0])} />
          <button style={btn} disabled={busy}>Restore Backup</button>
        </form>
      </section>
      {err && <div role="alert" style={errBox}>{err}</div>}
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
