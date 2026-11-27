import React, { useEffect, useRef, useState } from "react";

export default function CopyLinkButton({ url, children, selectLink, ...props }) {
  const [feedback, setFeedback] = useState("");
  const reset = useRef(null);
  useEffect(() => () => clearTimeout(reset.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      clearTimeout(reset.current);
      setFeedback("Copied!");
      reset.current = setTimeout(() => setFeedback(""), 2000);
    } catch {
      clearTimeout(reset.current);
      setFeedback("Copy manually");
      selectLink?.();
    }
  }

  return <>
    <button type="button" {...props} onClick={copy}>
      <span className="copy-label" aria-live="polite">
        <span style={{ visibility: feedback ? "hidden" : "visible" }}>{children}</span>
        {feedback && <span>{feedback}</span>}
      </span>
    </button>
    {feedback === "Copy manually" && !selectLink &&
      <input aria-label="Link to copy" readOnly value={url} onFocus={(event) => event.target.select()} />}
  </>;
}
