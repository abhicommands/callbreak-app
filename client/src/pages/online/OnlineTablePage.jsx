import { readTableSettings } from "./readTableSettings.js";
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ledgerPath, randomHex, request } from "../../api.js";
import MatchTable from "./MatchTable.jsx";
import TieSettlement from "../game/components/TieSettlement.jsx";
import { RulesSummary, SettingsFields } from "./TableSettings.jsx";
import { hostKey, seatKey, tablePath, useTable } from "./useTable.js";
import "./online.css";

const tableIdPattern = /^[a-f0-9]{32}$/;
const codePattern = "[a-f0-9]{64}";

export function OnlineHome() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const createAttempt = useRef(null);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("table")).trim();
    const player = String(form.get("player")).trim();
    const settings = readTableSettings(form);
    const input = JSON.stringify([name, player, settings]);
    if (createAttempt.current?.input !== input) {
      createAttempt.current = { id: randomHex(16), token: randomHex(32), recovery: randomHex(32), input };
    }
    const { id, token, recovery } = createAttempt.current;
    try {
      localStorage.setItem(seatKey(id), token);
      localStorage.setItem(hostKey(id), recovery);
      await request(`${tablePath(id)}/setup`, {
        token, key: crypto.randomUUID(), body: { name, player, recovery, settings },
      });
      navigate(`/play/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function join(event) {
    event.preventDefault();
    const input = String(new FormData(event.currentTarget).get("invite")).trim();
    const match = input.match(/(?:^|\/(play|group)\/)([a-f0-9]{32})\/?$/i);
    if (match) navigate("/" + (match[1]?.toLowerCase() ?? "play") + "/" + match[2].toLowerCase());
    else setError("Enter a table invite link or ID.");
  }

  return (
    <main className="online-page">
      <header className="online-header"><Link to="/">Callbreak</Link><Link to="/ledger">In-person ledger</Link></header>
      <h1>Callbreak Online</h1>
      <div className="online-entry">
        <section className="online-panel">
          <h2>Host a table</h2>
          <form onSubmit={create}>
            <div className="setting-fields">
              <label>Table name<input name="table" defaultValue="Callbreak" required maxLength={80} /></label>
              <label>Your name<input name="player" autoComplete="nickname" required maxLength={80} /></label>
            </div>
            <SettingsFields />
            <button disabled={busy}>Create online table</button>
          </form>
        </section>
        <section className="online-panel">
          <h2>Join a table</h2>
          <form onSubmit={join}>
            <label>Table invite link or ID<input name="invite" autoCapitalize="none" spellCheck={false} required /></label>
            <button>Open table</button>
          </form>
        </section>
      </div>
      {error && <p role="alert" className="online-error">{error}</p>}
    </main>
  );
}

function SeatRequest({ entry, view, ready, command }) {
  const [target, setTarget] = useState("");
  const duringDeal = view.phase === "bidding" || view.phase === "playing";
  const options = view.seats.map((_, seat) => seat).filter((seat) =>
    seat !== view.seat && (!duringDeal || (!view.seats[seat]?.online || view.seats[seat]?.left)));
  const valid = target !== "" && options.includes(Number(target));
  return (
    <li>
      <strong>{entry.name}</strong>
      <div className="online-actions">
        <label>Guest seat
          <select value={valid ? target : ""} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Choose a seat</option>
            {options.map((seat) => <option value={seat} key={seat}>{view.seats[seat]?.name || `Empty seat ${seat + 1}`}</option>)}
          </select>
        </label>
        {valid && view.seats[Number(target)] && (
          <button disabled={!ready} onClick={() => command("approve", { requestId: entry.id, target: Number(target) })}>
            Restore seat
          </button>
        )}
        {!duringDeal && (
          <button disabled={!ready || !valid}
            onClick={() => command("approve", { requestId: entry.id, target: Number(target), replace: true })}>
            Assign as new player
          </button>
        )}
        <button className="online-secondary" disabled={!ready} onClick={() => command("reject", { requestId: entry.id })}>
          Decline
        </button>
      </div>
    </li>
  );
}

export function OnlineTablePage({ tableId }) {
  if (!tableIdPattern.test(tableId)) {
    return <main className="online-page"><Link to="/play">Online Callbreak</Link><p>That table link is invalid.</p></main>;
  }
  return <Room tableId={tableId} />;
}

function Room({ tableId }) {
  const navigate = useNavigate();
  const [token, setToken] = useState(() => {
    const key = seatKey(tableId);
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = randomHex(32);
    localStorage.setItem(key, created);
    return created;
  });
  const { view, connected, error, sendMove, serverOffset } = useTable(tableId, token);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [closedScores, setClosedScores] = useState(null);
  const recovery = localStorage.getItem(hostKey(tableId));
  const path = tablePath(tableId);
  const ready = connected && !busy;
  const between = ["lobby", "between", "finished", "side-result"].includes(view?.phase);
  const seated = view?.seat >= 0;
  const inGame = view?.round > 0 && seated;
  const member = seated || view?.host;
  useEffect(() => {
    if (member) request(ledgerPath(tableId) + "/visit", { token, body: {} }).catch(() => {});
  }, [member, tableId, token]);

  useEffect(() => {
    if (view || !error?.includes("Table not found")) return;
    let active = true;
    request(ledgerPath(tableId) + "/snapshot").then(() => {
      if (active) navigate("/ledger/" + tableId, { replace: true });
    }).catch(() => {});
    return () => { active = false; };
  }, [error, navigate, tableId, view]);

  async function submit(action) {
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function post(endpoint, body, secret = token) {
    return request(`${path}/${endpoint}`, { token: secret, key: crypto.randomUUID(), body });
  }

  function command(action, fields = {}) {
    if (action === "bid" || action === "play") {
      return submit(() => sendMove({ revision: view.revision, turnVersion: view.turnVersion, action, ...fields }));
    }
    return submit(async () => {
      await post("command", { revision: view.revision, action, ...fields });
      if (view.phase === "ended" && action === "settle") {
        setClosedScores((await request(path, { token })).scores);
      }
    });
  }

  function join(event) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    submit(() => post("join", { name }));
  }

  function reconnect(event, host) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).trim();
    submit(async () => {
      const replacement = host ? randomHex(32) : code;
      if (host) {
        await post("recover", { newToken: replacement }, code);
        localStorage.setItem(hostKey(tableId), code);
      }
      localStorage.setItem(seatKey(tableId), replacement);
      setToken(replacement);
      if (!host) setNotice("If the seat code is no longer valid, ask the host to restore your seat.");
    });
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(new URL(`/play/${tableId}`, location.href).href);
      setNotice("Table link copied.");
    } catch {
      setNotice("Copy the invite link below.");
    }
  }

  function backup() {
    submit(async () => {
      const data = await request(`${path}/export`, { token });
      const link = document.createElement("a");
      link.download = `callbreak-online-${tableId.slice(0, 8)}.json`;
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  }

  return (
    <main className={`online-page${inGame ? " online-in-game" : ""}`}>
      <header className="online-header">
        <Link to="/play">{inGame ? "‹ Lobby" : "Online Callbreak"}</Link>
        {inGame && <h1>{view.name}</h1>}
        {view?.hasLedger && <Link to={`/ledger/${tableId}`} target={inGame ? "_blank" : undefined}
          rel={inGame ? "noopener" : undefined}>Open ledger</Link>}
      </header>
      {!inGame && <h1>{view?.name || "Callbreak table"}</h1>}
      {(!view && !error) && <p role="status">Connecting to the table…</p>}
      {view && !connected && view.phase !== "ended" && <p role="status">Reconnecting to the table…</p>}
      {(error || actionError) && <p role="alert" className="online-error">{error || actionError}</p>}
      {notice && <p role="status">{notice}</p>}
      {view?.phase === "ended" && <p>This table has ended. Completed deals remain in the ledger until it expires.</p>}
      {view?.phase === "ended" && view.host && (closedScores ?? view.scores)?.summary.pendingTie.length > 0 && (
        <TieSettlement players={(closedScores ?? view.scores).summary.pendingTie} ready={!busy}
          onSettle={(value) => command("settle", { value })} />
      )}
      {view?.seats && (
        <>
          {!inGame && <section className="online-panel online-roster" aria-label="Players">
            <ol>
              {view.seats.map((player, seat) => (
                <li key={seat}>
                  <strong>{player?.name || "Open seat"}</strong>
                  <span>{player?.host ? "Host · " : ""}{seat === view.seat ? "You · " : ""}
                    {player ? (player.reserved === false ? "Awaiting player" : player.online ? "Online" : "Offline · reserved") : "Waiting"}
                  </span>
                </li>
              ))}
            </ol>
          </section>}
          {inGame && <MatchTable key={view.gameIndex} view={view} ready={ready} command={command} serverOffset={serverOffset} />}
          {view.phase === "lobby" && view.host && (
            <section className="online-panel">
              <h2>{view.seats.filter((player) => player?.reserved).length} of 4 seats reserved</h2>
              <label>Invite link<input readOnly value={new URL(`/play/${tableId}`, location.href).href}
                onFocus={(event) => event.target.select()} /></label>
              <div className="online-actions">
                <button className="online-secondary" onClick={copyInvite}>Copy invite link</button>
                <button disabled={!ready || !view.seats.every((player) => player && player.reserved !== false)}
                  onClick={() => command("start")}>Start game</button>
              </div>
              <RulesSummary settings={view.settings} />
              {!view.prepared && <details className="table-controls">
                <summary>Game settings</summary>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  command("settings", { value: readTableSettings(new FormData(event.currentTarget)) });
                }}>
                  <SettingsFields key={JSON.stringify(view.settings)} settings={view.settings} />
                  <button disabled={!ready || view.prepared}>Save settings</button>
                </form>
              </details>}
            </section>
          )}
          {!seated && (
            <section className="online-panel">
              {view.pending ? <p>Waiting for the host to approve your seat request.</p> : (
                <form className="online-actions" onSubmit={join}>
                  <label>Your name<input name="name" required maxLength={80} autoComplete="nickname" /></label>
                  <button disabled={!ready}>{view.phase === "lobby" && view.seats.includes(null) ? "Join table" : "Request a seat"}</button>
                </form>
              )}
            </section>
          )}
          {view.host && view.requests.length > 0 && (
            <section className="online-panel">
              <h2>Seat requests</h2>
              <ul className="online-requests">
                {view.requests.map((entry) => (
                  <SeatRequest key={entry.id} entry={entry} view={view} ready={ready} command={command} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {view?.host && (
        <details className="online-panel table-controls" open={view.phase === "ended" || undefined}>
          <summary>Table controls</summary>
          {inGame && <RulesSummary settings={view.settings} />}
          <div className="online-actions">
            {between && view.seats.map((player, seat) => player && !player.host && (
              <button className="online-secondary" disabled={!ready} key={seat} onClick={() => {
                if (window.confirm(`Remove ${player.name} from this seat?`)) command("remove", { target: seat });
              }}>Remove {player.name}</button>
            ))}
            {view.hasLedger && <button className="online-secondary" onClick={backup} disabled={busy}>Export ledger</button>}
            {view.phase !== "ended" && <button className="online-danger" disabled={!ready} onClick={() => {
              if (window.confirm("End this table? Completed deals will stay in the ledger.")) command("end");
            }}>End table</button>}
          </div>
        </details>
      )}
      {seated && view.seats[view.seat]?.left && <button disabled={!ready} onClick={() => command("return")}>Return to game</button>}
      {seated && !view.seats[view.seat]?.left && (!between || !view.host) && <button className="online-secondary" disabled={!ready}
        onClick={() => { if (window.confirm("Give up this seat?")) command("leave"); }}>{between ? "Give up seat" : "Leave game"}</button>}
      {view && (
        <details className="online-panel">
          <summary>Reconnect from another browser</summary>
          {seated && <label>Private seat code<input value={token} readOnly onFocus={(event) => event.target.select()} /></label>}
          {view.host && recovery && <label>Host recovery code<input value={recovery} readOnly
            onFocus={(event) => event.target.select()} /></label>}
          {seated && <p>Save your codes privately. Reopening this link in the same browser reconnects you automatically.</p>}
          {!seated && <>
            {view.phase !== "ended" && <CodeForm title="Use a seat code" busy={busy} onSubmit={(event) => reconnect(event, false)} />}
            {!view.host && <CodeForm title="Recover host access" busy={busy} onSubmit={(event) => reconnect(event, true)} />}
          </>}
        </details>
      )}
    </main>
  );
}

function CodeForm({ title, busy, onSubmit }) {
  return (
    <form className="online-actions" onSubmit={onSubmit}>
      <label>{title}<input name="code" pattern={codePattern} required autoCapitalize="none"
        autoComplete="off" spellCheck={false} /></label>
      <button className="online-secondary" disabled={busy}>{title}</button>
    </form>
  );
}
