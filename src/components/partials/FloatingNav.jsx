import React from "react";
import { Link, useLocation } from "react-router-dom";

// ─── Compact floating bottom navigation ───────────────────────────────────
// Ported from Iris's FloatingNav.jsx: a center-bottom dock for the browse
// hubs. Trimmed to the four this build actually has — Anime and Live TV
// aren't ported (see README) so their dock slots are dropped rather than
// linking somewhere empty.
const FloatingNav = () => {
  const { pathname } = useLocation();

  // The player is a true fullscreen surface with no chrome at all — it
  // never mounts this component (see App.jsx) — but keep the guard too in
  // case a future route reuses this component directly.
  if (pathname.startsWith("/watch/")) return null;

  const isHome = pathname === "/";
  const isSearch = pathname.startsWith("/search");
  const isMovie = pathname.startsWith("/explore") && pathname.includes("type=movie");
  const isTv = pathname.startsWith("/explore") && pathname.includes("type=tv");

  const itemClass = (active) =>
    `group flex min-h-11 flex-1 flex-col items-center justify-center transition-all duration-300 active:scale-90 ${
      active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
    }`;

  const dot = (active) =>
    active && <span className="absolute -bottom-1.5 w-1 h-1 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />;

  const label = (text, active) => (
    <span className={`text-[10px] font-bold mt-0.5 tracking-tight transition-all ${active ? "text-white font-extrabold" : "text-zinc-400 group-hover:text-zinc-200"}`}>
      {text}
    </span>
  );

  return (
    <div className="gtv-dock fixed bottom-3 sm:bottom-6 inset-x-0 z-[200] flex justify-center pointer-events-none select-none px-3">
      <nav
        aria-label="Bottom Floating Navigation"
        className="pointer-events-auto relative flex items-center justify-between w-full max-w-[300px] px-2 py-1 rounded-full bg-black/85 backdrop-blur-2xl border border-white/15 shadow-[0_12px_45px_rgba(0,0,0,0.85)] ring-1 ring-white/10"
      >
        <div className="absolute inset-x-8 -top-3 h-10 bg-white/5 blur-xl rounded-full pointer-events-none" />

        <Link to="/" className={itemClass(isHome)} aria-label="Home">
          <div className="relative flex items-center justify-center">
            <i className={`${isHome ? "ri-home-5-fill" : "ri-home-5-line"} text-xl transition-transform duration-300 group-hover:scale-110`} />
            {dot(isHome)}
          </div>
          {label("Home", isHome)}
        </Link>

        <Link to="/explore?type=movie" className={itemClass(isMovie)} aria-label="Movies">
          <div className="relative flex items-center justify-center">
            <i className={`${isMovie ? "ri-movie-2-fill" : "ri-movie-2-line"} text-xl transition-transform duration-300 group-hover:scale-110`} />
            {dot(isMovie)}
          </div>
          {label("Movies", isMovie)}
        </Link>

        <Link
          to="/search"
          aria-label="Search"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 ${
            isSearch ? "bg-white text-black ring-2 ring-white/25" : "bg-white text-black hover:bg-zinc-200 ring-2 ring-black/80"
          }`}
        >
          <i className="ri-search-2-line text-xl" aria-hidden="true" />
        </Link>

        <Link to="/explore?type=tv" className={itemClass(isTv)} aria-label="TV Shows">
          <div className="relative flex items-center justify-center">
            <i className={`${isTv ? "ri-tv-fill" : "ri-tv-line"} text-xl transition-transform duration-300 group-hover:scale-110`} />
            {dot(isTv)}
          </div>
          {label("Series", isTv)}
        </Link>
      </nav>
    </div>
  );
};

export default FloatingNav;
