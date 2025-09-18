import React, { useMemo } from "react";
import {
  Card,
  tableStyle,
  thStyle,
  tdStyle,
  smallInputStyle,
  btnStyle,
  lightBtnStyle,
  pillStyle,
} from "./ui.js";
import HighBidPanel from "./HighBidPanel.jsx";

export default function RoundCard({
  roundNumber,
  info,
  players,
  roundData,
  isAdmin,
  saving,
  error,
  bidInputs = {},
  actualInputs = {},
  isEditingBids,
  isEditingActuals,
  autoAwardEnabled,
  highBid,
  selectedBidder,
  onSelectBidder,
  stakeText,
  onStakeTextChange,
  highBidError,
  onResolveHighBid,
  onCancelHighBid,
  onBidInput,
  onActualInput,
  onSubmitBids,
  onSubmitActuals,
  onToggleBids,
  onToggleActuals,
}) {
  const statusLabel = useMemo(() => {
    if (roundData.status === "AUTO_AWARDED") return "AUTO-AWARDED";
    if (roundData.status === "PLAYED") return "PLAYED";
    if (roundData.status === "BIDS_SET") return "BIDS SET";
    return "IN PROGRESS";
  }, [roundData.status]);

  const statusColor = useMemo(() => {
    if (roundData.status === "AUTO_AWARDED") return "#0a7";
    if (roundData.status === "PLAYED") return "#2563eb";
    if (roundData.status === "BIDS_SET") return "#111";
    return "#999";
  }, [roundData.status]);

  const bidderOrder = info?.bidderOrder || players.map((p) => p.id);
  const dealerId = info?.dealerId || bidderOrder[bidderOrder.length - 1];
  const firstBidderId = bidderOrder[0];

  const canEditActuals =
    roundData.status !== "AUTO_AWARDED" &&
    (isEditingActuals ||
      roundData.status === "BIDS_SET" ||
      roundData.status === "PLAYED");

  const bidTotalLive = useMemo(() => {
    let total = 0;
    for (const player of players) {
      const value = Number(bidInputs[player.id]);
      if (Number.isFinite(value)) total += value;
    }
    return total;
  }, [players, bidInputs]);

  const bidTotalCommitted = useMemo(() => {
    let total = 0;
    let hasPoints = false;
    for (const player of players) {
      if (roundData.bids?.[player.id] != null) {
        total += Number(roundData.bids[player.id]);
        hasPoints = true;
      }
    }
    return hasPoints ? total : null;
  }, [players, roundData.bids]);

  const allBidsFilled = useMemo(
    () =>
      players.every((player) =>
        Number.isFinite(Number(bidInputs[player.id] ?? ""))
      ),
    [players, bidInputs]
  );

  const actualsSum = useMemo(() => {
    let total = 0;
    for (const player of players) total += Number(actualInputs[player.id] ?? 0);
    return total;
  }, [players, actualInputs]);

  const allActualsFilled = useMemo(
    () =>
      players.every((player) =>
        Number.isFinite(Number(actualInputs[player.id] ?? ""))
      ),
    [players, actualInputs]
  );

  const remainingActuals = Math.max(0, 13 - actualsSum);
  const highBidActive = Boolean(highBid?.active);

  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>Round {roundNumber}</h3>
        <span style={{ color: statusColor }}>{statusLabel}</span>
      </div>

      {highBidActive && (
        <div style={{ marginTop: 12 }}>
          <HighBidPanel
            round={roundNumber}
            bidderIds={highBid.bidderIds || []}
            players={players}
            isAdmin={isAdmin}
            saving={saving}
            selectedBidder={selectedBidder}
            setSelectedBidder={onSelectBidder}
            stakeText={stakeText}
            setStakeText={onStakeTextChange}
            error={highBidError}
            onResolve={onResolveHighBid}
            onCancel={onCancelHighBid}
          />
        </div>
      )}

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left" }}>Player</th>
            <th style={thStyle}>Bid (1–13)</th>
            <th style={thStyle}>Actual (0–13)</th>
            <th style={thStyle}>Round Pts</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={player.id}>
              <td style={{ ...tdStyle, textAlign: "left" }}>
                {player.name}
                {player.id === firstBidderId && (
                  <small style={{ color: "#555" }}> (1st)</small>
                )}
                {player.id === dealerId && <b style={{ color: "#c2410c" }}> (D)</b>}
              </td>
              <td style={tdStyle}>
                {isAdmin && isEditingBids ? (
                  <input
                    type="number"
                    min={1}
                    max={13}
                    step={1}
                    value={bidInputs[player.id] ?? ""}
                    onChange={(event) =>
                      onBidInput(roundNumber, player.id, event.target.value)
                    }
                    style={smallInputStyle}
                    disabled={saving}
                  />
                ) : roundData.bids?.[player.id] != null ? (
                  roundData.bids[player.id]
                ) : (
                  "-"
                )}
              </td>
              <td style={tdStyle}>
                {isAdmin && canEditActuals ? (
                  <input
                    type="number"
                    min={0}
                    max={13}
                    step={1}
                    value={actualInputs[player.id] ?? ""}
                    onChange={(event) =>
                      onActualInput(roundNumber, player.id, event.target.value)
                    }
                    style={smallInputStyle}
                    disabled={saving}
                  />
                ) : roundData.status === "AUTO_AWARDED" ? (
                  "—"
                ) : roundData.actuals?.[player.id] != null ? (
                  roundData.actuals[player.id]
                ) : (
                  "-"
                )}
              </td>
              <td style={tdStyle}>
                {roundData.points?.[player.id] != null
                  ? Number(roundData.points[player.id]).toFixed(1)
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <div style={pillStyle}>
          Live Total: <b style={{ marginLeft: 6 }}>{bidTotalLive}</b>
          {roundNumber !== 5 && (
            autoAwardEnabled && bidTotalLive < 10 ? (
              <span style={{ marginLeft: 6 }}>• Auto-award ready</span>
            ) : !autoAwardEnabled ? (
              <span style={{ marginLeft: 6 }}>• Auto-award off</span>
            ) : null
          )}
        </div>

        {bidTotalCommitted != null && (
          <div
            style={{
              ...pillStyle,
              background: "#eef2ff",
              borderColor: "#dbeafe",
            }}
          >
            Committed Total: <b style={{ marginLeft: 6 }}>{bidTotalCommitted}</b>
          </div>
        )}

        {roundData.status !== "AUTO_AWARDED" && (
          <div
            style={{
              ...pillStyle,
              background: "#ecfeff",
              borderColor: "#bae6fd",
            }}
            title="13 − sum(typed actuals)"
          >
            Remaining: <b style={{ marginLeft: 6 }}>{remainingActuals}</b>
          </div>
        )}

        {isAdmin &&
          (isEditingBids ? (
            <button
              style={{
                ...btnStyle,
                background: allBidsFilled ? "#0a7" : "#9ca3af",
                border: `1px solid ${allBidsFilled ? "#0a7" : "#9ca3af"}`,
              }}
              disabled={!allBidsFilled || saving}
              onClick={() => onSubmitBids(roundNumber)}
            >
              {roundData.status ? "Update Bids" : "Set Bids"}
            </button>
          ) : (
            <button
              style={lightBtnStyle}
              disabled={saving}
              onClick={() => onToggleBids(roundNumber, true)}
            >
              Edit Bids
            </button>
          ))}

        {isAdmin && roundData.status !== "AUTO_AWARDED" && (
          <>
            {canEditActuals ? (
              <button
                style={{
                  ...btnStyle,
                  background:
                    allActualsFilled && actualsSum === 13 ? "#0a7" : "#9ca3af",
                  border: `1px solid ${
                    allActualsFilled && actualsSum === 13 ? "#0a7" : "#9ca3af"
                  }`,
                }}
                disabled={!allActualsFilled || actualsSum !== 13 || saving}
                onClick={() => onSubmitActuals(roundNumber)}
              >
                {roundData.status === "PLAYED"
                  ? "Update Actuals (sum 13)"
                  : "Set Actuals (sum 13)"}
              </button>
            ) : (
              <button
                style={lightBtnStyle}
                disabled={saving}
                onClick={() => onToggleActuals(roundNumber, true)}
              >
                Edit Actuals
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            color: "crimson",
            marginTop: 8,
            fontSize: 13,
            background: "#fff1f2",
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      {roundData.status === "AUTO_AWARDED" && (
        <div style={{ color: "#0a7", marginTop: 6 }}>Auto-awarded (bid + 0.1)</div>
      )}
    </Card>
  );
}
