import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header.jsx";
import Details from "./pages/Details.jsx";
import Player from "./pages/Player.jsx";
import NotFound from "./pages/NotFound.jsx";

// Fumio skeleton = Details page + Player only. Home, Search, Live TV and
// Login live elsewhere already — this app is just the "open a title, pick
// quality/audio, watch it" piece, meant to be deep-linked into
// (/details/:type/:id) from wherever the rest of the site lists titles.
export default function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Header />
      <Routes>
        <Route path="/" element={<Navigate to="/details/movie/550" replace />} />
        <Route path="/details/:type/:id" element={<Details />} />
        <Route path="/watch/:type/:id" element={<Player />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}
