import React, { useState } from "react";

export default function TieSettlement({ players, ready, onSettle }) {
  const [winner, setWinner] = useState("");
  return (
    <section aria-label="Settle first-place tie" className="tie-settlement">
      <h3>First-place tie</h3>
      <p>{players.map(({ name }) => name).join(", ")} · {players[0].total.toFixed(1)} points</p>
      {onSettle && <div className="tie-actions">
        <label>Choose a winner
          <select value={winner} onChange={(event) => setWinner(event.target.value)}>
            <option value="">Select player</option>
            {players.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <button type="button" disabled={!ready || !winner} onClick={() => onSettle({ winnerId: winner })}>
          Award to selected player
        </button>
        <button type="button" disabled={!ready} onClick={() => onSettle({ splitTie: true })}>Keep tie and split winnings</button>
      </div>}
    </section>
  );
}
