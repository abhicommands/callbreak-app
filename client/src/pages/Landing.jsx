import React from "react";
import { Link } from "react-router-dom";
import "./landing.css";

export default function Landing() {
  return (
    <main className="mode-home">
      <div className="mode-title">
        <span aria-hidden="true">♠</span>
        <h1>Callbreak</h1>
      </div>
      <div className="mode-grid">
        <Link className="mode-tile mode-play" to="/play">
          <div className="mode-art" aria-hidden="true">
            <span className="mode-card mode-card-left">K<br />♦</span>
            <span className="mode-card mode-card-front">A<br />♠</span>
            <span className="mode-card mode-card-right">Q<br />♥</span>
          </div>
          <div className="mode-caption">
            <div><h2>Callbreak Online</h2><p>Play a live game with three friends.</p></div>
            <span aria-hidden="true">↗</span>
          </div>
        </Link>
        <Link className="mode-tile mode-ledger" to="/ledger">
          <div className="mode-art" aria-hidden="true">
            <div className="mode-sheet">
              <span>♠</span>
              <i /><i /><i />
            </div>
          </div>
          <div className="mode-caption">
            <div><h2>Callbreak Ledger</h2><p>Track scores and payouts for in-person play.</p></div>
            <span aria-hidden="true">↗</span>
          </div>
        </Link>
      </div>
    </main>
  );
}
