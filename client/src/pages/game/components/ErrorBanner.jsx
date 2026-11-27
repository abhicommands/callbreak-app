import React from "react";

export default function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div
      style={{
        color: "var(--danger)",
        background: "var(--danger-surface)",
        border: "1px solid var(--line)",
        padding: 10,
        borderRadius: 8,
        marginTop: 12,
      }}
    >
      {message}
    </div>
  );
}
