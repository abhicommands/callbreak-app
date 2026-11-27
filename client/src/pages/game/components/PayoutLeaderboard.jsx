import React from "react";
import { Card, formatBalance, tableStyle, thStyle, tdStyle } from "./ui.js";

export default function PayoutLeaderboard({ summary, children }) {
  const payouts = summary?.payouts || {};
  const active = summary?.players || [];
  const bench = summary?.inactivePlayers || [];
  const uniquePlayers = new Map();
  [...active, ...bench].forEach((player) => {
    if (player && !uniquePlayers.has(player.id)) {
      uniquePlayers.set(player.id, player);
    }
  });
  const rows = [...uniquePlayers.values()]
    .map((player) => ({
      id: player.id,
      name: player.name,
      amount: Number(payouts[player.id] || 0),
    }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Series Ledger</h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={{ ...thStyle, textAlign: "left" }}>Player</th>
            <th style={thStyle}>Payout</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td style={tdStyle}>{index + 1}</td>
              <td style={{ ...tdStyle, textAlign: "left" }}>{row.name}</td>
              <td style={tdStyle}>
                <b className={row.amount > 0 ? "balance-credit" : row.amount < 0 ? "balance-debit" : undefined}>{formatBalance(row.amount)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        Ledger updates after side games and final settlement.
      </div>
      {children}
    </Card>
  );
}
