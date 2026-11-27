import { readTableSettings } from "./online/readTableSettings.js";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { editorStorageKey, ledgerPath, recoveryStorageKey, request } from "../api.js";
import useGameSubscription from "./game/hooks/useGameSubscription.js";
import { formatBalance } from "./game/components/ui.js";
import { SettingsFields } from "./online/TableSettings.jsx";
import { hostKey, seatKey, tablePath } from "./online/useTable.js";
import "./group.css";

function TransferList({ transfers, names }) {
  return <ul className="transfers">{transfers.map(({ from, to, amount }) =>
    <li key={from + ":" + to}><span>{names.get(from)} pays {names.get(to)}</span><b>{formatBalance(amount)}</b></li>)}</ul>;
}

function GameReceipt({ game, summary }) {
  const members = [...game.players, ...game.inactivePlayers];
  const names = new Map(members.map(({ id, name }) => [id, name]));
  const rounds = Object.entries(game.roundData).filter(([, deal]) => ["PLAYED", "AUTO_AWARDED"].includes(deal.status));
  const standings = summary.settlement?.ranking ?? members.filter((p) =>
    game.players.includes(p) || summary.scoredPlayerIds.includes(p.id) || summary.gamePayouts[p.id]);
  return <div className="game-receipt">
    <p>{game.mode === "online" ? "Online" : "In person"} · {game.settlementConfig.weights.join(" / ")} × {game.settlementConfig.stake}</p>
    <table aria-label="Game standings"><thead><tr><th>Player</th><th>Points</th><th>Net payout</th></tr></thead>
      <tbody>{standings.map(({ id, name }) => <tr key={id}><th scope="row">{name}</th>
        <td>{summary.totalsPoints[id] ?? 0}</td><td>{formatBalance(summary.gamePayouts[id] ?? 0)}</td></tr>)}</tbody>
    </table>
    {rounds.map(([round, deal]) => <details key={round}><summary>Deal {round} scores</summary>
      <table><thead><tr><th>Player</th><th>Bid</th><th>Won</th><th>Points</th></tr></thead>
        <tbody>{Object.keys(deal.points).map((id) => <tr key={id}><th scope="row">{names.get(id)}</th>
          <td>{deal.bids[id]}</td><td>{deal.actuals?.[id] ?? "–"}</td><td>{deal.points[id]}</td></tr>)}</tbody>
      </table></details>)}
    {summary.highBids.map((bid, index) => <p key={index}>Deal {bid.round} · {names.get(bid.bidderId)} {bid.outcome.toLowerCase() === "win" ? "won" : "lost"} {bid.total == null ? "a side call" : formatBalance(bid.total) + " on a call of " + bid.bid}</p>)}
    {(game.payments ?? []).map(({ at, transfers }, index) => <div key={index}><h3>Paid · {new Date(at).toLocaleString()}</h3>
      <TransferList transfers={transfers} names={names} /></div>)}
  </div>;
}

function History({ id, revision, current }) {
  const [before, setBefore] = useState(Number.MAX_SAFE_INTEGER);
  const [page, setPage] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request(ledgerPath(id) + "/history?before=" + before).then((data) => {
      if (active) setPage(data);
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [id, before, revision]);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!selected || selected === current.game.gameId) return;
    let active = true;
    request(ledgerPath(id) + "/history/" + selected).then(({ ledger }) => {
      if (active) setDetail({ gameId: selected, data: ledger });
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [id, selected, current.game.gameId]);
  const record = selected === current.game.gameId ? current : detail?.gameId === selected ? detail.data : null;
  return <section className="group-panel"><h2>Game history</h2>
    {page?.games.slice().reverse().map((entry) => <div key={entry.gameId}>
      <button className="history-row" onClick={() => { setError(""); setSelected(selected === entry.gameId ? "" : entry.gameId); }} aria-expanded={selected === entry.gameId}>
        <span>Game {entry.gameIndex}<small>{new Date(entry.createdAt).toLocaleDateString()}</small></span>
        <span>{entry.status} ›</span></button>
      {selected === entry.gameId && (record ? <GameReceipt {...record} /> : <p role="status">Loading scores…</p>)}
    </div>)}
    {error && <p role="alert">{error}</p>}
    {page?.nextBefore && <button onClick={() => { setBefore(page.nextBefore); setDetail(null); }}>Older games</button>}
    {before !== Number.MAX_SAFE_INTEGER && <button onClick={() => setBefore(Number.MAX_SAFE_INTEGER)}>Latest games</button>}
  </section>;
}

function NextGame({ game, members, hostId, busy, start }) {
  const [mode, setMode] = useState("online");
  return <details className="group-panel"><summary>Start a new game</summary><form onSubmit={(event) => {
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
    <button className="group-primary" disabled={busy}>Create {mode === "online" ? "online" : "in-person"} game</button>
  </form></details>;
}

export default function GroupPage({ id }) {
  const { snapshot, error, acceptSnapshot } = useGameSubscription(id);
  const path = ledgerPath(id);
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [hostId, setHostId] = useState(null);
  const [admin, setAdmin] = useState("");
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("Balances");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const tokens = [...new Set([localStorage.getItem(editorStorageKey(id)), localStorage.getItem(seatKey(id))].filter(Boolean))];
    request(tablePath(id), { token: tokens.at(-1) }).then((r) => { if (active) setRoom(r); }).catch(() => {});
    async function authorize() {
      for (const token of tokens) {
        try { await request(path + "/visit", { token, body: {} }); } catch { /* Public viewers can still read balances. */ }
        try {
          const access = await request(path + "/editor", { token });
          if (active) { setAdmin(token); setHostId(access.hostId); }
          return;
        } catch { /* Try the other locally stored credential. */ }
      }
    }
    authorize();
    return () => { active = false; };
  }, [id, path]);
  useEffect(() => {
    if (snapshot?.game.mode !== "online") return;
    let active = true;
    request(tablePath(id), { token: localStorage.getItem(seatKey(id)) }).then((r) => { if (active) setRoom(r); }).catch(() => {});
    return () => { active = false; };
  }, [id, snapshot?.game.mode, snapshot?.revision]);
  async function submit(action, payload, revision) {
    setBusy(true); setNotice("");
    try {
      const data = await request(path + "/command", { token: admin, key: crypto.randomUUID(),
        body: { action, payload, expectedRevision: revision } });
      acceptSnapshot(data.view);
      if (action === "group-next") {
        if (payload.mode === "online") {
          localStorage.setItem(seatKey(id), admin);
          const recovery = sessionStorage.getItem(recoveryStorageKey(id));
          if (recovery) localStorage.setItem(hostKey(id), recovery);
        } else {
          localStorage.setItem(editorStorageKey(id), admin);
          const recovery = localStorage.getItem(hostKey(id));
          if (recovery) sessionStorage.setItem(recoveryStorageKey(id), recovery);
        }
        navigate((payload.mode === "online" ? "/play/" : "/ledger/") + id);
      } else setNotice(action === "mark-paid" ? "Payment recorded." : "Game ended.");
    } catch (err) { setNotice(err.message); }
    finally { setReview(null); setBusy(false); }
  }
  if (!snapshot) return <main className="group-page"><Link to="/">Callbreak</Link><h1>{room?.name ?? "Group"}</h1>
    {room ? <Link className="group-primary" to={"/play/" + id}>Open table</Link> : <p role="status">{error || "Opening group…"}</p>}</main>;
  const { game, summary, revision } = snapshot;
  const members = [...game.players, ...game.inactivePlayers];
  const names = new Map(members.map((p) => [p.id, p.name]));
  const online = game.mode === "online" && room && (room.phase !== "ended" || summary.pendingTie?.length > 0);
  const finished = game.closedAt || game.settlementApplied || game.settlementSkipped || (game.mode === "online" && room?.phase === "ended");

  return <main className="group-page">
    <header className="group-head"><Link to="/">♠ Callbreak</Link><button onClick={async () => {
      try { await navigator.clipboard.writeText(location.href); setCopied(true); }
      catch { setNotice(location.href); }
    }}>{copied ? "Link copied" : "Copy group link"}</button></header>
    <h1>{game.name}</h1>
    <div className="group-game"><div><small>{game.mode === "online" ? "Online" : "In person"}</small><h2>Game {game.gameIndex}</h2></div>
      <Link to={(online ? "/play/" : "/ledger/") + id}>{online ? "Open table" : "Open scores"} ↗</Link></div>
    <nav className="group-tabs" aria-label="Group views">{["Balances", "History"].map((t) =>
      <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>{t}</button>)}</nav>
    {tab === "History" ? <History id={id} revision={revision} current={snapshot} /> : <section className="group-panel">
      <h2>Outstanding balances</h2>
      {members.map(({ id, name }) => { const value = summary.payouts[id] ?? 0; return <div key={id} className="balance-row">
        <span>{name}</span><b data-direction={Math.sign(value)}>{value ? (value > 0 ? "Gets " : "Owes ") + formatBalance(Math.abs(value)) : "Paid up"}</b></div>; })}
      {Boolean(summary.transfersDue?.length) && <>{review ? <div className="pay-review"><h3>Confirm these payments</h3>
        <TransferList transfers={review.transfers} names={names} />
        <button className="group-primary" disabled={busy} onClick={() => submit("mark-paid", {}, review.revision)}>Confirm paid</button>
        <button disabled={busy} onClick={() => setReview(null)}>Cancel</button></div> :
        admin ? <button className="group-primary" onClick={() => setReview({ transfers: summary.transfersDue, revision })}>Settle up</button>
          : <TransferList transfers={summary.transfersDue} names={names} />}</>}
    </section>}
    {admin && finished && !summary.pendingTie?.length && <NextGame key={game.gameIndex} game={game} members={members}
      hostId={hostId} busy={busy} start={(payload) => submit("group-next", payload, revision)} />}
    {admin && (!room || game.mode !== "online") && !finished && !summary.pendingTie?.length && <details className="group-panel"><summary>End current game</summary>
      <p>End this game with its recorded side payouts and skip the remaining deals.</p>
      <button disabled={busy} onClick={() => { if (window.confirm("End this game without posting a final payout?")) submit("finish-group-game", {}, revision); }}>End this game</button>
    </details>}
    {notice && <p role="status">{notice}</p>}
    <footer>{summary.transfersDue?.length ? "Unpaid balances are kept until settled." :
      snapshot.expiresAt ? "Inactive group expires " + new Date(snapshot.expiresAt).toLocaleString() : "Group is paid up."}</footer>
  </main>;
}
