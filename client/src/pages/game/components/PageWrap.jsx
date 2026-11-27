import React from "react";
import { wrapStyle } from "./ui.js";

export default function PageWrap({ children }) {
  return <div className="ledger-page" style={wrapStyle}>{children}</div>;
}
