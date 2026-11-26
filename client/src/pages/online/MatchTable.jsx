import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { seatPosition } from "../../../../server/src/services/callbreakCards.js";
import GameTotals from "../game/components/GameTotals.jsx";
import TieSettlement from "../game/components/TieSettlement.jsx";

const RANKS = { A: "Ace", K: "King", Q: "Queen", J: "Jack" };
const SUITS = { S: ["♠", "Spades"], H: ["♥", "Hearts"], D: ["♦", "Diamonds"], C: ["♣", "Clubs"] };
const COLLECTION_MS = 1000;

function PlayingCard({ card, playable, highlighted, onPlay, table, style }) {
  const [symbol, suit] = SUITS[card[0]];
  const rank = card.slice(1);
  const label = `${RANKS[rank] ?? rank} of ${suit}`;
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(null);
  const color = card[0] === "H" || card[0] === "D" ? " playing-card-red" : "";
  const className = `playing-card${color}${highlighted ? " playing-card-legal" : ""}${offset ? " playing-card-drag" : ""}`;
  const content = <><span className="card-rank">{rank}<small>{symbol}</small></span>
    <span className="card-pip">{symbol}</span></>;

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
    ? <button className={className} type="button" aria-label={label} disabled={!playable}
      style={offset ? { ...style, "--drag-x": `${offset.x}px`, "--drag-y": `${offset.y}px` } : style}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release}
      onPointerCancel={() => { drag.current = null; setOffset(null); }}
      onClick={(event) => { if (!suppressClick.current || event.detail === 0) onPlay(); }}>{content}</button>
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

function MatchSeat({ player, position, mine, dealer, turn, clock, serverOffset, active, taken, lastWon, inspect }) {
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
      {taken.length > 0 && (
        <button type="button" className={`won-pile${lastWon ? " won-pile-latest" : ""}`}
          aria-label={`View ${name}'s collected tricks (${taken.length})`} onClick={inspect}>
          <span aria-hidden="true" className="won-pile-cards"><i /><i /></span><span>{taken.length}</span>
        </button>
      )}
      {turn && <TurnClock clock={clock} serverOffset={serverOffset} />}
    </div>
  );
}

function TrickSweep({ trick, winnerPosition, winnerName, position, serverOffset, delay = 0 }) {
  const stage = useRef(null);
  const [elapsed] = useState(() => performance.now() + serverOffset - trick.completedAt - delay);
  const [done, setDone] = useState(() => elapsed >= COLLECTION_MS);

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
    const timer = setTimeout(() => setDone(true), COLLECTION_MS - elapsed);
    return () => clearTimeout(timer);
  }, [done, elapsed, winnerPosition]);

  if (done) return null;
  return (
    <div className="felt-trick trick-sweep" ref={stage} data-collect-seat={winnerPosition}
      role="group" aria-label={`Collecting trick ${trick.number} for ${winnerName}`}
      style={{ "--sweep-delay": `${-elapsed}ms`, "--sweep-length": `${COLLECTION_MS}ms` }}>
      {trick.plays.map(({ seat, card }) => (
        <div key={card} className={`trick-card trick-${position(seat)}${seat === trick.winner ? " trick-winner" : ""}`}>
          <PlayingCard card={card} />
        </div>
      ))}
    </div>
  );
}

function TrickCollection({ name, tricks, close }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog className="trick-collection" ref={dialog} aria-label={`${name}'s collected tricks`} onClose={close}>
      <div className="trick-collection-heading">
        <h2>{name}'s collected tricks</h2>
        <button className="online-secondary" type="button" onClick={() => dialog.current.close()}>Close</button>
      </div>
      <ol>
        {tricks.map(({ number, plays }) => (
          <li key={number}>
            <span>Trick {number}</span>
            <div>{plays.map(({ card }) => <PlayingCard key={card} card={card} />)}</div>
          </li>
        ))}
      </ol>
    </dialog>
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
  const totals = finished && completed ? Object.entries(snapshot.summary.totalsPoints)
    .filter(([id]) => Object.values(game.roundData).some((round) => Object.hasOwn(round.points, id)))
    .sort((a, b) => b[1] - a[1]) : [];
  const settlement = finished && snapshot?.summary.settlement;
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

export default function MatchTable({ view, ready, command, serverOffset }) {
  const snapshot = view.scores;
  const felt = useRef(null);
  const [collection, setCollection] = useState(null);
  const { seat, turn, phase, hand, legal, round, trick, lastTrick, seats, previousBidTotal, lastAuto, taken = [] } = view;
  const active = phase === "bidding" || phase === "playing";
  const fourOnline = seats.every((player) => player?.online);
  const yourTurn = active && turn === seat;
  const canAct = ready && fourOnline && yourTurn;
  const position = (index) => seatPosition(index, seat);
  const trickNumber = seats.reduce((count, player) => count + (player?.wins ?? 0), 0);
  const tricksFor = (playerId) => taken.filter((item) => item.winnerId === playerId);
  const inspectedPlayer = collection?.round === round && seats.find((player) => player?.id === collection.id);
  const offset = serverOffset ?? view.serverOffset ?? 0;
  const sweeps = lastTrick?.automatic ? taken.slice(-2) : lastTrick?.completedAt ? [lastTrick] : [];
  const prompt = active
    ? !fourOnline ? "Player offline. Waiting for reconnect."
      : yourTurn ? (phase === "bidding" ? "Your turn to bid" : "Your turn to play")
        : `${seats[turn]?.name} to ${phase === "bidding" ? "bid" : "play"}`
    : phase === "between" ? "Deal complete" : "Game complete";
  const next = view.host && (
    <button disabled={!ready || !fourOnline || Boolean(snapshot?.summary.pendingTie?.length)}
      onClick={() => command(phase === "finished" ? "rematch" : "next")}>
      {phase === "finished" ? "Play again" : "Deal next round"}
    </button>
  );

  return (
    <>
      <div className={`match-layout${active ? " match-live" : ""}`}>
        <section className="match-surface" aria-label="Table">
          <div className="match-status">
            <span>Game {view.gameIndex} · Deal {round}/5</span>
            <strong role="status">{prompt}</strong>
          </div>
          <div className="card-felt" ref={felt}>
            <div className="felt-mark" aria-hidden="true">♠</div>
            <div className="felt-trick felt-current-trick" aria-label="Current trick">
              {trick.map(({ seat: player, card }) => (
                <div key={`${trickNumber + 1}:${card}`} className={`trick-card trick-${position(player)}`}>
                  <PlayingCard card={card} />
                </div>
              ))}
            </div>
            {sweeps.map((completed, index) => (
              <TrickSweep key={`${round}:${completed.number}`} trick={completed} winnerPosition={position(completed.winner)}
                winnerName={seats[completed.winner]?.name} position={position} serverOffset={offset}
                delay={index * COLLECTION_MS} />
            ))}
            {seats.map((player, index) => (
              <MatchSeat key={index} player={player} position={position(index)} mine={index === seat}
                dealer={index === view.dealer} turn={active && index === turn} clock={view.clock}
                serverOffset={offset} active={active} taken={player ? tricksFor(player.id) : []}
                lastWon={Boolean(player && lastTrick?.winnerId === player.id)}
                inspect={() => setCollection({ id: player.id, round })} />
            ))}
            {phase === "bidding" && yourTurn && <BidPicker ready={canAct} command={command} />}
          </div>
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
            <div className={`match-cards${yourTurn && phase === "playing" && legal.length ? " match-cards-selecting" : ""}`}>
              {hand.map((card, index) => (
                <PlayingCard key={card} card={card} playable={canAct && legal.includes(card)}
                  highlighted={legal.includes(card)} table={felt}
                  style={{ "--tilt": `${(index - (hand.length - 1) / 2) * 0.9}deg`,
                    "--entry": `${index * 13}ms` }}
                  onPlay={() => command("play", { value: card })} />
              ))}
            </div>
          </section>
        )}
      </div>
      {inspectedPlayer && <TrickCollection name={inspectedPlayer.name} tricks={tricksFor(inspectedPlayer.id)}
        close={() => setCollection(null)} />}
      {active ? <LiveStandings seats={seats} /> : <DealResults snapshot={snapshot} view={view} next={next} command={command} ready={ready} />}
      {snapshot && <GameTotals summary={snapshot.summary} />}
    </>
  );
}
