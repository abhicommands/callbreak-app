import React from "react";

export const wrapStyle = { maxWidth: 1100, margin: "24px auto", padding: "0 12px" };

export function Card({ as = "div", children, accent = "var(--line)", bg = "var(--surface)", style = {}, ...props }) {
  const viewStyle = {
    border: `1px solid ${accent}`,
    padding: 16,
    borderRadius: 12,
    background: bg,
    marginTop: 16,
    ...style,
  };
  return React.createElement(as, { ...props, style: viewStyle }, children);
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
  color: "var(--muted)",
  borderBottom: "1px solid var(--line)",
};

export const tdStyle = {
  textAlign: "center",
  padding: "8px 6px",
  borderBottom: "1px solid var(--line)",
  fontSize: 14,
};

export const inputStyle = {
  padding: 8,
  border: "1px solid var(--line)",
  borderRadius: 8,
  width: "100%",
  fontSize: 14,
  background: "var(--surface)",
};

export const smallInputStyle = {
  ...inputStyle,
  width: "100%",
  maxWidth: 80,
  minWidth: 48,
};

export const btnStyle = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid var(--action)",
  background: "var(--action)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

export const lightBtnStyle = {
  ...btnStyle,
  background: "var(--tint)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
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
  background: "var(--tint)",
  border: "1px solid var(--line)",
  fontSize: 13,
};

const balanceFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 6,
  useGrouping: false,
});

export const formatBalance = (amount) => balanceFormat.format(amount);
