import React from "react";
import { Card } from "./ui.js";

export default function GameHeader({
  gameId,
  title,
  weights,
  stake,
  connected,
  loading,
}) {
  return (
    <Card className="ledger-heading"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 style={{ margin: 0 }}>{title || "Game"}</h1>
        <div style={{ color: "var(--muted)", fontSize: 14 }}>
          Game {gameId}
        </div>
      </div>
      <div style={{ textAlign: "right", color: "var(--muted)", fontSize: 14 }}>
        <div>
          Weights: <b>{(weights || []).join(", ") || "—"}</b>
        </div>
        <div>
          Stake: <b>{stake ?? "—"}</b>
        </div>
        <div className="sync-state" data-online={connected || undefined} style={{ fontSize: 13, marginTop: 4 }}>
          Live sync: {loading ? "Connecting…" : connected ? "Online" : "Reconnecting"}
        </div>
      </div>
    </Card>
  );
}
