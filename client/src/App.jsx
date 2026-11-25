import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Home from "./pages/Home.jsx";
import GamePage from "./pages/game/GamePage.jsx";

function LedgerRoute() {
  const { seriesId } = useParams();
  return <GamePage key={seriesId} seriesId={seriesId} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/ledger/:seriesId" element={<LedgerRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
