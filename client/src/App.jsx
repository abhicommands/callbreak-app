import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Landing from "./pages/Landing.jsx";
import GamePage from "./pages/game/GamePage.jsx";
import { OnlineHome, OnlineTablePage } from "./pages/online/OnlineTablePage.jsx";

function LedgerRoute() {
  const { seriesId } = useParams();
  return <GamePage key={seriesId} seriesId={seriesId} />;
}

function TableRoute() {
  const { tableId } = useParams();
  return <OnlineTablePage key={tableId} tableId={tableId} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/group/:id" element={<LegacyGroupLink />} />
      <Route path="/ledger" element={<Home />} />
      <Route path="/play" element={<OnlineHome />} />
      <Route path="/play/:tableId" element={<TableRoute />} />
      <Route path="/ledger/:seriesId" element={<LedgerRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LegacyGroupLink() {
  const { id } = useParams();
  return <Navigate replace to={`/ledger/${id}`} />;
}
