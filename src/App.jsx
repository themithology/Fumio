import { Routes, Route, useLocation } from "react-router-dom";
import FloatingNav from "./components/partials/FloatingNav.jsx";
import Home from "./pages/Home.jsx";
import Search from "./pages/Search.jsx";
import Explore from "./pages/Explore.jsx";
import Details from "./pages/Details.jsx";
import Player from "./pages/Player.jsx";
import NotFound from "./pages/NotFound.jsx";
import LiveTv from "./pages/LiveTv.jsx";
import LiveTvWatch from "./pages/LiveTvWatch.jsx";
import Anime from "./pages/Anime.jsx";
import Account from "./pages/Account.jsx";
import MyList from "./pages/MyList.jsx";
import { useAccountSync } from "./components/auth/useAccount.js";

// TheOGPirateBot: browse (Home/Search/Explore) -> Details -> Player.
// Each page renders its own Topnav (see components/partials/Topnav.jsx) —
// matching Iris's actual layout, where the top bar is per-page rather than
// a single global wrapper — while FloatingNav (the bottom dock) is global
// and hides itself on /watch/*, since the player is a true fullscreen
// surface with zero chrome; the Live TV theater follows the same rule.
export default function App() {
  useAccountSync();
  const location = useLocation();
  const isPlayerRoute = location.pathname.startsWith("/watch/") || location.pathname.startsWith("/live-tv/watch/");

  return (
    <div className="min-h-screen bg-[var(--gtv-bg)] text-[var(--gtv-text)]">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/anime" element={<Anime />} />
        <Route path="/account" element={<Account />} />
        <Route path="/my-list" element={<MyList />} />
        <Route path="/live-tv" element={<LiveTv />} />
        <Route path="/live-tv/watch/:id" element={<LiveTvWatch />} />
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
