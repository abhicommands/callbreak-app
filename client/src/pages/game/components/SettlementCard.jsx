import React from "react";
import { Card, tableStyle, thStyle, tdStyle } from "./ui.js";

export default function SettlementCard({ summary }) {
  const settlement = summary?.settlement;
  if (!settlement || !summary?.settlementApplied) return null;

  const { totalsPoints = {}, perPlayerDelta = {}, ranking = [] } = settlement;
  const byId = Object.fromEntries((summary.players || []).map((player) => [player.id, player]));
  const rows = (
    ranking.length
      ? ranking
      : (summary.players || []).map((player) => ({
          id: player.id,
          total: totalsPoints[player.id] || 0,
        }))
  ).map((row) => ({
    id: row.id,
    name: byId[row.id]?.name || row.id,
    points: Number(totalsPoints[row.id] || 0),
    delta: Number(perPlayerDelta[row.id] || 0),
  }));

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>This Game Settlement (Applied)</h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={{ ...thStyle, textAlign: "left" }}>Player</th>
            <th style={thStyle}>Points</th>
            <th style={thStyle}>Δ Payout</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td style={tdStyle}>{index + 1}</td>
              <td style={{ ...tdStyle, textAlign: "left" }}>{row.name}</td>
              <td style={tdStyle}>{row.points.toFixed(1)}</td>
              <td style={tdStyle}>
                <b>
                  {row.delta >= 0
                    ? `+${row.delta.toFixed(1)}`
                    : row.delta.toFixed(1)}
                </b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
