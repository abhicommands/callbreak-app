import React from "react";

export const wrapStyle = { maxWidth: 1100, margin: "24px auto", padding: "0 12px" };

export function Card({ children, accent = "#e5e7eb", bg = "#fff", style = {} }) {
  const viewStyle = {
    border: `1px solid ${accent}`,
    padding: 16,
    borderRadius: 12,
    background: bg,
    marginTop: 16,
    ...style,
  };
  return React.createElement("div", { style: viewStyle }, children);
}

export const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 12,
};

export const thStyle = {
  textAlign: "center",
  padding: "8px 6px",
  fontSize: 13,
  color: "#4b5563",
  borderBottom: "1px solid #e5e7eb",
};

export const tdStyle = {
  textAlign: "center",
  padding: "8px 6px",
  borderBottom: "1px solid #eef2f7",
  fontSize: 14,
};

export const inputStyle = {
  padding: 8,
  border: "1px solid #cbd5f5",
  borderRadius: 8,
  width: "100%",
  fontSize: 14,
  background: "#fff",
};

export const smallInputStyle = {
  ...inputStyle,
  width: 80,
};

export const btnStyle = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid #1f2937",
  background: "#111827",
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

export const lightBtnStyle = {
  ...btnStyle,
  background: "#4b5563",
  border: "1px solid #4b5563",
};

export const dangerBtnStyle = {
  ...btnStyle,
  background: "#b91c1c",
  border: "1px solid #991b1b",
};

export const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  fontSize: 13,
};
