import { Routes, Route, useLocation } from "react-router-dom";
import Header from "./components/Header.jsx";
import Home from "./pages/Home.jsx";
import Search from "./pages/Search.jsx";
import Details from "./pages/Details.jsx";
import Player from "./pages/Player.jsx";
import NotFound from "./pages/NotFound.jsx";

// TheOGPirateBot: browse (Home/Search) -> Details -> Player, all in one app.
// Live TV and Login live elsewhere already and are intentionally absent
// here. The Player route renders true fullscreen with zero chrome, so the
// Header is suppressed on /watch/*.
export default function App() {
  const location = useLocation();
  const isPlayerRoute = location.pathname.startsWith("/watch/");

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {!isPlayerRoute && <Header />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/details/:type/:id" element={<Details />} />
        <Route path="/watch/:type/:id" element={<Player />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}
