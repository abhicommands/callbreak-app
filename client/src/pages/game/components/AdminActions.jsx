import React from "react";
import { btnStyle } from "./ui.js";
import TieSettlement from "./TieSettlement.jsx";

export default function AdminActions({
  isAdmin,
  saving,
  canResolve,
  settlementApplied,
  onResolveGame,
  onNextGame,
  pendingTie,
}) {
  if (!isAdmin) return null;
  if (pendingTie.length) return <TieSettlement players={pendingTie} ready={!saving} onSettle={onResolveGame} />;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {!settlementApplied && (
        <button
          style={{
            ...btnStyle,
            background: canResolve ? "var(--action)" : "#9ca3af",
            border: `1px solid ${canResolve ? "var(--action)" : "#9ca3af"}`,
          }}
          disabled={!canResolve || saving}
          onClick={() => onResolveGame({})}
        >
          Resolve Game (apply payouts)
        </button>
      )}
      {settlementApplied && (
        <button
          style={{ ...btnStyle, background: "var(--action)", border: "1px solid var(--action)" }}
          disabled={saving}
          onClick={onNextGame}
        >
          Start Next Game (carry payouts)
        </button>
      )}
    </div>
  );
}
