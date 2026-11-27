import React from "react";
import { Card, btnStyle, lightBtnStyle, pillStyle } from "./ui.js";

export default function GameSettingsPanel({
  autoAwardEnabled,
  isAdmin,
  saving,
  onToggleAutoAward,
}) {
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Game Settings</h3>
      <div style={{ fontSize: 14, color: "var(--muted)" }}>
        Auto-award when bids total &lt; 10 (rounds 1–4)
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            ...pillStyle,
            background: autoAwardEnabled ? "var(--tint)" : "var(--danger-surface)",
            borderColor: autoAwardEnabled ? "var(--line)" : "var(--line)",
          }}
        >
          Status: <b style={{ marginLeft: 6 }}>{autoAwardEnabled ? "Enabled" : "Disabled"}</b>
        </div>
        {isAdmin ? (
          <button
            style={{
              ...(autoAwardEnabled ? lightBtnStyle : btnStyle),
              padding: "8px 14px",
            }}
            disabled={saving}
            onClick={onToggleAutoAward}
          >
            {autoAwardEnabled ? "Turn Off" : "Turn On"}
          </button>
        ) : (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Only the admin can change this setting.
          </span>
        )}
      </div>
    </Card>
  );
}
