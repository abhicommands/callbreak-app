import React from "react";
import { formatBalance } from "./ui.js";

export default function GameTotals({ summary }) {
  const names = new Map([...summary.players, ...summary.inactivePlayers].map(({ id, name }) => [id, name]));
  const leaders = summary.settlement?.ranking ?? [...summary.players, ...summary.inactivePlayers.filter(({ id }) =>
    summary.scoredPlayerIds?.includes(id) || summary.gamePayouts?.[id])]
    .sort((a, b) => (summary.totalsPoints[b.id] ?? 0) - (summary.totalsPoints[a.id] ?? 0));
  return (
    <section className="online-panel match-game-totals" aria-label="Current game totals">
      <h2>Game totals</h2>
      <table className="online-scores">
        <thead><tr><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Net payout</th></tr></thead>
        <tbody>{leaders.map(({ id, name }) => <tr key={id}><th scope="row">{name}</th>
          <td>{(summary.totalsPoints[id] ?? 0).toFixed(1)}</td><td>{formatBalance(summary.gamePayouts?.[id] ?? 0)}</td></tr>)}</tbody>
      </table>
      {summary.highBids?.length > 0 && (
        <ul className="high-bid-results" aria-label="High-bid outcomes">
          {summary.highBids.map(({ bidderId, outcome, stake, round, bid, total }, index) =>
            <li key={index}>Deal {round} · {names.get(bidderId)} {outcome === "WIN" ? "won" : "lost"}
              {" "}{bid == null ? `the high bid (${formatBalance(stake)} per opponent)` :
                `${formatBalance(total)} on a call of ${bid}`}</li>)}
        </ul>
      )}
    </section>
  );
}
