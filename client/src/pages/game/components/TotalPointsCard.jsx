import React from "react";
import { Card, tableStyle, thStyle, tdStyle } from "./ui.js";

export default function TotalPointsCard({ players = [], totalsPoints = {} }) {
  const rows = players
    .map((player) => ({
      id: player.id,
      name: player.name,
      pts: Number(totalsPoints[player.id] || 0),
    }))
    .sort((a, b) => b.pts - a.pts);

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Total Points (This Game)</h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={{ ...thStyle, textAlign: "left" }}>Player</th>
            <th style={thStyle}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td style={tdStyle}>{index + 1}</td>
              <td style={{ ...tdStyle, textAlign: "left" }}>{row.name}</td>
              <td style={tdStyle}>{row.pts.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
