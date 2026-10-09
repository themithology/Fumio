import React from "react";
import { Link, useLocation } from "react-router-dom";

// Iris's six-slot bottom dock: Home, Anime, Search, Movies, Series and Live TV.
// Immersive player/theater routes are hidden by App.jsx so controls never sit on
// top of video.
const FloatingNav = () => {
  const { pathname, search } = useLocation();
  if (pathname.startsWith("/watch/") || pathname.startsWith("/live-tv/watch/")) return null;

  const browseType = new URLSearchParams(search).get("type");
  const isHome = pathname === "/";
  const isAnime = pathname.startsWith("/anime");
  const isSearch = pathname.startsWith("/search");
  const isMovie = pathname === "/movie" || pathname === "/movies" || (pathname.startsWith("/explore") && browseType === "movie");
  const isTv = pathname === "/tv" || pathname === "/series" || (pathname.startsWith("/explore") && browseType === "tv");
  const isLiveTv = pathname.startsWith("/live-tv");

  const itemClass = (active) =>
    `group flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center transition-all duration-300 active:scale-90 ${
      active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
    }`;
  const dot = (active) =>
    active && <span className="absolute -bottom-1.5 h-1 w-1 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />;
  const label = (text, active) => (
    <span className={`mt-0.5 text-[9px] font-bold tracking-tight transition-all sm:text-[10px] ${active ? "font-extrabold text-white" : "text-zinc-400 group-hover:text-zinc-200"}`}>
      {text}
    </span>
  );

  return (
    <div className="gtv-dock fixed inset-x-0 bottom-3 z-[200] flex justify-center px-2 pointer-events-none select-none sm:bottom-6 sm:px-3">
      <nav aria-label="Bottom Floating Navigation" className="pointer-events-auto relative flex w-full max-w-[360px] items-center justify-between rounded-full border border-white/15 bg-black/85 px-1.5 py-1 backdrop-blur-2xl shadow-[0_12px_45px_rgba(0,0,0,0.85)] ring-1 ring-white/10 sm:max-w-[380px] sm:px-2">
        <div className="pointer-events-none absolute inset-x-10 -top-3 h-10 rounded-full bg-white/5 blur-xl" />

        <Link to="/" className={itemClass(isHome)} aria-label="Home">
          <span className="relative flex items-center justify-center"><i className={`${isHome ? "ri-home-5-fill" : "ri-home-5-line"} text-lg sm:text-xl`} />{dot(isHome)}</span>
          {label("Home", isHome)}
        </Link>

        <Link to="/anime" className={itemClass(isAnime)} aria-label="Anime">
          <span className="relative flex items-center justify-center"><i className={`${isAnime ? "ri-ghost-2-fill" : "ri-ghost-2-line"} text-lg sm:text-xl`} />{dot(isAnime)}</span>
          {label("Anime", isAnime)}
        </Link>

        <Link to="/search" aria-label="Search" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 sm:h-11 sm:w-11 ${isSearch ? "bg-white text-black ring-2 ring-white/25" : "bg-white text-black ring-2 ring-black/80 hover:bg-zinc-200"}`}>
          <i className="ri-search-2-line text-lg sm:text-xl" aria-hidden="true" />
        </Link>

        <Link to="/movie" className={itemClass(isMovie)} aria-label="Movies">
          <span className="relative flex items-center justify-center"><i className={`${isMovie ? "ri-movie-2-fill" : "ri-movie-2-line"} text-lg sm:text-xl`} />{dot(isMovie)}</span>
          {label("Movies", isMovie)}
        </Link>

        <Link to="/tv" className={itemClass(isTv)} aria-label="Series">
          <span className="relative flex items-center justify-center"><i className={`${isTv ? "ri-tv-fill" : "ri-tv-line"} text-lg sm:text-xl`} />{dot(isTv)}</span>
          {label("Series", isTv)}
        </Link>

        <Link to="/live-tv" className={itemClass(isLiveTv)} aria-label="Live TV">
          <span className="relative flex items-center justify-center"><i className={`${isLiveTv ? "ri-live-fill" : "ri-live-line"} text-lg sm:text-xl`} />{dot(isLiveTv)}</span>
          {label("Live TV", isLiveTv)}
        </Link>
      </nav>
    </div>
  );
};

export default FloatingNav;
