import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  setBids,
  setActuals,
  resolveHighBid,
  resolveGame,
  nextGame,
  reorderPlayers,
  cancelHighBid,
  updateGameSettings,
  substitutePlayer,
} from "../../api";
import useGameSubscription from "./hooks/useGameSubscription.js";
import PageWrap from "./components/PageWrap.jsx";
import GameHeader from "./components/GameHeader.jsx";
import ErrorBanner from "./components/ErrorBanner.jsx";
import RoundCard from "./components/RoundCard.jsx";
import PayoutLeaderboard from "./components/PayoutLeaderboard.jsx";
import TotalPointsCard from "./components/TotalPointsCard.jsx";
import SettlementCard from "./components/SettlementCard.jsx";
import GameHistory from "./components/GameHistory.jsx";
import SeatingControls from "./components/SeatingControls.jsx";
import AdminActions from "./components/AdminActions.jsx";
import GameSettingsPanel from "./components/GameSettingsPanel.jsx";
import { btnStyle } from "./components/ui.js";

export default function GamePage() {
  const params = useParams();
  const rawGameId = params.gameId || params.id || "";
  const [viewGameId, setViewGameId] = useState(rawGameId);
  const baseGameIdRef = useRef(rawGameId);
  const adminKey = viewGameId
    ? localStorage.getItem(`adminKey:${viewGameId}`) || null
    : null;

  const handleRedirect = useCallback((id) => {
    if (!id) return;
    setViewGameId((current) => (current === id ? current : id));
    baseGameIdRef.current = id;
  }, []);

  const { game, summary, loading, error: streamError, connected } =
    useGameSubscription(viewGameId, { onRedirect: handleRedirect });

  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [bidInputs, setBidInputs] = useState({});
  const [actualInputs, setActualInputs] = useState({});
  const [editBids, setEditBids] = useState({});
  const [editActuals, setEditActuals] = useState({});
  const [selectedBidder, setSelectedBidder] = useState("");
  const [highStakeText, setHighStakeText] = useState("3");
  const [cancelledHighBids, setCancelledHighBids] = useState({});
  const [highBidError, setHighBidError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [series, setSeries] = useState(null);
  const [historyErr, setHistoryErr] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryGameId, setSelectedHistoryGameId] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [seatingError, setSeatingError] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    setSeries(null);
    setHistoryData(null);
    setSelectedHistoryGameId(null);
    setHistoryErr("");
  }, [viewGameId]);

  useEffect(() => {
    if (rawGameId && rawGameId !== baseGameIdRef.current) {
      baseGameIdRef.current = rawGameId;
      setViewGameId(rawGameId);
    }
  }, [rawGameId]);

  const isAdmin = Boolean(adminKey);
  const players = summary?.players || game?.players || [];
  const autoAwardEnabled =
    summary?.settings?.autoAwardEnabled ??
    game?.settings?.autoAwardEnabled ??
    true;
  const inactivePlayers = summary?.inactivePlayers || game?.inactivePlayers || [];

  useEffect(() => {
    if (!game) return;

    const seedBids = {};
    const seedActuals = {};
    for (let round = 1; round <= 5; round++) {
      const roundState = game.roundData?.[round] || {};
      seedBids[round] = {};
      seedActuals[round] = {};
      (game.players || []).forEach((player) => {
        const bid = roundState.bids?.[player.id];
        const actual = roundState.actuals?.[player.id];
        seedBids[round][player.id] = bid == null ? "" : String(bid);
        seedActuals[round][player.id] = actual == null ? "" : String(actual);
      });
    }
    setBidInputs(seedBids);
    setActualInputs(seedActuals);

    const nextEditBids = {};
    const nextEditActuals = {};
    for (let round = 1; round <= 5; round++) {
      const roundState = game.roundData?.[round] || {};
      nextEditBids[round] = roundState.status == null;
      nextEditActuals[round] = roundState.status === "BIDS_SET";
    }
    setEditBids(nextEditBids);
    setEditActuals(nextEditActuals);

    if (game.highBid?.active && Array.isArray(game.highBid.bidderIds)) {
      setSelectedBidder(
        game.highBid.bidderIds.length === 1 ? game.highBid.bidderIds[0] : ""
      );
    } else {
      setSelectedBidder("");
    }
    setHighBidError("");
    setCancelledHighBids({});
  }, [game]);

  useEffect(() => {
    if (!showHistory) return;
    if (!viewGameId) return;
    let cancelled = false;

    const fetchSeries = async () => {
      try {
        setHistoryErr("");
        setHistoryLoading(true);
        const res = await fetch(`/api/series/by-game/${viewGameId}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (cancelled) return;
        setSeries(data);

        let pickId = null;
        const current = data.games.find((g) => g.gameId === data.currentGameId);
        if (current?.settlementApplied) pickId = current.gameId;
        else {
          const resolved = [...data.games].filter((g) => g.settlementApplied);
          if (resolved.length) pickId = resolved[resolved.length - 1].gameId;
        }
        setSelectedHistoryGameId(pickId);
        if (pickId) {
          await loadHistoryForGame(pickId, {
            withSpinner: false,
            isCancelled: () => cancelled,
          });
        } else {
          setHistoryData(null);
          setHistoryErr("No resolved games yet. Resolve a game to view history.");
        }
      } catch (err) {
        if (!cancelled)
          setHistoryErr(err.message || "Failed to load series history");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    fetchSeries();

    return () => {
      cancelled = true;
    };
  }, [showHistory, viewGameId, game?.settlementApplied]);

  const loadHistoryForGame = async (
    gameId,
    { withSpinner = true, isCancelled } = {}
  ) => {
    if (!gameId) return;
    const cancelled = () => (typeof isCancelled === "function" && isCancelled());
    if (!cancelled()) {
      setHistoryData(null);
      setHistoryErr("");
    }
    try {
      if (withSpinner) setHistoryLoading(true);
      const res = await fetch(`/api/game/${gameId}/history`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!cancelled()) setHistoryData(data);
    } catch (err) {
      if (!cancelled()) {
        setHistoryData(null);
        setHistoryErr(err.message || "Failed to load history for game");
      }
    } finally {
      if (withSpinner && !cancelled()) setHistoryLoading(false);
    }
  };

  const rounds = useMemo(() => {
    if (!game) return [];
    return Array.from({ length: 5 }).map((_, index) => {
      const roundNumber = index + 1;
      const roundState = game.roundData?.[roundNumber] || {
        bids: {},
        actuals: {},
        points: {},
        status: undefined,
      };
      const info = summary?.roundInfo?.[roundNumber] || game.roundInfo?.[roundNumber] || null;
      return { roundNumber, info, ...roundState };
    });
  }, [game, summary]);

  const allRoundsResolved = useMemo(
    () =>
      rounds.length === 5 &&
      rounds.every(
        (round) => round.status === "AUTO_AWARDED" || round.status === "PLAYED"
      ),
    [rounds]
  );

  const handleBidInput = (round, playerId, value) => {
    setBidInputs((prev) => ({
      ...prev,
      [round]: { ...(prev[round] || {}), [playerId]: value },
    }));
  };

  const handleActualInput = (round, playerId, raw) => {
    setActualInputs((prev) => {
      const roundInputs = { ...(prev[round] || {}), [playerId]: raw };
      const playerIds = players.map((player) => player.id);
      const values = playerIds.map((id) => {
        const value = Number(roundInputs[id]);
        return Number.isFinite(value) ? value : null;
      });
      const filled = values.filter((value) => value !== null).length;
      const currentSum = values.reduce((sum, value) => sum + (value || 0), 0);

      if (filled < playerIds.length) {
        if (filled === playerIds.length - 1) {
          const missingId = playerIds.find(
            (id) => roundInputs[id] == null || roundInputs[id] === ""
          );
          if (missingId) {
            const fillValue = Math.max(0, 13 - currentSum);
            roundInputs[missingId] = String(fillValue);
          }
        } else if (currentSum === 13) {
          playerIds.forEach((id) => {
            if (roundInputs[id] == null || roundInputs[id] === "") {
              roundInputs[id] = "0";
            }
          });
        }
      }

      return { ...prev, [round]: roundInputs };
    });
  };

  const setRoundBids = async (round) => {
    if (!isAdmin) return;
    setFormErrors((prev) => ({ ...prev, [round]: null }));
    const bids = {};
    for (const player of players) {
      const raw = bidInputs?.[round]?.[player.id] ?? "";
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 1 || value > 13 || !Number.isInteger(value)) {
        setFormErrors((prev) => ({
          ...prev,
          [round]: "Enter valid integer bids (1–13) for all players.",
        }));
        return;
      }
      bids[player.id] = value;
    }

    try {
      setSaving(true);
      await setBids(viewGameId, { adminKey, round, bids });
      setEditBids((prev) => ({ ...prev, [round]: false }));
    } catch (err) {
      if (err.status === 409 && err?.data?.highBidTriggered) {
        const message =
          err?.data?.message ||
          err?.data?.error ||
          "High bid triggered! Resolve the side game below, or cancel to re-enter bids.";
        setFormErrors((prev) => ({ ...prev, [round]: message }));
        setCancelledHighBids((prev) => ({ ...prev, [round]: false }));
        setHighBidError(message);
      } else {
        setFormErrors((prev) => ({
          ...prev,
          [round]: err.message || "Failed to set bids",
        }));
      }
    } finally {
      setSaving(false);
    }
  };

  const setRoundActuals = async (round) => {
    if (!isAdmin) return;
    setFormErrors((prev) => ({ ...prev, [round]: null }));
    const actuals = {};
    let sum = 0;
    for (const player of players) {
      const raw = actualInputs?.[round]?.[player.id] ?? "";
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 13 || !Number.isInteger(value)) {
        setFormErrors((prev) => ({
          ...prev,
          [round]: "Enter valid integer actuals (0–13) for all players.",
        }));
        return;
      }
      sum += value;
      actuals[player.id] = value;
    }
    if (sum !== 13) {
      setFormErrors((prev) => ({ ...prev, [round]: "Actuals must sum to 13." }));
      return;
    }

    try {
      setSaving(true);
      await setActuals(viewGameId, { adminKey, round, actuals });
      setEditActuals((prev) => ({ ...prev, [round]: false }));
    } catch (err) {
      setFormErrors((prev) => ({
        ...prev,
        [round]: err.message || "Failed to set actuals",
      }));
    } finally {
      setSaving(false);
    }
  };

  const resolveHighBidOutcome = async (bidderWon) => {
    if (!isAdmin || !game?.highBid?.active) return;
    const round = game.highBid.round;
    setHighBidError("");

    if (!selectedBidder) {
      setHighBidError("Select the high-bidder first.");
      return;
    }
    if (!highStakeText) {
      setHighBidError("Enter stake per loser.");
      return;
    }
    const stake = Number(highStakeText);
    if (!Number.isFinite(stake) || stake <= 0) {
      setHighBidError("Stake must be a positive number.");
      return;
    }

    try {
      setSaving(true);
      await resolveHighBid(viewGameId, {
        adminKey,
        round,
        bidderId: selectedBidder,
        stake,
        bidderWon,
      });
      alert("Side game resolved. Re-enter bids and Set Bids to continue.");
    } catch (err) {
      setHighBidError(err.message || "Failed to resolve side game");
    } finally {
      setSaving(false);
    }
  };

  const onCancelHighBid = async () => {
    if (!game?.highBid?.round) return;
    const round = game.highBid.round;
    try {
      setSaving(true);
      await cancelHighBid(viewGameId, { adminKey, round });
      setEditBids((prev) => ({ ...prev, [round]: true }));
      setFormErrors((prev) => ({ ...prev, [round]: null }));
      setCancelledHighBids((prev) => ({ ...prev, [round]: true }));
      setHighBidError("");
    } catch (err) {
      setHighBidError(err.message || "Failed to cancel high bid");
    } finally {
      setSaving(false);
    }
  };

  const onResolveGame = async () => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      await resolveGame(viewGameId, { adminKey });
    } catch (err) {
      alert(err.message || "Failed to resolve game");
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
      const next = await nextGame(viewGameId, { adminKey });
      localStorage.setItem(`adminKey:${next.gameId}`, next.adminKey);
      setViewGameId(next.gameId);
    } catch (err) {
      alert(err.message || "Failed to start next game");
    } finally {
      setSaving(false);
    }
  };

  const onToggleAutoAward = async () => {
    if (!isAdmin) return;
    try {
      setSettingsSaving(true);
      await updateGameSettings(viewGameId, {
        adminKey,
        autoAwardEnabled: !autoAwardEnabled,
      });
    } catch (err) {
      alert(err.message || "Failed to update settings");
    } finally {
      setSettingsSaving(false);
    }
  };

  const canSubstitute =
    isAdmin &&
    !summary?.settlementApplied &&
    rounds.every((round) => round.status == null);

  const onSubstitutePlayer = async ({
    outgoingPlayerId,
    incomingPlayerId,
    incomingName,
  }) => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setSeatingError("");
      await substitutePlayer(viewGameId, {
        adminKey,
        outgoingPlayerId,
        incomingPlayerId,
        incomingName,
      });
    } catch (err) {
      setSeatingError(err.message || "Failed to substitute player");
    } finally {
      setSaving(false);
    }
  };

  const onSaveSeating = async ({ orderIds, dealerId }) => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setSeatingError("");
      await reorderPlayers(viewGameId, {
        adminKey,
        newOrder: orderIds,
        startDealerId: dealerId,
      });
    } catch (err) {
      setSeatingError(err.message || "Failed to update seating");
    } finally {
      setSaving(false);
    }
  };

  if (!viewGameId) {
    return (
      <PageWrap>
        <ErrorBanner message="Game not found." />
      </PageWrap>
    );
  }

  if (loading && !game) {
    return (
      <PageWrap>
        <GameHeader
          gameId={viewGameId}
          title="Loading…"
          weights={[]}
          stake={"—"}
          connected={connected}
          loading={loading}
        />
        <div style={{ marginTop: 12 }}>Loading…</div>
      </PageWrap>
    );
  }

  if (!game || !summary) {
    return (
      <PageWrap>
        <GameHeader
          gameId={viewGameId}
          title="Game"
          weights={[]}
          stake={"—"}
          connected={connected}
          loading={loading}
        />
        <ErrorBanner message={streamError || "Failed to load game."} />
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      <GameHeader
        gameId={viewGameId}
        title={game.name}
        weights={game.settlementConfig?.weights}
        stake={game.settlementConfig?.stake}
        connected={connected}
        loading={loading}
      />
      <ErrorBanner message={streamError} />

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          style={{ ...btnStyle, background: "#2563eb", border: "1px solid #1e40af" }}
          onClick={async () => {
            const next = !showHistory;
            setShowHistory(next);
            if (next && !series) {
              try {
                setHistoryErr("");
                setHistoryLoading(true);
        const res = await fetch(`/api/series/by-game/${viewGameId}`);
                if (!res.ok) throw new Error(await res.text());
                const data = await res.json();
                setSeries(data);

                let pickId = null;
                const current = data.games.find((g) => g.gameId === data.currentGameId);
                if (current?.settlementApplied) pickId = current.gameId;
                else {
                  const resolved = [...data.games].filter((g) => g.settlementApplied);
                  if (resolved.length) pickId = resolved[resolved.length - 1].gameId;
                }
                setSelectedHistoryGameId(pickId);
                if (pickId) await loadHistoryForGame(pickId);
                else setHistoryErr("No resolved games yet. Resolve a game to view history.");
              } catch (err) {
                setHistoryErr(err.message || "Failed to load series history");
              } finally {
                setHistoryLoading(false);
              }
            }
          }}
        >
          {showHistory ? "Hide Game History" : "View Game History"}
        </button>
      </div>

      {showHistory && (
        <GameHistory
          series={series}
          history={historyData}
          error={historyErr}
          loading={historyLoading}
          selectedGameId={selectedHistoryGameId}
          onSelectGame={async (gid) => {
            setSelectedHistoryGameId(gid);
            if (!gid) {
              setHistoryData(null);
              setHistoryErr("Select a resolved game to view history.");
              return;
            }
            await loadHistoryForGame(gid);
          }}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)",
          gap: 16,
        }}
      >
        <div>
          {rounds.map((round) => {
            const isHighBidRound =
              game.highBid?.active &&
              game.highBid.round === round.roundNumber &&
              !cancelledHighBids[round.roundNumber];
            return (
            <RoundCard
              key={round.roundNumber}
              roundNumber={round.roundNumber}
              info={round.info}
              players={players}
              roundData={round}
              isAdmin={isAdmin}
              saving={saving}
              error={formErrors[round.roundNumber]}
              bidInputs={bidInputs[round.roundNumber]}
              actualInputs={actualInputs[round.roundNumber]}
              isEditingBids={editBids[round.roundNumber]}
              isEditingActuals={editActuals[round.roundNumber]}
              autoAwardEnabled={autoAwardEnabled}
              highBid={isHighBidRound ? game.highBid : null}
              selectedBidder={selectedBidder}
              onSelectBidder={setSelectedBidder}
              stakeText={highStakeText}
              onStakeTextChange={setHighStakeText}
              highBidError={isHighBidRound ? highBidError : ""}
              onResolveHighBid={async (won) => {
                await resolveHighBidOutcome(won);
              }}
              onCancelHighBid={onCancelHighBid}
              onBidInput={handleBidInput}
              onActualInput={handleActualInput}
              onSubmitBids={setRoundBids}
              onSubmitActuals={setRoundActuals}
              onToggleBids={(roundNumber, value) =>
                setEditBids((prev) => ({ ...prev, [roundNumber]: value }))
              }
              onToggleActuals={(roundNumber, value) =>
                setEditActuals((prev) => ({ ...prev, [roundNumber]: value }))
              }
            />
            );
          })}

          <AdminActions
            isAdmin={isAdmin}
            saving={saving}
            canResolve={allRoundsResolved}
            settlementApplied={summary.settlementApplied}
            onResolveGame={onResolveGame}
            onNextGame={onNextGame}
          />
        </div>

        <div style={{ position: "sticky", top: 12, alignSelf: "start" }}>
          <PayoutLeaderboard summary={summary} />
          <TotalPointsCard
            players={summary.players}
            totalsPoints={summary.totalsPoints}
          />
          <SettlementCard summary={summary} />
          <GameSettingsPanel
            autoAwardEnabled={autoAwardEnabled}
            isAdmin={isAdmin}
            saving={settingsSaving}
            onToggleAutoAward={onToggleAutoAward}
          />
          <SeatingControls
            players={players}
            isAdmin={isAdmin}
            saving={saving}
            currentDealerId={summary?.roundInfo?.[1]?.dealerId || game.roundInfo?.[1]?.dealerId}
            onSubmit={onSaveSeating}
            error={seatingError}
            onClearError={() => setSeatingError("")}
            inactivePlayers={inactivePlayers}
            canSubstitute={canSubstitute}
            onSubstitute={onSubstitutePlayer}
          />
        </div>
      </div>
    </PageWrap>
  );
}
