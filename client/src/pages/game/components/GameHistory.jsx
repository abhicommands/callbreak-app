import React, { useMemo } from "react";
import { Card, inputStyle, tableStyle, thStyle, tdStyle, pillStyle } from "./ui.js";

export default function GameHistory({
  series,
  history,
  error,
  loading,
  selectedGameId,
  onSelectGame,
}) {
  const players = useMemo(() => history?.players || [], [history]);
  const formatTs = (ts) => (ts ? new Date(ts).toLocaleString() : "");

  const roundSummaries = useMemo(() => {
    if (!history?.roundHistory) return [];
    return Object.entries(history.roundHistory)
      .map(([roundKey, snapshot]) => ({
        round: Number(roundKey),
        snapshot,
      }))
      .sort((a, b) => a.round - b.round);
  }, [history]);

  const totalsByPlayer = useMemo(() => {
    if (!roundSummaries.length) return null;
    const totals = {};
    for (const { snapshot } of roundSummaries) {
      for (const player of players) {
        const value = Number(snapshot.points?.[player.id] ?? 0);
        totals[player.id] = (totals[player.id] || 0) + value;
      }
    }
    return totals;
  }, [roundSummaries, players]);

  return (
    <Card accent="#c7d2fe" bg="#eef2ff">
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>Game History</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label>Game</label>
          <select
            value={selectedGameId || ""}
            onChange={(event) => onSelectGame(event.target.value || null)}
            style={{ ...inputStyle, width: 220 }}
            disabled={loading || !series}
          >
            {!series && <option value="">Loading…</option>}
            {series &&
              series.games.map((game) => (
                <option
                  key={game.gameId}
                  value={game.settlementApplied ? game.gameId : ""}
                  disabled={!game.settlementApplied}
                >
                  {`Game ${game.gameIndex} • ${formatTs(game.createdAt)}`}
                  {!game.settlementApplied ? " (in progress)" : ""}
                </option>
              ))}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ color: "crimson", marginTop: 8, fontSize: 13 }}>{error}</div>
      )}

      {loading && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#4b5563" }}>
          Loading history…
        </div>
      )}

      {!loading && history && roundSummaries.length === 0 && !error && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#4b5563" }}>
          No rounds recorded for this game yet.
        </div>
      )}

      {!loading && history && roundSummaries.length > 0 && (
        <>
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "#4b5563",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>Resolved at {formatTs(history.resolvedAt)}</span>
            <span style={pillStyle}>{history.name}</span>
          </div>

          {roundSummaries.map(({ round, snapshot }) => {
            const rows = players
              .map((player) => {
                const points =
                  snapshot.points?.[player.id] != null
                    ? Number(snapshot.points[player.id])
                    : null;
                return {
                  id: player.id,
                  name: player.name,
                  points,
                  bid: snapshot.bids?.[player.id] ?? null,
                  actual: snapshot.actuals?.[player.id] ?? null,
                };
              })
              .sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));

            return (
              <div key={round} style={{ marginTop: 16 }}>
                <h4 style={{ margin: "0 0 8px" }}>
                  Round {round}
                  <span style={{ fontSize: 13, color: "#6b7280", marginLeft: 8 }}>
                    {snapshot.status || "Pending"}
                  </span>
                </h4>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Rank</th>
                      <th style={{ ...thStyle, textAlign: "left" }}>Player</th>
                      <th style={thStyle}>Points</th>
                      <th style={thStyle}>Bid</th>
                      <th style={thStyle}>Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={row.id}>
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={{ ...tdStyle, textAlign: "left" }}>{row.name}</td>
                        <td style={tdStyle}>
                          {row.points != null ? row.points.toFixed(1) : "—"}
                        </td>
                        <td style={tdStyle}>{row.bid ?? "—"}</td>
                        <td style={tdStyle}>{row.actual ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {totalsByPlayer && (
            <div style={{ marginTop: 18 }}>
              <h4 style={{ margin: "0 0 8px" }}>Final Totals</h4>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Rank</th>
                    <th style={{ ...thStyle, textAlign: "left" }}>Player</th>
                    <th style={thStyle}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {players
                    .map((player) => ({
                      id: player.id,
                      name: player.name,
                      points: totalsByPlayer[player.id] || 0,
                    }))
                    .sort((a, b) => b.points - a.points)
                    .map((row, index) => (
                      <tr key={row.id}>
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={{ ...tdStyle, textAlign: "left" }}>{row.name}</td>
                        <td style={tdStyle}>{row.points.toFixed(1)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
