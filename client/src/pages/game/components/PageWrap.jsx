import React from "react";
import { wrapStyle } from "./ui.js";

export default function PageWrap({ children }) {
  return <div style={wrapStyle}>{children}</div>;
}
