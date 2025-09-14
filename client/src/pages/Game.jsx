import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getGame,
  getSummary,
  setBids,
  setActuals,
  resolveHighBid,
  resolveGame,
  nextGame,
} from "../api";

export default function Game() {
  const params = useParams();
  const gameId = params.id || params.gameId;
  const navigate = useNavigate();
  const adminKey = localStorage.getItem(`adminKey:${gameId}`) || null;

  const [game, setGame] = useState(null);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState({}); // For inline errors instead of alerts
  const [cancelledHighBids, setCancelledHighBids] = useState({}); // Locally hide cancelled side-games

  // local inputs (string while typing)
  const [bidInputs, setBidInputs] = useState({});
  const [actualInputs, setActualInputs] = useState({});

  // per-round edit toggles (editable even after PLAYED)
  const [editBids, setEditBids] = useState({});
  const [editActuals, setEditActuals] = useState({});

  // high-bid ui
  const [selectedBidder, setSelectedBidder] = useState("");
  const [highStakeText, setHighStakeText] = useState("3"); // string while typing

  async function refresh(attempts = 3) {
    setErr("");
    for (let i = 0; i < attempts; i++) {
      try {
        const [g, s] = await Promise.all([getGame(gameId), getSummary(gameId)]);
        setGame(g);
        setSummary(s);

        // seed inputs from server state
        const seedB = {},
          seedA = {};
        for (let r = 1; r <= 5; r++) {
          const rd = g.roundData?.[r] || {};
          seedB[r] = {};
          seedA[r] = {};
          (g.players || []).forEach((pl) => {
            const b = rd.bids?.[pl.id];
            const a = rd.actuals?.[pl.id];
            seedB[r][pl.id] = b == null ? "" : String(b);
            seedA[r][pl.id] = a == null ? "" : String(a);
          });
        }
        setBidInputs(seedB);
        setActualInputs(seedA);

        // default edit states: closed; you can open via "Edit ..." buttons
        const eb = {},
          ea = {};
        for (let r = 1; r <= 5; r++) {
          const rd = g.roundData?.[r] || {};
          eb[r] = rd.status == null; // open if nothing set yet
          ea[r] = rd.status === "BIDS_SET"; // open if awaiting actuals
        }
        setEditBids(eb);
        setEditActuals(ea);

        // Reset cancelledHighBids to ensure panel shows if highBid is active
        setCancelledHighBids({});

        if (g.highBid?.active && Array.isArray(g.highBid.bidderIds)) {
          setSelectedBidder(
            g.highBid.bidderIds.length === 1 ? g.highBid.bidderIds[0] : ""
          );
        } else {
          setSelectedBidder("");
        }
        return; // Success
      } catch (e) {
        if (i === attempts - 1) setErr(e.message || "Failed to load game data");
      }
    }
  }

  useEffect(() => {
    if (gameId) {
      refresh().catch((e) => setErr(e.message));
    }
  }, [gameId]);

  const isAdmin = Boolean(adminKey);
  const players = game?.players || [];

  const rounds = useMemo(() => {
    if (!game) return [];
    return Array.from({ length: 5 }).map((_, i) => {
      const r = i + 1;
      const rd = game.roundData?.[r] || {
        bids: {},
        actuals: {},
        points: {},
        status: undefined,
      };
      const info = summary?.roundInfo?.[r] || game?.roundInfo?.[r] || null;
      return { round: r, info, ...rd };
    });
  }, [game, summary]);

  const allRoundsResolved = useMemo(
    () =>
      rounds.length === 5 &&
      rounds.every((x) => x.status === "AUTO_AWARDED" || x.status === "PLAYED"),
    [rounds]
  );

  // ---- Set bids (all 4 at once, 1–13; >=8 triggers high-bid) ----
  const setRoundBids = async (round) => {
    if (!isAdmin) return;
    setFormErrors((p) => ({ ...p, [round]: null })); // Clear previous errors
    const bids = {};
    for (const p of players) {
      const raw = bidInputs?.[round]?.[p.id] ?? "";
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 1 || v > 13 || !Number.isInteger(v)) {
        setFormErrors((p) => ({
          ...p,
          [round]: "Enter valid integer bids (1–13) for all players.",
        }));
        return;
      }
      bids[p.id] = v;
    }
    try {
      setSaving(true);
      await setBids(gameId, { adminKey, round, bids });
      await refresh();
      setEditBids((prev) => ({ ...prev, [round]: false }));
    } catch (e) {
      if (e.status === 409) {
        setFormErrors((p) => ({
          ...p,
          [round]:
            e?.data?.message ||
            e?.data?.error ||
            "High bid triggered! Resolve the side game below, or cancel to re-enter bids.",
        }));
        setCancelledHighBids((p) => ({ ...p, [round]: false })); // Ensure panel shows
        await refresh(); // Show high-bid panel
      } else {
        setFormErrors((p) => ({
          ...p,
          [round]: e.message || "Failed to set bids",
        }));
      }
    } finally {
      setSaving(false);
    }
  };

  // ---- Set actuals (must sum to 13) ----
  const setRoundActuals = async (round) => {
    if (!isAdmin) return;
    setFormErrors((p) => ({ ...p, [round]: null })); // Clear previous errors
    const actuals = {};
    let sum = 0;
    for (const p of players) {
      const raw = actualInputs?.[round]?.[p.id] ?? "";
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 13 || !Number.isInteger(v)) {
        setFormErrors((p) => ({
          ...p,
          [round]: "Enter valid integer actuals (0–13) for all players.",
        }));
        return;
      }
      sum += v;
      actuals[p.id] = v;
    }
    if (sum !== 13) {
      setFormErrors((p) => ({ ...p, [round]: "Actuals must sum to 13." }));
      return;
    }
    try {
      setSaving(true);
      await setActuals(gameId, { adminKey, round, actuals });
      await refresh();
      setEditActuals((prev) => ({ ...prev, [round]: false }));
    } catch (e) {
      setFormErrors((p) => ({
        ...p,
        [round]: e.message || "Failed to set actuals",
      }));
    } finally {
      setSaving(false);
    }
  };

  // ---- High-bid resolve ----
  const resolveHighBidWinner = async (winnerId) => {
    if (!isAdmin || !game?.highBid?.active) return;
    const round = game.highBid.round;
    setFormErrors((p) => ({ ...p, highBid: null }));

    if (!selectedBidder) {
      setFormErrors((p) => ({
        ...p,
        highBid: "Select the high-bidder first.",
      }));
      return;
    }
    if (!highStakeText) {
      setFormErrors((p) => ({ ...p, highBid: "Enter stake per loser." }));
      return;
    }
    const stake = Number(highStakeText);
    if (!Number.isFinite(stake) || stake <= 0) {
      setFormErrors((p) => ({
        ...p,
        highBid: "Stake must be a positive number.",
      }));
      return;
    }

    try {
      setSaving(true);
      await resolveHighBid(gameId, {
        adminKey,
        round,
        bidderId: selectedBidder,
        winnerId,
        stake,
      });
      await refresh();
      alert("Side game resolved. Re-enter bids and Set Bids to continue.");
    } catch (e) {
      setFormErrors((p) => ({
        ...p,
        highBid: e.message || "Failed to resolve side game",
      }));
    } finally {
      setSaving(false);
    }
  };

  // ---- High-bid cancel ----
  const onCancelHighBid = async () => {
    if (!game?.highBid?.round) return;
    const round = game.highBid.round;
    try {
      setSaving(true);
      const response = await fetch(`/api/game/${gameId}/cancel-highbid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminKey, round }),
      });
      if (!response.ok) {
        throw new Error("Failed to cancel high bid");
      }
      await refresh();
      setEditBids((prev) => ({ ...prev, [round]: true }));
      setFormErrors((p) => ({ ...p, [round]: null, highBid: null }));
    } catch (e) {
      alert(e.message || "Failed to cancel high bid");
    } finally {
      setSaving(false);
    }
  };

  // ---- Apply settlement / Start new game ----
  const onResolveGame = async () => {
    if (!isAdmin) return;
    if (!allRoundsResolved) {
      alert("Finish all 5 rounds first.");
      return;
    }
    try {
      setSaving(true);
      await resolveGame(gameId, { adminKey });
      await refresh();
      alert("Game resolved. Payouts applied to ledger.");
    } catch (e) {
      alert(e.message || "Failed to resolve game");
    } finally {
      setSaving(false);
    }
  };

  const onNextGame = async () => {
    if (!isAdmin) return;
    if (!summary?.settlementApplied) {
      alert("Resolve game first.");
      return;
    }
    try {
      setSaving(true);
      const next = await nextGame(gameId, { adminKey });
      localStorage.setItem(`adminKey:${next.gameId}`, next.adminKey);
      navigate(`/game/${next.gameId}`);
    } catch (e) {
      alert(e.message || "Failed to start next game");
    } finally {
      setSaving(false);
    }
  };

  if (err)
    return (
      <Wrap>
        <Header gameId={gameId} title={game?.name || "Game"} />
        <ErrorBox text={err} />
      </Wrap>
    );
  if (!game || !summary)
    return (
      <Wrap>
        <Header gameId={gameId} title="Loading…" />
        <div>Loading…</div>
      </Wrap>
    );

  return (
    <Wrap>
      <Header
        gameId={gameId}
        title={game.name}
        weights={game.settlementConfig?.weights}
        stake={game.settlementConfig?.stake}
      />

      <div style={layout}>
        {/* Left: rounds + high-bid */}
        <div>
          {game.highBid?.active && !cancelledHighBids[game.highBid.round] && (
            <Card accent="#f59e0b" bg="#fff7ed">
              <h3 style={{ marginTop: 0 }}>Side Game (High-Bid)</h3>
              <div>
                Triggered in Round <b>{game.highBid.round}</b>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <label>High-bidder</label>
                <select
                  value={selectedBidder}
                  onChange={(e) => setSelectedBidder(e.target.value)}
                  style={{ ...input, width: 200 }}
                  disabled={!isAdmin}
                >
                  <option value="">— Select —</option>
                  {(game.highBid.bidderIds || []).map((bidderId) => {
                    const pl = players.find((p) => p.id === bidderId);
                    return (
                      <option key={bidderId} value={bidderId}>
                        {pl ? pl.name : bidderId}
                      </option>
                    );
                  })}
                </select>

                <label style={{ marginLeft: 8 }}>Stake/loser</label>
                <input
                  inputMode="decimal"
                  value={highStakeText}
                  onChange={(e) => setHighStakeText(e.target.value)}
                  style={{ ...input, width: 120 }}
                  disabled={!isAdmin}
                  placeholder="3"
                />
                <button
                  style={{ ...btn }}
                  disabled={!isAdmin || saving}
                  onClick={onCancelHighBid}
                  title="Cancel side game and edit bids. Ledger unchanged until you resolve."
                >
                  Cancel & Edit Bids
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                <div>Did the high bidder win the side game?</div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 6,
                  }}
                >
                  <button
                    key="won"
                    style={btn}
                    disabled={!isAdmin || saving || !selectedBidder}
                    onClick={() => resolveHighBidWinner(selectedBidder)}
                  >
                    Yes (Bidder Won)
                  </button>
                  <button
                    key="lost"
                    style={btn}
                    disabled={!isAdmin || saving || !selectedBidder}
                    onClick={() => {
                      const otherId = players.find(
                        (p) => p.id !== selectedBidder
                      )?.id;
                      if (otherId) resolveHighBidWinner(otherId);
                    }}
                  >
                    No (Bidder Lost)
                  </button>
                </div>
                <div style={{ marginTop: 6, color: "#92400e", fontSize: 12 }}>
                  If the high-bidder wins: bidder +3×stake; others −stake each.
                  If the bidder loses: bidder −3×stake; others +stake each.
                </div>
                {formErrors.highBid && (
                  <div style={{ marginTop: 8, color: "crimson", fontSize: 13 }}>
                    {formErrors.highBid}
                  </div>
                )}
              </div>
            </Card>
          )}

          {rounds.map((rr) => (
            <RoundCard
              key={rr.round}
              round={rr.round}
              info={rr.info}
              players={players}
              rd={rr}
              isAdmin={isAdmin}
              saving={saving}
              error={formErrors[rr.round]}
              bidInputs={bidInputs}
              setBidInputs={setBidInputs}
              actualInputs={actualInputs}
              setActualInputs={setActualInputs}
              editBids={editBids}
              setEditBids={setEditBids}
              editActuals={editActuals}
              setEditActuals={setEditActuals}
              onSetBids={setRoundBids}
              onSetActuals={setRoundActuals}
            />
          ))}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn} onClick={() => refresh()}>
              Refresh
            </button>
            {isAdmin && !summary.settlementApplied && (
              <button
                style={{
                  ...btn,
                  background: allRoundsResolved ? "#0a7" : "#777",
                }}
                disabled={!allRoundsResolved || saving}
                onClick={onResolveGame}
              >
                Resolve Game (apply payouts)
              </button>
            )}
            {isAdmin && summary.settlementApplied && (
              <button
                style={{ ...btn, background: "#0a7" }}
                disabled={saving}
                onClick={onNextGame}
              >
                Start Next Game (carry payouts)
              </button>
            )}
          </div>
        </div>

        {/* Right: sticky column so points always visible */}
        <div style={{ position: "sticky", top: 12, alignSelf: "start" }}>
          <PayoutLeaderboard summary={summary} />
          <TotalPointsCard
            players={summary.players}
            totalsPoints={summary.totalsPoints}
          />
          {summary.settlementApplied && (
            <ThisGameSettlementCard summary={summary} />
          )}
        </div>
      </div>
    </Wrap>
  );
}

function RoundCard({
  round,
  info,
  players,
  rd,
  isAdmin,
  saving,
  error,
  bidInputs,
  setBidInputs,
  actualInputs,
  setActualInputs,
  editBids,
  setEditBids,
  editActuals,
  setEditActuals,
  onSetBids,
  onSetActuals,
}) {
  const status =
    rd.status === "AUTO_AWARDED"
      ? "AUTO-AWARDED"
      : rd.status === "PLAYED"
      ? "PLAYED"
      : rd.status === "BIDS_SET"
      ? "BIDS SET"
      : "IN PROGRESS";
  const statusColor =
    rd.status === "AUTO_AWARDED"
      ? "#0a7"
      : rd.status === "PLAYED"
      ? "#2563eb"
      : rd.status === "BIDS_SET"
      ? "#111"
      : "#999";

  // — Show bidder order & dealer —
  const order = info?.bidderOrder || players.map((p) => p.id); // fallback to player list if backend doesn't provide
  const dealerId = info?.dealerId || order[order.length - 1];
  const firstBidderId = order[0];

  // Editing flags (allow re-edit after PLAYED; actuals locked only if AUTO_AWARDED)
  const isEditingBids = editBids?.[round] ?? rd.status == null;
  const isEditingActuals =
    editActuals?.[round] ??
    (rd.status !== "AUTO_AWARDED" &&
      Object.keys(rd.bids || {}).length === players.length &&
      rd.status !== undefined);

  const setBidVal = (pid, val) =>
    setBidInputs((prev) => ({
      ...prev,
      [round]: { ...(prev[round] || {}), [pid]: val },
    }));

  // SMART actuals (front-end only, while typing)
  const smartSetActual = (pid, raw) => {
    setActualInputs((prev) => {
      // Create a mutable copy for this round's inputs
      const roundInputs = { ...(prev[round] || {}), [pid]: raw };

      // Get current values and sum, treating blanks as null
      const playerIds = players.map((p) => p.id);
      const values = playerIds.map((id) => {
        const v = Number(roundInputs[id]);
        return Number.isFinite(v) ? v : null;
      });

      const filledCount = values.filter((v) => v !== null).length;
      const currentSum = values.reduce((acc, v) => acc + (v || 0), 0);

      // --- Smart Fill Logic ---
      // Only run autofill if there's at least one blank field.
      // This lets the user freely edit all 4 fields once they are filled.
      if (filledCount < playerIds.length) {
        // Case 1: Three fields are filled. Autofill the last one.
        if (filledCount === playerIds.length - 1) {
          const missingPlayerId = playerIds.find(
            (id) => roundInputs[id] == null || roundInputs[id] === ""
          );
          if (missingPlayerId) {
            const fillValue = Math.max(0, 13 - currentSum);
            roundInputs[missingPlayerId] = String(fillValue);
          }
        }
        // Case 2: The sum of entered values is 13. Fill remaining with 0.
        else if (currentSum === 13) {
          playerIds.forEach((id) => {
            if (roundInputs[id] == null || roundInputs[id] === "") {
              roundInputs[id] = "0";
            }
          });
        }
      }

      // Return the final state
      return { ...prev, [round]: roundInputs };
    });
  };

  const setActualVal = (pid, raw) => smartSetActual(pid, raw);

  // live bid total
  const bidTotalLive = (() => {
    let s = 0;
    const loc = bidInputs?.[round] || {};
    for (const p of players) {
      const v = Number(loc[p.id]);
      if (Number.isFinite(v)) s += v;
    }
    return s;
  })();

  // committed bid total (from rd.bids)
  const bidTotalCommitted = (() => {
    let s = 0;
    for (const p of players) {
      const v = Number(rd.bids?.[p.id] ?? 0);
      if (Number.isFinite(v)) s += v;
    }
    return s || null;
  })();

  const allBidsFilled = players.every((p) =>
    Number.isFinite(Number(bidInputs?.[round]?.[p.id] ?? ""))
  );
  const allActualsFilled = players.every((p) =>
    Number.isFinite(Number(actualInputs?.[round]?.[p.id] ?? ""))
  );
  const actualsSum = (() => {
    let s = 0;
    for (const p of players) s += Number(actualInputs?.[round]?.[p.id] ?? 0);
    return s;
  })();

  const remaining = Math.max(0, 13 - actualsSum);

  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>Round {round}</h3>
        <span style={{ color: statusColor }}>{status}</span>
      </div>

      <table style={table}>
        <thead>
          <tr>
            <Th>Player</Th>
            <Th>Bid (1–13; ≥8 high-bid)</Th>
            <Th>Actual (0–13)</Th>
            <Th>Round Pts</Th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <Td style={{ textAlign: "left" }}>
                {p.name}
                {p.id === firstBidderId && (
                  <small style={{ color: "#555" }}> (1st)</small>
                )}
                {p.id === dealerId && <b style={{ color: "#c2410c" }}> (D)</b>}
              </Td>
              <Td>
                {isAdmin && isEditingBids ? (
                  <input
                    type="number"
                    min={1}
                    max={13}
                    step={1}
                    value={bidInputs?.[round]?.[p.id] ?? ""}
                    onChange={(e) => setBidVal(p.id, e.target.value)}
                    style={{ ...input, width: 80 }}
                    disabled={saving}
                  />
                ) : rd.bids?.[p.id] != null ? (
                  rd.bids[p.id]
                ) : (
                  "-"
                )}
              </Td>
              <Td>
                {isAdmin &&
                rd.status !== "AUTO_AWARDED" &&
                (isEditingActuals ||
                  rd.status === "BIDS_SET" ||
                  rd.status === "PLAYED") ? (
                  <input
                    type="number"
                    min={0}
                    max={13}
                    step={1}
                    value={actualInputs?.[round]?.[p.id] ?? ""}
                    onChange={(e) => setActualVal(p.id, e.target.value)}
                    style={{ ...input, width: 80 }}
                    disabled={saving}
                  />
                ) : rd.status === "AUTO_AWARDED" ? (
                  "—"
                ) : rd.actuals?.[p.id] != null ? (
                  rd.actuals[p.id]
                ) : (
                  "-"
                )}
              </Td>
              <Td>
                {rd.points?.[p.id] != null
                  ? Number(rd.points[p.id]).toFixed(1)
                  : "-"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 8,
        }}
      >
        {/* Live bid total + auto-award hint */}
        <div
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            marginRight: 8,
          }}
        >
          Live Total: <b>{bidTotalLive}</b>{" "}
          {bidTotalLive < 10 ? "• Auto-award if set" : ""}
        </div>

        {/* Committed total (after Set Bids) */}
        {bidTotalCommitted !== null && (
          <div
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              background: "#eef2ff",
              border: "1px solid #dbeafe",
            }}
          >
            Committed Total: <b>{bidTotalCommitted}</b>
          </div>
        )}

        {/* Remaining actuals helper */}
        {rd.status !== "AUTO_AWARDED" && (
          <div
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              background: "#ecfeff",
              border: "1px solid #bae6fd",
            }}
            title="13 − sum(typed actuals)"
          >
            Remaining: <b>{remaining}</b>
          </div>
        )}

        {/* Bids buttons */}
        {isAdmin &&
          (isEditingBids ? (
            <button
              style={{ ...btn, background: allBidsFilled ? "#0a7" : "#777" }}
              disabled={!allBidsFilled || saving}
              onClick={() => onSetBids(round)}
            >
              {rd.status ? "Update Bids" : "Set Bids"}
            </button>
          ) : (
            <button
              style={{ ...btn, background: "#555" }}
              disabled={saving}
              onClick={() =>
                setEditBids((prev) => ({ ...prev, [round]: true }))
              }
            >
              Edit Bids
            </button>
          ))}

        {/* Actuals buttons */}
        {isAdmin && rd.status !== "AUTO_AWARDED" && (
          <>
            {isEditingActuals ||
            rd.status === "BIDS_SET" ||
            rd.status === "PLAYED" ? (
              <button
                style={{
                  ...btn,
                  background:
                    allActualsFilled && actualsSum === 13 ? "#0a7" : "#777",
                }}
                disabled={!allActualsFilled || actualsSum !== 13 || saving}
                onClick={() => onSetActuals(round)}
              >
                {rd.status === "PLAYED"
                  ? "Update Actuals (sum 13)"
                  : "Set Actuals (sum 13)"}
              </button>
            ) : (
              <button
                style={{ ...btn, background: "#555" }}
                disabled={saving}
                onClick={() =>
                  setEditActuals((prev) => ({ ...prev, [round]: true }))
                }
              >
                Edit Actuals
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            color: "crimson",
            marginTop: 8,
            fontSize: 13,
            background: "#fff1f2",
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      {rd.status === "AUTO_AWARDED" && (
        <div style={{ color: "#0a7", marginTop: 6 }}>
          Auto-awarded (bid + 0.1)
        </div>
      )}
    </Card>
  );
}

function TotalPointsCard({ players = [], totalsPoints = {} }) {
  const rows = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      pts: Number(totalsPoints[p.id] || 0),
    }))
    .sort((a, b) => b.pts - a.pts);

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Total Points (This Game)</h3>
      <table style={table}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Player</Th>
            <Th>Points</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <Td>{i + 1}</Td>
              <Td style={{ textAlign: "left" }}>{r.name}</Td>
              <Td>
                <b>{r.pts.toFixed(1)}</b>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PayoutLeaderboard({ summary }) {
  const players = summary.players || [];
  const ledger = summary.payouts || {};
  const rows = players
    .map((p) => ({ id: p.id, name: p.name, amount: Number(ledger[p.id] || 0) }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Total Payout (Ledger)</h3>
      <table style={table}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Player</Th>
            <Th>Payout</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <Td>{i + 1}</Td>
              <Td style={{ textAlign: "left" }}>{r.name}</Td>
              <Td>
                <b>{r.amount.toFixed(1)}</b>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
        Ledger updates after side games and final settlement.
      </div>
    </Card>
  );
}

function ThisGameSettlementCard({ summary }) {
  const settlement = summary.settlement;
  if (!settlement || !summary.settlementApplied) return null;

  const { totalsPoints = {}, perPlayerDelta = {}, ranking = [] } = settlement;
  const byId = Object.fromEntries(
    (summary.players || []).map((p) => [p.id, p])
  );
  const rows = (
    ranking.length
      ? ranking
      : (summary.players || []).map((p) => ({
          id: p.id,
          total: totalsPoints[p.id] || 0,
        }))
  ).map((r) => ({
    id: r.id,
    name: byId[r.id]?.name || r.id,
    points: Number(totalsPoints[r.id] || 0),
    delta: Number(perPlayerDelta[r.id] || 0),
  }));

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>This Game Settlement (Applied)</h3>
      <table style={table}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Player</Th>
            <Th>Points</Th>
            <Th>Δ Payout (this game)</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <Td>{i + 1}</Td>
              <Td style={{ textAlign: "left" }}>{r.name}</Td>
              <Td>{r.points.toFixed(1)}</Td>
              <Td>
                <b>
                  {r.delta >= 0 ? `+${r.delta.toFixed(1)}` : r.delta.toFixed(1)}
                </b>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// UI atoms
function Header({ gameId, title, weights, stake }) {
  return (
    <Card
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <div>
        <h1 style={{ margin: 0 }}>{title || "Game"}</h1>
        <div style={{ color: "#666" }}>
          Game: <code>{gameId}</code>
        </div>
      </div>
      <div style={{ textAlign: "right", color: "#555" }}>
        Weights: <b>{(weights || []).join(", ")}</b> • Stake: <b>{stake}</b>
      </div>
    </Card>
  );
}
function Wrap({ children }) {
  return (
    <div style={{ maxWidth: 1200, margin: "24px auto", padding: "0 12px" }}>
      {children}
    </div>
  );
}
function Card({ children, accent = "#e5e5e5", bg = "#fff", style }) {
  return (
    <div
      style={{
        border: `1px solid ${accent}`,
        background: bg,
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
function ErrorBox({ text }) {
  return (
    <div
      style={{
        color: "crimson",
        background: "#fff1f2",
        border: "1px solid #fecdd3",
        padding: 10,
        borderRadius: 8,
      }}
    >
      {text}
    </div>
  );
}

const layout = {
  display: "grid",
  gridTemplateColumns: "1.25fr 0.75fr",
  gap: 16,
  alignItems: "start",
};
const table = { width: "100%", borderCollapse: "collapse" };
const Th = (props) => (
  <th
    style={{
      border: "1px solid #eee",
      padding: 8,
      background: "#fafafa",
      textAlign: "center",
    }}
    {...props}
  />
);
const Td = (props) => (
  <td
    style={{ border: "1px solid #eee", padding: 8, textAlign: "center" }}
    {...props}
  />
);
const input = { padding: 8, border: "1px solid #ccc", borderRadius: 8 };
const btn = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #222",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};
