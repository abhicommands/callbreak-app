import React from "react";

function moveSeat(players, from, to) {
  const result = [...players];
  const [player] = result.splice(from, 1);
  result.splice(to, 0, player);
  return result;
}

export default function SeatOrder({ players, disabled, onChange }) {
  function drop(event, from) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const list = event.currentTarget.closest("ol");
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-order-index]");
    if (row && list.contains(row) && Number(row.dataset.orderIndex) !== from) {
      onChange(moveSeat(players, from, Number(row.dataset.orderIndex)));
    }
  }
  return <ol className="seat-order" aria-label="Seating order">{players.map((player, index) =>
    <li key={player.id} data-order-index={index}>
      <button type="button" className="drag-seat" aria-label={`Drag ${player.name} to reorder`} disabled={disabled}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerUp={(event) => drop(event, index)}>☰</button>
      <span>{player.name}</span>
      {[-1, 1].map(delta => <button type="button" key={delta} aria-label={`Move ${player.name} ${delta < 0 ? "up" : "down"}`}
        disabled={disabled || index + delta < 0 || index + delta >= players.length}
        onClick={() => onChange(moveSeat(players, index, index + delta))}>{delta < 0 ? "↑" : "↓"}</button>)}
    </li>)}</ol>;
}
