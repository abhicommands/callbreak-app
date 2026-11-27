import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FINAL_CARD_INTERVAL_MS, FINAL_TRICK_MS, seatPosition, TRICK_SWEEP_MS } from "../../../../server/src/services/callbreakCards.js";
import GameTotals from "../game/components/GameTotals.jsx";
import TieSettlement from "../game/components/TieSettlement.jsx";

const RANKS = { A: "Ace", K: "King", Q: "Queen", J: "Jack" };
const SUITS = { S: ["♠", "Spades"], H: ["♥", "Hearts"], D: ["♦", "Diamonds"], C: ["♣", "Clubs"] };

// Each pair locates a pip on a five-column, seven-row card face.
const pipRows = {
  2: ["31", "37"], 3: ["31", "34", "37"], 4: ["11", "51", "17", "57"],
  5: ["11", "51", "34", "17", "57"], 6: ["11", "51", "14", "54", "17", "57"],
  7: ["11", "51", "32", "14", "54", "17", "57"], 8: ["11", "51", "32", "14", "54", "36", "17", "57"],
  9: ["11", "51", "13", "53", "34", "15", "55", "17", "57"],
  10: ["11", "51", "32", "13", "53", "15", "55", "36", "17", "57"],
};

function PlayingCard({ card, playable, highlighted, selected, onSelect, onPlay, table, style }) {
  const [symbol, suit] = SUITS[card[0]];
  const rank = card.slice(1);
  const label = `${RANKS[rank] ?? rank} of ${suit}`;
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(null);
  const color = card[0] === "H" || card[0] === "D" ? " playing-card-red" : "";
  const className = `playing-card${color}${highlighted ? " playing-card-legal" : ""}${offset ? " playing-card-drag" : ""}`;
  const content = <><span className="card-rank">{rank}<small>{symbol}</small></span>
    {pipRows[rank] ? <span className="pip-field" aria-hidden="true">{pipRows[rank].map((position) =>
      <i key={position} style={{ gridColumn: position[0], gridRow: position[1] }}>{symbol}</i>)}</span>
      : <span className="card-pip" aria-hidden="true">{({ J: "♞", Q: "♛", K: "♚" })[rank] ?? symbol}</span>}</>;

  function grab(event) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!drag.current) return;
    const x = event.clientX - drag.current.x;
    const y = event.clientY - drag.current.y;
    if (drag.current.active || Math.hypot(x, y) >= 9) {
      drag.current.active = true;
      setOffset({ x, y });
    }
  }
  function release(event) {
    const active = drag.current?.active;
    drag.current = null;
    setOffset(null);
    if (!active) return;
    suppressClick.current = true;
    const area = table.current?.getBoundingClientRect();
    if (area && event.clientX >= area.left && event.clientX <= area.right &&
      event.clientY >= area.top && event.clientY <= area.bottom) onPlay();
  }

  return onPlay
    ? <button className={className} type="button" aria-label={label} aria-pressed={selected} disabled={!playable}
      style={offset ? { ...style, "--drag-x": `${offset.x}px`, "--drag-y": `${offset.y}px` } : style}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release}
      onPointerCancel={() => { drag.current = null; setOffset(null); }}
      onClick={(event) => { if (!suppressClick.current || event.detail === 0) onSelect(); }}>{content}</button>
    : <span className={className} role="img" aria-label={label}>{content}</span>;
}

function TurnClock({ clock, serverOffset }) {
  const [time, setTime] = useState(() => performance.now());
  const deadline = clock?.deadline;
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setTime(performance.now()), 100);
    return () => clearInterval(timer);
  }, [deadline]);
  if (!clock) return null;
  const remaining = Math.max(0, deadline == null ? clock.remainingMs :
    Math.min(clock.limitMs, deadline - (serverOffset + time)));
  const seconds = Math.ceil(remaining / 1000);
  return <span className="turn-clock" style={{ "--clock": `${remaining / clock.limitMs * 100}%` }}
    aria-label={`${seconds} seconds ${deadline == null ? "paused" : "left"}`}>{seconds}</span>;
}

function MatchSeat({ player, position, mine, dealer, turn, clock, serverOffset, active, lastWon }) {
  const name = player?.name || "Open seat";
  const initials = player?.name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("") ?? "–";
  return (
    <div className={`match-seat match-seat-${position}${turn ? " match-seat-turn" : ""}${!player?.online ? " match-seat-offline" : ""}`}
      data-seat={position} aria-current={turn ? "true" : undefined} title={name}>
      <div className="seat-avatar" aria-hidden="true">{initials}</div>
      <div className="seat-info">
        <div className="seat-name"><strong>{name}</strong>{dealer && <span className="dealer-chip" aria-label="Dealer">D</span>}</div>
        <span>{mine ? "You" : ""}{mine && !player?.online ? " · " : ""}{!player?.online && (player ? "Offline" : "Waiting")}</span>
        {active && player && <span className="seat-tally" aria-label={`${player.wins} won, ${player.bid ?? "no"} bid`}>
          {player.wins}<span> / {player.bid ?? "–"}</span></span>}
      </div>
      {!mine && player?.cards > 0 && <span aria-hidden="true" className="seat-card-backs"><i /><i /><i /></span>}
      {player?.wins > 0 && (
        <span className={`won-pile${lastWon ? " won-pile-latest" : ""}`}
          role="img" aria-label={`${name}, ${player.wins} tricks won`}>
          <span aria-hidden="true" className="won-pile-cards"><i /><i /></span><span>{player.wins}</span>
        </span>
      )}
      {turn && <TurnClock clock={clock} serverOffset={serverOffset} />}
    </div>
  );
}

function TrickSweep({ trick, winnerPosition, winnerName, position, serverOffset, delay = 0 }) {
  const stage = useRef(null);
  const duration = trick.automatic ? FINAL_TRICK_MS : TRICK_SWEEP_MS;
  const [elapsed] = useState(() => performance.now() + serverOffset - trick.completedAt - delay);
  const [done, setDone] = useState(() => elapsed >= duration);

  useLayoutEffect(() => {
    if (done) return;
    const winner = stage.current?.parentElement?.querySelector(`[data-seat="${winnerPosition}"]`);
    const target = (winner?.querySelector(".won-pile-cards") ?? winner)?.getBoundingClientRect();
    if (target && stage.current) {
      const positions = Array.from(stage.current.children, (card) => ({ card, start: card.getBoundingClientRect() }));
      for (const { card, start } of positions) {
        card.style.setProperty("--collect-x", `${target.x + target.width / 2 - start.x - start.width / 2}px`);
        card.style.setProperty("--collect-y", `${target.y + target.height / 2 - start.y - start.height / 2}px`);
      }
    }
    const timer = setTimeout(() => setDone(true), duration - elapsed);
    return () => clearTimeout(timer);
  }, [done, duration, elapsed, winnerPosition]);

  if (done) return null;
  return (
    <div className={`felt-trick trick-sweep${trick.automatic ? " final-sweep" : ""}`} ref={stage} data-collect-seat={winnerPosition}
      role="group" aria-label={`Collecting trick ${trick.number} for ${winnerName}`}
      style={{ "--sweep-delay": `${-elapsed}ms`, "--sweep-length": `${duration}ms`,
        "--winner-delay": `${(trick.plays.length - 1) * FINAL_CARD_INTERVAL_MS + 230 - elapsed}ms` }}>
      {trick.plays.map(({ seat, card }, index) => (
        <div key={card} className={`trick-card trick-${position(seat)}${seat === trick.winner ? " trick-winner" : ""}`}>
          <div className="sweep-face" style={{ "--face-delay": `${index * FINAL_CARD_INTERVAL_MS - elapsed}ms` }}>
            <PlayingCard card={card} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveStandings({ seats }) {
  const entries = seats.filter(Boolean).sort((a, b) => b.wins - a.wins);
  return (
    <details className="online-panel table-controls match-live-scores">
      <summary>This deal</summary>
      <table className="online-scores">
        <thead><tr><th scope="col">Player</th><th scope="col">Bid</th><th scope="col">Won</th></tr></thead>
        <tbody>{entries.map((player, index) => <tr key={index}>
          <th scope="row">{player.name}</th><td>{player.bid ?? "–"}</td><td>{player.wins}</td>
        </tr>)}</tbody>
      </table>
    </details>
  );
}

function BidPicker({ ready, command }) {
  const [more, setMore] = useState(false);
  const bids = more ? [6, 7, 8, 9, 10, 11, 12, 13] : [1, 2, 3, 4, 5];
  return (
    <section className="match-bids" aria-label="Bid">
      <div>
        {bids.map((bid) => (
          <button type="button" key={bid} disabled={!ready} aria-label={`Bid ${bid}`}
            onClick={() => command("bid", { value: bid })}>{bid}</button>
        ))}
        <button type="button" className="bid-more" aria-label={more ? "Lower bids" : "More bids"}
          onClick={() => setMore(!more)}>{more ? "‹" : "…"}</button>
      </div>
    </section>
  );
}

function DealResults({ snapshot, view, next, command, ready }) {
  const game = snapshot?.game;
  const completed = game?.gameIndex === view.gameIndex ? game.roundData[view.round] : null;
  const finished = view.phase === "finished";
  const names = completed ? new Map([...game.players, ...game.inactivePlayers].map(({ id, name }) => [id, name])) : null;
  const leaders = completed ? Object.keys(completed.points).sort((a, b) => completed.points[b] - completed.points[a]) : [];
  const settlement = finished && snapshot?.summary.settlement;
  const totals = settlement ? settlement.ranking.map(({ id, total }) => [id, total]) : finished && completed ? Object.entries(snapshot.summary.totalsPoints)
    .filter(([id]) => Object.values(game.roundData).some((round) => Object.hasOwn(round.points, id)))
    .sort((a, b) => b[1] - a[1]) : [];
  const winners = settlement && (settlement.winnerIds ?? [settlement.ranking[0].id])
    .map((id) => settlement.ranking.find((entry) => entry.id === id).name);
  const tie = finished ? snapshot?.summary.pendingTie ?? [] : [];

  return (
    <section className="online-panel match-results" aria-label={finished ? "Game results" : "Deal results"}>
      <div className="match-results-heading">
        <h2>{finished ? "Game results" : `Deal ${view.round} results`}</h2>
        {next}
      </div>
      {!completed ? <p role="status">Saving scores…</p> : (
        <>
          {finished && (
            <>
              {winners && <p><strong>{winners.length > 1 ? "Shared first place" : "Game winner"}</strong> · {winners.join(", ")}</p>}
              {tie.length > 0 && <TieSettlement players={tie} ready={ready}
                onSettle={view.host ? (value) => command("settle", { value }) : undefined} />}
              {game.settlementSkipped && <p>Payouts were skipped because the roster changed.</p>}
              <ol className="match-standings" aria-label="Final points">
                {totals.map(([id, points]) => <li key={id}><strong>{names.get(id)}</strong><span>{points.toFixed(1)}</span></li>)}
              </ol>
            </>
          )}
          <table className="online-scores">
            {finished && <caption>Deal {view.round} results</caption>}
            <thead><tr><th scope="col">Player</th><th scope="col">Bid</th><th scope="col">Won</th><th scope="col">Points</th></tr></thead>
            <tbody>
              {leaders.map((id) => <tr key={id}><th scope="row">{names.get(id)}</th>
                <td>{completed.bids[id]}</td><td>{completed.actuals[id]}</td><td>{completed.points[id].toFixed(1)}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export default function MatchTable({ view, ready, connected, command, serverOffset }) {
  const snapshot = view.scores;
  const felt = useRef(null);
  const [released, setReleased] = useState(0);
  const { seat, turn, phase, hand, legal, round, trick, lastTrick, seats, previousBidTotal, lastAuto,
    penultimate, lastWinnerId, revealUntil, side } = view;
  const active = phase === "bidding" || phase === "playing";
  const seatsReady = seats.every((player) => player && player.reserved !== false);
  const [selection, setSelection] = useState(null);
  const selectedCard = selection?.turn === view.turnVersion && ready ? selection.card : null;
  const yourTurn = active && turn === seat;
  const canAct = ready && seatsReady && yourTurn;
  const position = (index) => seatPosition(index, seat);
  const trickNumber = seats.reduce((count, player) => count + (player?.wins ?? 0), 0);
  const offset = serverOffset ?? view.serverOffset ?? 0;
  const revealing = !active && revealUntil > view.now && released !== revealUntil;
  const sweeps = [penultimate, lastTrick].filter(Boolean);
  useEffect(() => {
    if (!revealing) return;
    const timer = setTimeout(() => setReleased(revealUntil), Math.max(0, revealUntil - performance.now() - offset));
    return () => clearTimeout(timer);
  }, [offset, revealUntil, revealing]);
  const prompt = !connected ? "Reconnecting…" : !ready ? "Saving move…" : active
    ? !seatsReady ? "A player left. Waiting for their seat to be restored."
      : yourTurn ? (phase === "bidding" ? "Your turn to bid" : "Your turn to play")
        : `${seats[turn]?.name} to ${phase === "bidding" ? "bid" : "play"}`
    : revealing ? "Final trick" : phase === "side-result" ? "Side game complete" : phase === "between" ? "Deal complete" : "Game complete";
  const next = view.host && (
    <button disabled={!ready || !seatsReady || Boolean(snapshot?.summary.pendingTie?.length)}
      onClick={() => command(phase === "finished" ? "rematch" : "next")}>
      {phase === "finished" ? "Play again" : phase === "side-result" ? "Resume regular deal" : "Deal next round"}
    </button>
  );

  return (
    <>
      <div className={`match-layout${active ? " match-live" : ""}`}>
        <section className="match-surface" aria-label="Table">
          <div className="match-status">
            <span>{side ? `Side game · ${seats[side.bidder]?.name ?? "Bidder"} called ${side.bid}` :
              `Game ${view.gameIndex} · Deal ${round}/5${phase === "playing" ? " · Trick " + (trickNumber + 1) : ""}`}</span>
            <strong data-your-turn={canAct || undefined} role="status">{prompt}</strong>
          </div>
          <div className="card-felt" ref={felt}>
            <div className="felt-mark" aria-hidden="true"><span>♠</span></div>
            <div className="felt-trick felt-current-trick" aria-label="Current trick">
              {trick.map(({ seat: player, card }) => (
                <div key={`${trickNumber + 1}:${card}`} className={`trick-card trick-${position(player)}`}>
                  <PlayingCard card={card} />
                </div>
              ))}
            </div>
            {sweeps.map((completed) => (
              <TrickSweep key={`${round}:${completed.number}`} trick={completed} winnerPosition={position(completed.winner)}
                winnerName={seats[completed.winner]?.name} position={position} serverOffset={offset}
                delay={completed.automatic ? TRICK_SWEEP_MS : 0} />
            ))}
            {seats.map((player, index) => (
              <MatchSeat key={index} player={player} position={position(index)} mine={index === seat}
                dealer={index === view.dealer} turn={active && index === turn} clock={view.clock}
                serverOffset={offset} active={active} lastWon={Boolean(!revealing && player && lastWinnerId === player.id)} />
            ))}
          </div>
          {phase === "bidding" && yourTurn && <BidPicker ready={canAct} command={command} />}
          {(active && phase === "bidding" && previousBidTotal !== null) && (
            <p className="match-notice">Bids totaled {previousBidTotal}. Bid again with the same cards.</p>
          )}
          {active && lastAuto && <p className="match-notice">{seats[lastAuto.seat]?.name} · {lastAuto.action === "bid" ?
            `bid ${lastAuto.value} automatically` : "card played automatically"}</p>}
        </section>
        {active && (
          <section className="match-hand" aria-label="Your hand">
            <div className="match-hand-heading"><h2>Your hand</h2>
              <span>{hand.length} cards{yourTurn && phase === "playing" ? ` · ${legal.length} playable` : ""}</span></div>
            {canAct && phase === "playing" && <p className="hand-hint">{selectedCard ? "Tap the selected card again to play" : "Tap a card to select it"}</p>}
            <div className={`match-cards${yourTurn && phase === "playing" && legal.length ? " match-cards-selecting" : ""}`}>
              {hand.map((card, index) => (
                <PlayingCard key={card} card={card} playable={canAct && legal.includes(card)}
                  highlighted={legal.includes(card)} table={felt} selected={canAct && selectedCard === card}
                  onSelect={() => {
                    if (selectedCard === card) command("play", { value: card });
                    else setSelection({ turn: view.turnVersion, card });
                  }}
                  style={{ "--tilt": `${(index - (hand.length - 1) / 2) * 0.9}deg`,
                    "--entry": `${index * 13}ms` }}
                  onPlay={() => command("play", { value: card })} />
              ))}
            </div>
          </section>
        )}
      </div>
      {active ? <LiveStandings seats={seats} /> : !revealing && (
        phase === "side-result" ? <section className="online-panel match-results" aria-label="Side game results">
          <div className="match-results-heading"><h2>Side game results</h2>{next}</div>
          <p>{side.outcome === "WIN" ? "High call made" : "High call missed"}. Regular deal {round} keeps its dealer.</p>
        </section> : <DealResults snapshot={snapshot} view={view} next={next} command={command} ready={ready} />
      )}
      {snapshot && <GameTotals summary={snapshot.summary} />}
    </>
  );
}
