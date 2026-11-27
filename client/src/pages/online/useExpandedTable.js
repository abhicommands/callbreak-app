import { useEffect, useState } from "react";

export default function useExpandedTable(inGame, element) {
  const [expanded, setExpanded] = useState(false);
  const active = Boolean(inGame && expanded);
  useEffect(() => {
    if (!active) return;
    const root = element.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const changed = () => { if (document.fullscreenElement !== root) setExpanded(false); };
    const escape = (event) => { if (event.key === "Escape") setExpanded(false); };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = previous;
      if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    };
  }, [active, element]);
  function toggle() {
    if (active) setExpanded(false);
    else {
      setExpanded(true);
      if (document.fullscreenEnabled) element.current?.requestFullscreen?.().catch(() => {});
    }
  }
  return { active, toggle };
}
