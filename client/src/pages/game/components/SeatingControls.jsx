import React, { useState } from "react";
import { Card, btnStyle, lightBtnStyle, inputStyle } from "./ui.js";

import SeatOrder from "../../../SeatOrder.jsx";

export default function SeatingControls({
  players,
  isAdmin,
  saving,
  currentDealerId,
  onSubmit,
  error,
  onClearError,
  inactivePlayers = [],
  canSubstitute = false,
  onSubstitute,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [order, setOrder] = useState(players);
  const [dealerId, setDealerId] = useState(currentDealerId);
  const [subSeatIndex, setSubSeatIndex] = useState(0);
  const [subSelection, setSubSelection] = useState("NEW");
  const [subName, setSubName] = useState("");

  const [source, setSource] = useState({ players, dealerId: currentDealerId });

  function resetDraft() {
    setOrder(players);
    setDealerId(currentDealerId);
    setSubSeatIndex(0);
    setSubSelection("NEW");
    setSubName("");
  }

  if (source.players !== players || source.dealerId !== currentDealerId) {
    setSource({ players, dealerId: currentDealerId });
    resetDraft();
  }

  const onSave = async () => {
    if (!onSubmit) return;
    if (order.length !== players.length) return;
    await onSubmit({
      orderIds: order.map((player) => player.id),
      dealerId,
    });
    setIsEditing(false);
  };

  return (
    <Card accent="var(--line)" bg="var(--tint)">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Seating &amp; Dealer</h3>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Seating and dealer changes apply to upcoming rounds.
          </div>
        </div>
        {isAdmin && (
          <button
            style={isEditing ? lightBtnStyle : btnStyle}
            onClick={() => {
              if (isEditing && onClearError) onClearError();
              resetDraft();
              setIsEditing((value) => !value);
            }}
            disabled={saving}
          >
            {isEditing ? "Close" : "Edit Seating"}
          </button>
        )}
      </div>

      {isEditing && isAdmin && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <SeatOrder players={order} onChange={setOrder} disabled={saving} />

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label>Next dealer</label>
            <select
              value={dealerId || ""}
              onChange={(event) => setDealerId(event.target.value)}
              style={{ ...inputStyle, width: 200 }}
              disabled={saving}
            >
              {order.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              style={btnStyle}
              disabled={saving}
              onClick={onSave}
            >
              Save Seating
            </button>
            <button
              style={lightBtnStyle}
              disabled={saving}
              onClick={() => {
                resetDraft();
                if (onClearError) onClearError();
              }}
            >
              Reset
            </button>
          </div>

          {canSubstitute && (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                border: "1px dashed var(--line)",
                background: "var(--tint)",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 600 }}>Substitute Player</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13 }}>Seat</label>
                <select
                  value={subSeatIndex}
                  onChange={(event) => setSubSeatIndex(Number(event.target.value))}
                  style={{ ...inputStyle, width: 200 }}
                  disabled={saving}
                >
                  {order.map((player, index) => (
                    <option key={player.id} value={index}>
                      {index + 1}. {player.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13 }}>Incoming</label>
                <select
                  value={subSelection}
                  onChange={(event) => setSubSelection(event.target.value)}
                  style={{ ...inputStyle, width: 220 }}
                  disabled={saving}
                >
                  <option value="NEW">Add new player…</option>
                  {inactivePlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </div>
              {subSelection === "NEW" && (
                <input
                  style={{ ...inputStyle, width: "100%" }}
                  placeholder="New player name"
                  value={subName}
                  onChange={(event) => setSubName(event.target.value)}
                  disabled={saving}
                />
              )}
              <button
                style={{ ...btnStyle, padding: "8px 14px", width: "fit-content" }}
                disabled={saving}
                onClick={async () => {
                  if (!onSubstitute) return;
                  const seat = order[subSeatIndex];
                  if (!seat) return;
                  if (subSelection === "NEW" && !subName.trim()) {
                    alert("Enter a name for the new player.");
                    return;
                  }
                  await onSubstitute({
                    outgoingPlayerId: seat.id,
                    incomingPlayerId:
                      subSelection !== "NEW" ? subSelection : undefined,
                    incomingName: subSelection === "NEW" ? subName.trim() : undefined,
                  });
                  setSubName("");
                }}
              >
                Apply Substitute
              </button>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Substitutions are available before the first round is played.
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>
          )}
        </div>
      )}

      {!isAdmin && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          Only the admin can change seating or dealer order.
        </div>
      )}
    </Card>
  );
}
