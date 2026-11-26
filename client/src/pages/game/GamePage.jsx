import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { editorStorageKey, ledgerPath, request } from "../../api.js";
import useGameSubscription from "./hooks/useGameSubscription.js";
import PageWrap from "./components/PageWrap.jsx";
import GameHeader from "./components/GameHeader.jsx";
import ErrorBanner from "./components/ErrorBanner.jsx";
import RoundEditor from "./components/RoundEditor.jsx";
import PayoutLeaderboard from "./components/PayoutLeaderboard.jsx";
import TotalPointsCard from "./components/TotalPointsCard.jsx";
import SettlementCard from "./components/SettlementCard.jsx";
import GameHistory from "./components/GameHistory.jsx";
import SeatingControls from "./components/SeatingControls.jsx";
import AdminActions from "./components/AdminActions.jsx";
import GameSettingsPanel from "./components/GameSettingsPanel.jsx";
import LedgerAccess from "./components/LedgerAccess.jsx";
import TieSettlement from "./components/TieSettlement.jsx";
import { OnlineLedger } from "../online/OnlineLedger.jsx";
import { btnStyle } from "./components/ui.js";

const emptyRound = { bids: {}, actuals: {}, points: {} };

export default function GamePage({ seriesId }) {
  const path = ledgerPath(seriesId);
  const { snapshot, error, connected, acceptSnapshot } = useGameSubscription(seriesId);
  const { game, summary, revision, expiresAt } = snapshot || {};
  const [editorKey, setEditorKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [series, setSeries] = useState(null);
  const [historyResult, setHistoryResult] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [selectedHistoryGameId, setSelectedHistoryGameId] = useState("");
  const currentHistory = historyResult?.gameId === selectedHistoryGameId ? historyResult : null;
  const pending = useRef(null);

  useEffect(() => {
    const key = editorStorageKey(seriesId);
    const token = localStorage.getItem(key);
    if (!token) return;
    let active = true;
    request(`${path}/editor`, { token }).then(() => {
      if (active && localStorage.getItem(key) === token) setEditorKey(token);
    }).catch((err) => {
      if (active && err.status === 403 && localStorage.getItem(key) === token) {
        localStorage.removeItem(key);
        setEditorKey("");
      }
    });
    return () => { active = false; };
  }, [seriesId, path, connected]);

  function storeEditor(token) {
    setEditorKey(token);
    if (token) localStorage.setItem(editorStorageKey(seriesId), token);
    else localStorage.removeItem(editorStorageKey(seriesId));
    setActionError("");
  }

  const gameId = game?.gameId;
  const settled = game?.settlementApplied;
  useEffect(() => {
    if (!showHistory || !gameId) return;
    let active = true;
    request(`${path}/history`).then((data) => {
      if (!active) return;
      setSeries(data);
      const latest = data.games.filter((entry) => entry.settlementApplied).at(-1);
      setSelectedHistoryGameId(latest?.gameId || "");
      setHistoryError(latest ? "" : "History is available after a game is settled.");
    }).catch((err) => {
      if (active) setHistoryError(err.message);
    });
    return () => { active = false; };
  }, [showHistory, gameId, settled, path]);

  useEffect(() => {
    if (!showHistory || !selectedHistoryGameId) return;
    let active = true;
    request(`${path}/history/${selectedHistoryGameId}`).then((data) => {
      if (active) setHistoryResult({ gameId: selectedHistoryGameId, data });
    }).catch((err) => {
      if (active) setHistoryResult({ gameId: selectedHistoryGameId, error: err.message });
    });
    return () => { active = false; };
  }, [showHistory, selectedHistoryGameId, path]);

  async function command(action, payload = {}, expectedRevision = revision) {
    setSaving(true);
    setActionError("");
    const body = { expectedRevision, action, payload };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) {
      pending.current = { signature, key: crypto.randomUUID() };
    }
    try {
      const result = await request(`${path}/command`, { body, token: editorKey, key: pending.current.key });
      acceptSnapshot(result.view);
      pending.current = null;
    } catch (err) {
      if (err.status && err.status < 500) pending.current = null;
      if (err.status === 403) storeEditor("");
      if (err.code === "STALE_REVISION") {
        try {
          acceptSnapshot(await request(`${path}/snapshot`));
        } catch {
          // The subscription also refreshes the snapshot on reconnect.
        }
      }
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function save(action, payload) {
    return command(action, payload).catch((err) => setActionError(err.message));
  }

  if (!game) {
    return (
      <PageWrap>
        <h1>Callbreak Ledger</h1>
        {error ? (
          <>
            <ErrorBanner message={error} />
            <p><Link to="/ledger">Open or restore a ledger</Link></p>
          </>
        ) : <p>Loading ledger…</p>}
      </PageWrap>
    );
  }

  const editable = Boolean(editorKey) && !settled;
  const rounds = Array.from({ length: game.rounds }, (_, index) => index + 1);
  const allResolved = !game.highBid && rounds.every((round) =>
    ["AUTO_AWARDED", "PLAYED"].includes(game.roundData[round]?.status));
  const latestRecorded = Math.max(0, ...game.recordedRounds);
  const nextDealer = game.roundInfo[latestRecorded + 1]?.dealerId;
  const canSubstitute = editable && game.canSubstitute;

  if (game.mode === "online") {
    return <OnlineLedger game={game} summary={summary} connected={connected} onlineTable={snapshot.onlineTable}>
      {editorKey && <LedgerAccess seriesId={seriesId} revision={revision} editorKey={editorKey} expiresAt={expiresAt}
        onEditor={storeEditor} onSnapshot={acceptSnapshot} />}
      {actionError && <ErrorBanner message={actionError} />}
      {editorKey && summary.pendingTie?.length > 0 && <TieSettlement players={summary.pendingTie} ready={!saving}
        onSettle={(choice) => save("settle-game", choice)} />}
    </OnlineLedger>;
  }

  return (
    <PageWrap>
      <GameHeader
        gameId={game.gameIndex}
        title={game.name}
        weights={game.settlementConfig.weights}
        stake={game.settlementConfig.stake}
        connected={connected}
      />
      <ErrorBanner message={error || actionError} />
      <LedgerAccess seriesId={seriesId} revision={revision} editorKey={editorKey} expiresAt={expiresAt}
        onEditor={storeEditor} onSnapshot={acceptSnapshot} />

      <button style={{ ...btnStyle, marginTop: 16 }} onClick={() => setShowHistory(!showHistory)}>
        {showHistory ? "Hide Game History" : "View Game History"}
      </button>
      {showHistory && (
        <GameHistory series={series} history={currentHistory?.data} error={historyError || currentHistory?.error}
          loading={Boolean(selectedHistoryGameId && !currentHistory)} selectedGameId={selectedHistoryGameId}
          onSelectGame={setSelectedHistoryGameId} />
      )}

      <div className="ledger-layout">
        <main>
          {rounds.map((round) => {
            const sideGameAttempt = game.highBid?.round === round ? game.highBid.attempt : 0;
            return (
              <RoundEditor key={`${gameId}:${round}:${sideGameAttempt}`} round={round} info={game.roundInfo[round]}
                players={game.players} data={game.roundData[round] || emptyRound} game={game}
                revision={revision} editing={editable} saving={saving} command={command} />
            );
          })}
          <AdminActions isAdmin={Boolean(editorKey)} saving={saving}
            canResolve={allResolved} settlementApplied={settled} pendingTie={summary.pendingTie ?? []}
            onResolveGame={(choice) => save("settle-game", choice)} onNextGame={() => save("next-game")} />
        </main>

        <aside className="ledger-sidebar">
          <TotalPointsCard players={summary.players} totalsPoints={summary.totalsPoints}
            projectedPoints={summary.projectedPoints} />
          <PayoutLeaderboard summary={summary} />
          <SettlementCard summary={summary} />
          <GameSettingsPanel autoAwardEnabled={game.settings.autoAwardEnabled}
            isAdmin={editable} saving={saving}
            onToggleAutoAward={() => save("settings", { autoAwardEnabled: !game.settings.autoAwardEnabled })} />
          {(nextDealer || canSubstitute) && (
            <SeatingControls players={game.players} isAdmin={editable} saving={saving}
              currentDealerId={nextDealer || game.roundInfo[1].dealerId}
              onSubmit={({ orderIds, dealerId }) => save("reorder-players", { newOrder: orderIds, startDealerId: dealerId })}
              inactivePlayers={game.inactivePlayers} canSubstitute={canSubstitute}
              onSubstitute={(payload) => save("substitute", payload)} />
          )}
        </aside>
      </div>
    </PageWrap>
  );
}
