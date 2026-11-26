import React, { useState } from "react";
import {
  DEFAULT_MINIMUM_BID, PACE_OPTIONS, PAYOUT_OPTIONS,
} from "../../../../server/src/services/tableSettings.js";

export function SettingsFields({ settings = {} }) {
  const [bidSeconds, setBid] = useState(settings.bidSeconds ?? PACE_OPTIONS.Standard.bidSeconds);
  const [playSeconds, setPlay] = useState(settings.playSeconds ?? PACE_OPTIONS.Standard.playSeconds);
  const [weights, setWeights] = useState(settings.weights ?? PAYOUT_OPTIONS[0]);
  return (
    <>
      <fieldset className="table-settings">
        <legend>Game pace</legend>
        <div className="setting-presets">
          {Object.entries(PACE_OPTIONS).map(([label, pace]) => (
            <button key={label} type="button" aria-pressed={Number(bidSeconds) === pace.bidSeconds && Number(playSeconds) === pace.playSeconds}
              onClick={() => { setBid(pace.bidSeconds); setPlay(pace.playSeconds); }}>{label}</button>
          ))}
        </div>
        <div className="setting-fields">
          <label>Seconds to bid<input name="bidSeconds" type="number" inputMode="numeric"
            value={bidSeconds} onChange={(event) => setBid(event.target.value)} required min={0} max={120} /></label>
          <label>Seconds to play<input name="playSeconds" type="number" inputMode="numeric"
            value={playSeconds} onChange={(event) => setPlay(event.target.value)} required min={0} max={120} /></label>
          <label>Minimum total bid<input name="minimumBid" type="number" inputMode="numeric"
            defaultValue={settings.minimumBid ?? DEFAULT_MINIMUM_BID} min={4} max={13} required /></label>
        </div>
        <p className="online-muted">Use 0 for an untimed turn. On timeout, the table makes a legal move.</p>
      </fieldset>
      <fieldset className="table-settings">
        <legend>Ledger payouts</legend>
        <div className="setting-presets">
          {PAYOUT_OPTIONS.map((preset) => (
            <button key={preset.join("/")} type="button" aria-pressed={preset.every((weight, index) => Number(weights[index]) === weight)}
              onClick={() => setWeights(preset)}>{preset.join(" / ")}</button>
          ))}
        </div>
        <div className="setting-fields">
          {["2nd place", "3rd place", "4th place"].map((label, index) => (
            <label key={label}>{label}<input name={`weight${index}`} value={weights[index]} type="number"
              inputMode="decimal" min={0} max={10000} step="0.001" required onChange={(event) =>
                setWeights((values) => values.map((value, offset) => offset === index ? event.target.value : value))} /></label>
          ))}
          <label>Stake multiplier<input name="stake" type="number" inputMode="decimal"
            defaultValue={settings.stake ?? 1} min="0.001" max={10000} step="0.001" required /></label>
        </div>
      </fieldset>
    </>
  );
}

export function RulesSummary({ settings }) {
  if (!settings) return null;
  const pace = Object.entries(PACE_OPTIONS).find(([, option]) =>
    option.bidSeconds === settings.bidSeconds && option.playSeconds === settings.playSeconds)?.[0] ?? "Custom";
  const duration = (seconds) => seconds ? `${seconds}s` : "Untimed";
  return (
    <dl className="online-rules">
      <div><dt>Pace</dt><dd>{pace} · {duration(settings.bidSeconds)} bid / {duration(settings.playSeconds)} play</dd></div>
      <div><dt>Minimum bid</dt><dd>{settings.minimumBid} combined</dd></div>
      <div><dt>Payouts</dt><dd>{settings.weights.join(" / ")} × {settings.stake}</dd></div>
    </dl>
  );
}
