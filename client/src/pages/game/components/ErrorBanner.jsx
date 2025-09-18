import React from "react";

export default function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div
      style={{
        color: "crimson",
        background: "#fff1f2",
        border: "1px solid #fecdd3",
        padding: 10,
        borderRadius: 8,
        marginTop: 12,
      }}
    >
      {message}
    </div>
  );
}
