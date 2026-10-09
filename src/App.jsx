import { Routes, Route, useLocation } from "react-router-dom";
import FloatingNav from "./components/partials/FloatingNav.jsx";
import Home from "./pages/Home.jsx";
import Search from "./pages/Search.jsx";
import Explore from "./pages/Explore.jsx";
import Details from "./pages/Details.jsx";
import Player from "./pages/Player.jsx";
import NotFound from "./pages/NotFound.jsx";

// TheOGPirateBot: browse (Home/Search/Explore) -> Details -> Player.
// Each page renders its own Topnav (see components/partials/Topnav.jsx) —
// matching Iris's actual layout, where the top bar is per-page rather than
// a single global wrapper — while FloatingNav (the bottom dock) is global
// and hides itself on /watch/*, since the player is a true fullscreen
// surface with zero chrome.
export default function App() {
  const location = useLocation();
  const isPlayerRoute = location.pathname.startsWith("/watch/");

  return (
    <div className="min-h-screen bg-[var(--gtv-bg)] text-[var(--gtv-text)]">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/details/:type/:id" element={<Details />} />
        <Route path="/:type/details/:id" element={<Details />} />
        <Route path="/watch/:type/:id" element={<Player />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {!isPlayerRoute && <FloatingNav />}
    </div>
  );
}
