import React, { useMemo } from "react";
import { Card, inputStyle, btnStyle, lightBtnStyle } from "./ui.js";

export default function HighBidPanel({
  round,
  pool,
  bidderIds = [],
  players = [],
  isAdmin,
  saving,
  selectedBidder,
  setSelectedBidder,
  stakeText,
  setStakeText,
  error,
  onResolve,
  onCancel,
}) {
  const bidderOptions = bidderIds
    .map((id) => players.find((player) => player.id === id))
    .filter(Boolean);
  const opponentCount = useMemo(
    () => players.filter((player) => player.id !== selectedBidder).length,
    [players, selectedBidder]
  );

  return (
    <Card accent="#f59e0b" bg="#fff7ed">
      <h3 style={{ marginTop: 0 }}>Side Game (High Bid)</h3>
      <div>
        Triggered in Round <b>{round}</b>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <label>High-bidder</label>
        <select
          value={selectedBidder}
          onChange={(event) => setSelectedBidder(event.target.value)}
          style={{ ...inputStyle, width: 200 }}
          disabled={!isAdmin || saving}
        >
          <option value="">— Select —</option>
          {bidderOptions.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>

        {pool != null ? <strong>Side payout · {pool} total</strong> : <>
        <label style={{ marginLeft: 8 }}>Stake / loser</label>
        <input
          inputMode="decimal"
          value={stakeText}
          onChange={(event) => setStakeText(event.target.value)}
          style={{ ...inputStyle, width: 120 }}
          disabled={!isAdmin || saving}
          placeholder="3"
        /></>}
        <button
          style={lightBtnStyle}
          disabled={!isAdmin || saving}
          onClick={onCancel}
          title="Cancel side game and edit bids. Ledger unchanged until resolved."
        >
          Cancel &amp; Edit Bids
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div>Did the high-bidder win the side game?</div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 6,
          }}
        >
          <button
            style={btnStyle}
            disabled={!isAdmin || saving || !selectedBidder}
            onClick={() => selectedBidder && onResolve(true)}
          >
            Yes — Bidder Won
          </button>
          <button
            style={btnStyle}
            disabled={!isAdmin || saving || !selectedBidder}
            onClick={() => selectedBidder && onResolve(false)}
          >
            No — Bidder Lost
          </button>
        </div>
        <div style={{ marginTop: 6, color: "#92400e", fontSize: 12 }}>
          {pool == null ? `Each opponent pays or receives the stake. The bidder settles with ${opponentCount} opponents.` :
            "The three opponents split the payout equally."}
        </div>
        {error && (
          <div style={{ marginTop: 8, color: "crimson", fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>
    </Card>
  );
}
