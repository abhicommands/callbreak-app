import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ledgerPath, request } from "../../api.js";
import SettlementCard from "../game/components/SettlementCard.jsx";
import GameTotals from "../game/components/GameTotals.jsx";
import { formatBalance } from "../game/components/ui.js";
import "./online.css";

function OnlineScores({ game, summary, heading }) {
  const rounds = Object.entries(game.roundData).filter(([, round]) => round.status === "PLAYED");
  const roster = [...summary.players, ...summary.inactivePlayers];
  const names = new Map(roster.map(({ id, name }) => [id, name]));
  return (
    <section className="online-panel" aria-label="Online ledger">
      <h2>{heading ?? game.name}</h2>
      {game.settlementSkipped && <p>Final scores are saved. Automatic payouts are skipped for games with substitutions.</p>}
      <GameTotals summary={summary} />
      {!rounds.length ? <p>Scores appear after the first completed deal.</p> : (
        <>
          {rounds.reverse().map(([round, result]) => (
            <details key={round} className="online-round-score">
              <summary>Deal {round} scores</summary>
                <p className="online-muted">Dealer · {names.get(game.roundInfo[round].dealerId)}</p>
              <table className="online-scores">
                <thead><tr><th scope="col">Player</th><th scope="col">Bid</th><th scope="col">Won</th><th scope="col">Points</th></tr></thead>
                <tbody>
                  {game.roundInfo[round].bidderOrder.map((id) => (
                    <tr key={id}><th scope="row">{names.get(id)}</th><td>{result.bids[id]}</td>
                      <td>{result.actuals[id]}</td><td>{result.points[id].toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
          <SettlementCard summary={summary} />
        </>
      )}
      <h3>Series balances</h3>
      <table className="online-scores">
        <thead><tr><th scope="col">Player</th><th scope="col">Balance</th></tr></thead>
        <tbody>{[...roster].sort((a, b) => summary.payouts[b.id] - summary.payouts[a.id])
          .map(({ id, name }) => <tr key={id}><th scope="row">{name}</th><td>{formatBalance(summary.payouts[id])}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function OnlineHistory({ game }) {
  const [opened, setOpened] = useState(false);
  const [games, setGames] = useState([]);
  const [selected, setSelected] = useState("");
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const path = ledgerPath(game.seriesId);

  useEffect(() => {
    if (!opened) return;
    let current = true;
    request(`${path}/history`).then((data) => {
      if (current) setGames(data.games.filter((entry) => entry.gameId !== data.currentGameId));
    }).catch((err) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [opened, path, game.gameIndex]);

  useEffect(() => {
    if (!selected || !opened) return;
    let current = true;
    request(`${path}/history/${selected}`).then((data) => {
      if (current) setRecord({ id: selected, ...data.ledger });
    }).catch((err) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [opened, selected, path]);

  return (
    <details className="online-panel table-controls" onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>Game history</summary>
      {error && <p role="alert" className="online-error">{error}</p>}
      {games.length ? (
        <>
          <label>Past game<select value={selected} onChange={(event) => {
            setError("");
            setSelected(event.target.value);
          }}>
            <option value="">Select a game</option>
            {[...games].reverse().map((entry) => <option value={entry.gameId} key={entry.gameId}>
              Game {entry.gameIndex} · {new Date(entry.createdAt).toLocaleDateString()}
            </option>)}
          </select></label>
          {selected && !error && (record?.id === selected
            ? <OnlineScores game={record.game} summary={record.summary} heading={`Game ${record.game.gameIndex} · ${record.game.name}`} />
            : <p role="status">Loading game…</p>)}
        </>
      ) : <p>Completed games appear here when you start a rematch.</p>}
    </details>
  );
}

export function OnlineLedger({ game, summary, connected, onlineTable, children }) {
  return (
    <main className="online-page">
      <header className="online-header"><Link to="/">Home</Link>
        {onlineTable && <Link to={`/play/${game.seriesId}`}>Online table</Link>}
      </header>
      <h1>Online Callbreak Ledger</h1>
      <p role="status">Live sync: {connected ? "Online" : "Reconnecting"}</p>
      <p>{onlineTable ? "Online ledgers expire after 24 hours of table inactivity." : "This backup expires after 24 hours."}</p>
      <OnlineScores game={game} summary={summary} heading={`Game ${game.gameIndex} · ${game.name}`} />
      <OnlineHistory game={game} />
      {children}
    </main>
  );
}
