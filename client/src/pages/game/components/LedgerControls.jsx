import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { editorStorageKey, recoveryStorageKey } from "../../../api.js";
import { readTableSettings } from "../../online/readTableSettings.js";
import { SettingsFields } from "../../online/TableSettings.jsx";
import { hostKey, seatKey } from "../../online/useTable.js";
import { formatBalance } from "./ui.js";

function TransferList({ transfers, names }) {
  return <ul className="transfers">{transfers.map(({ from, to, amount }) =>
    <li key={from + ":" + to}><span>{names.get(from)} pays {names.get(to)}</span><b>{formatBalance(amount)}</b></li>)}</ul>;
}

export function PaymentReceipts({ game }) {
  if (!game?.payments?.length) return null;
  const names = new Map([...game.players, ...game.inactivePlayers].map((p) => [p.id, p.name]));
  return <details className="ledger-options"><summary>Payment receipts ({game.payments.length})</summary>
    {game.payments.map(({ at, transfers }, i) => <div key={i}>
      <h4>Paid · {new Date(at).toLocaleString()}</h4>
      <TransferList transfers={transfers} names={names} />
    </div>)}
  </details>;
}

function NextGame({ game, members, hostId, busy, start }) {
  const [mode, setMode] = useState(game.mode === "online" ? "online" : "manual");
  return <details className="ledger-options"><summary>Start a new game</summary><form onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const players = [0, 1, 2, 3].map((i) => members.find((p) => p.id === form.get("seat" + i)));
    start({ players, mode, hostId: hostId ?? form.get("host"), dealerId: players[0].id, settings: readTableSettings(form) });
  }}>
    <fieldset><legend>Play mode</legend>{["online", "manual"].map((value) =>
      <label key={value}><input type="radio" checked={mode === value} onChange={() => setMode(value)} /> {value === "online" ? "Online" : "In person"}</label>)}</fieldset>
    <fieldset><legend>Players</legend>{game.players.map((p, i) =>
      <label key={i}>Seat {i + 1}<select name={"seat" + i} defaultValue={p.id}>{members.map((m) =>
        <option key={m.id} value={m.id}>{m.name} · #{m.id}</option>)}</select></label>)}
      {mode === "online" && <label>Your seat<select name="host" disabled={Boolean(hostId)} defaultValue={hostId ?? game.players[0].id}>{members.map((m) =>
        <option key={m.id} value={m.id}>{m.name} · #{m.id}</option>)}</select></label>}
    </fieldset>
    <SettingsFields online={mode === "online"} settings={{ ...game.settlementConfig, ...game.pace, minimumBid: game.minimumBid }} />
    <button disabled={busy}>Create {mode === "online" ? "online" : "in-person"} game</button>
  </form></details>;
}

export default function LedgerControls({ snapshot, editorKey, hostId, busy, command }) {
  const { game, summary, revision, onlineTable, tableEnded } = snapshot;
  const members = [...game.players, ...game.inactivePlayers];
  const names = new Map(members.map((p) => [p.id, p.name]));
  const [review, setReview] = useState(null);
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const finished = game.closedAt || game.settlementApplied || game.settlementSkipped || tableEnded;

  async function submit(action, payload = {}, expected = revision) {
    setNotice("");
    try {
      await command(action, payload, expected);
      if (action === "group-next") {
        const id = game.seriesId;
        if (payload.mode === "online") {
          localStorage.setItem(seatKey(id), editorKey);
          const recovery = sessionStorage.getItem(recoveryStorageKey(id));
          if (recovery) localStorage.setItem(hostKey(id), recovery);
          navigate("/play/" + id);
        } else {
          localStorage.setItem(editorStorageKey(id), editorKey);
          const recovery = localStorage.getItem(hostKey(id));
          if (recovery) sessionStorage.setItem(recoveryStorageKey(id), recovery);
        }
      } else setNotice(action === "mark-paid" ? "Payment recorded." : "Game ended.");
    } catch (err) { setNotice(err.message); }
    finally { setReview(null); }
  }

  return <div className="ledger-controls">
    {Boolean(summary.transfersDue?.length) && (editorKey
      ? review ? <section><h3>Confirm these payments</h3>
        <TransferList transfers={review.transfers} names={names} />
        <button disabled={busy} onClick={() => submit("mark-paid", {}, review.revision)}>Confirm paid</button>
        <button disabled={busy} onClick={() => setReview(null)}>Cancel</button></section>
        : <button disabled={busy} onClick={() => setReview({ transfers: summary.transfersDue, revision })}>Settle up</button>
      : <TransferList transfers={summary.transfersDue} names={names} />)}
    <PaymentReceipts game={game} />
    {editorKey && finished && !summary.pendingTie?.length && <NextGame game={game} members={members}
      hostId={hostId} busy={busy} start={(payload) => submit("group-next", payload)} />}
    {editorKey && !onlineTable && !finished && !summary.pendingTie?.length && <details className="ledger-options">
      <summary>End current game</summary><p>Keep recorded payouts and skip the remaining deals.</p>
      <button disabled={busy} onClick={() => {
        if (window.confirm("End this game without posting a final payout?")) submit("finish-group-game");
      }}>End this game</button></details>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
