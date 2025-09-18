import React, { useEffect, useMemo, useState } from "react";
import { Card, btnStyle, lightBtnStyle, inputStyle } from "./ui.js";

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

  useEffect(() => {
    setOrder(players);
    setDealerId(currentDealerId);
    setSubSeatIndex(0);
    setSubSelection("NEW");
    setSubName("");
  }, [players, currentDealerId, isEditing]);

  const movePlayer = (index, delta) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    setOrder(next);
  };

  const reorderOptions = useMemo(() => order || [], [order]);

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
    <Card accent="#d1d5db" bg="#f8fafc">
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
          <div style={{ fontSize: 13, color: "#4b5563" }}>
            Adjust player order or choose a new dealer between games.
          </div>
        </div>
        {isAdmin && (
          <button
            style={isEditing ? lightBtnStyle : btnStyle}
            onClick={() => {
              if (isEditing && onClearError) onClearError();
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
          {reorderOptions.map((player, index) => (
            <div
              key={player.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#fff",
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
              }}
            >
              <span style={{ width: 24, textAlign: "center" }}>{index + 1}</span>
              <span style={{ flex: 1 }}>{player.name}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{ ...lightBtnStyle, padding: "6px 10px" }}
                  onClick={() => movePlayer(index, -1)}
                  disabled={saving || index === 0}
                >
                  ↑
                </button>
                <button
                  style={{ ...lightBtnStyle, padding: "6px 10px" }}
                  onClick={() => movePlayer(index, 1)}
                  disabled={saving || index === order.length - 1}
                >
                  ↓
                </button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="dealer"
                  checked={dealerId === player.id}
                  onChange={() => setDealerId(player.id)}
                  disabled={saving}
                />
                Dealer
              </label>
            </div>
          ))}

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label>Quick set dealer</label>
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
                setOrder(players);
                setDealerId(currentDealerId);
                setSubSeatIndex(0);
                setSubSelection("NEW");
                setSubName("");
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
                border: "1px dashed #d1d5db",
                background: "#f9fafb",
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
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Substitutions are available before the first round is played.
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: "crimson", fontSize: 13 }}>{error}</div>
          )}
        </div>
      )}

      {!isAdmin && (
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          Only the admin can change seating or dealer order.
        </div>
      )}
    </Card>
  );
}
