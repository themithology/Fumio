import { Routes, Route, useLocation } from "react-router-dom";
import FloatingNav from "./components/partials/FloatingNav.jsx";
import Home from "./pages/Home.jsx";
import Search from "./pages/Search.jsx";
import Explore from "./pages/Explore.jsx";
import Player from "./pages/Player.jsx";
import NotFound from "./pages/NotFound.jsx";
import LiveTv from "./pages/LiveTv.jsx";
import LiveTvWatch from "./pages/LiveTvWatch.jsx";
import Anime from "./pages/Anime.jsx";
import MediaHub from "./pages/MediaHub.jsx";
import Schedule from "./pages/Schedule.jsx";
import Account from "./pages/Account.jsx";
import Profile from "./pages/Profile.jsx";
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
        <Route path="/movie" element={<MediaHub mediaType="movie" />} />
        <Route path="/movies" element={<MediaHub mediaType="movie" />} />
        <Route path="/tv" element={<MediaHub mediaType="tv" />} />
        <Route path="/series" element={<MediaHub mediaType="tv" />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/account" element={<Account />} />
        <Route path="/u/:handle" element={<Profile />} />
        <Route path="/my-list" element={<MyList />} />
        <Route path="/live-tv" element={<LiveTv />} />
        <Route path="/live-tv/watch/:id" element={<LiveTvWatch />} />
        <Route path="/explore" element={<Explore />} />
        {/* Details is the SITE's page now, and the app does not ship one.
            The bundled build used to keep its own copy of it — 647 lines that
            drifted from the website every time the website changed (the anime
            season map, the download panel, the server list). A detail page for
            a title is only ever rendered by the live site; offline, the player
            still opens because a movie id is all it needs. Anything that lands
            here without a site falls through to NotFound rather than showing a
            stale screen that looks live. */}
        <Route path="/details/:type/:id" element={<NotFound />} />
        <Route path="/:type/details/:id" element={<NotFound />} />
        <Route path="/watch/:type/:id" element={<Player />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {!isPlayerRoute && <FloatingNav />}
    </div>
  );
}
