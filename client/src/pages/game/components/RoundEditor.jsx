import React, { useState } from "react";
import { sideGamePayout } from "../../../../../server/src/services/gameService.js";
import RoundCard from "./RoundCard.jsx";

export default function RoundEditor({
  round, info, players, data, game, editing, saving, revision, command,
}) {
  const [bids, setBids] = useState(null);
  const [actuals, setActuals] = useState(null);
  const [stake, setStake] = useState("3");
  const [bidder, setBidder] = useState("");
  const [error, setError] = useState("");
  const highBid = game.highBid?.round === round ? game.highBid : null;
  const selectedBidder = highBid?.bidderIds.includes(bidder)
    ? bidder : highBid?.bidderIds.length === 1 ? highBid.bidderIds[0] : "";
  const defaultBids = !data.status;
  const defaultActuals = data.status === "BIDS_SET";

  function draft(values) {
    return { values: Object.fromEntries(Object.entries(values || {}).map(([id, value]) =>
      [id, String(value)])), revision };
  }

  async function save(action, payload, expectedRevision) {
    setError("");
    try {
      await command(action, { round, ...payload }, expectedRevision);
      setBids(null);
      setActuals(null);
    } catch (err) {
      if (err.code === "STALE_REVISION") {
        setBids(null);
        setActuals(null);
      }
      setError(err.message);
    }
  }

  function setBidInput(_, id, value) {
    setBids((current) => {
      const existing = current || draft(data.bids);
      return { ...existing, values: { ...existing.values, [id]: value } };
    });
  }

  function setActualInput(_, id, value) {
    setActuals((current) => {
      const existing = current || draft(data.actuals);
      const values = { ...existing.values, [id]: value };
      const missing = players.filter((player) => !values[player.id]?.trim());
      const total = players.reduce((sum, player) => sum + Number(values[player.id] || 0), 0);
      if (missing.length === 1 && missing[0].id !== id && total <= 13) {
        values[missing[0].id] = String(13 - total);
      }
      return { ...existing, values };
    });
  }

  function submit(action, field, entry) {
    const values = Object.fromEntries(players.map(({ id }) =>
      [id, Number(entry.values[id])]));
    return save(action, { [field]: values }, entry.revision);
  }

  return (
    <RoundCard
      roundNumber={round}
      info={info}
      players={players}
      roundData={data}
      isAdmin={editing}
      saving={saving}
      error={error}
      bidInputs={bids?.values || data.bids}
      actualInputs={actuals?.values || data.actuals}
      isEditingBids={!game.highBid && (defaultBids || Boolean(bids))}
      isEditingActuals={defaultActuals || Boolean(actuals)}
      autoAwardEnabled={game.settings.autoAwardEnabled}
      pool={highBid?.bid ? sideGamePayout(game.settlementConfig, highBid.bid).total : null}
      highBid={highBid}
      bidLocked={Boolean(game.highBid)}
      selectedBidder={selectedBidder}
      onSelectBidder={setBidder}
      stakeText={stake}
      onStakeTextChange={setStake}
      onResolveHighBid={(bidderWon) => save("resolve-highbid", {
        bidderId: selectedBidder, bidderWon, stake: Number(stake),
      })}
      onCancelHighBid={() => save("cancel-highbid", {})}
      onBidInput={setBidInput}
      onActualInput={setActualInput}
      onSubmitBids={() => submit("set-bids", "bids", bids || draft(data.bids))}
      onSubmitActuals={() => submit("set-actuals", "actuals", actuals || draft(data.actuals))}
      onToggleBids={() => setBids(draft(data.bids))}
      onToggleActuals={() => setActuals(draft(data.actuals))}
    />
  );
}
