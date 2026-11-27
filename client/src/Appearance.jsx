import React, { useLayoutEffect, useState } from "react";
import { Link } from "react-router-dom";

const key = "callbreak:appearance";
const themes = ["light", "dark", "felt"];
function preference() {
  try {
    const saved = localStorage.getItem(key);
    if (themes.includes(saved)) return saved;
  } catch { /* Private browsing can disable storage. */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "felt";
}

export default function Appearance() {
  const [theme, setTheme] = useState(preference);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const sync = (event) => { if (event.key === key || event.key === null) setTheme(preference()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [theme]);
  return <header className="app-bar">
    <Link to="/" aria-label="Callbreak home"><span aria-hidden="true">♠</span> Callbreak</Link>
    <select aria-label="Appearance" value={theme} onChange={(event) => {
      const value = event.target.value;
      setTheme(value);
      try { localStorage.setItem(key, value); } catch { /* Apply for this visit. */ }
    }}>
      <option value="felt">Green felt</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </header>;
}
