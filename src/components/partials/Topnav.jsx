import React from "react";
import { Link } from "react-router-dom";

// A slim, shared top bar — ported from Iris's Topnav.jsx, trimmed down to
// just the brand mark: Search lives in the bottom dock (FloatingNav), and
// Schedule / Watch Party / Discord / Account all belong to features this
// build intentionally doesn't include (see README).
const Topnav = () => (
  <header className="sticky top-0 z-[100] w-full border-b border-white/[0.06] bg-black/85 backdrop-blur-md select-none">
    <div className="mx-auto flex h-[52px] w-full max-w-[1600px] items-center justify-between gap-2 px-3 sm:px-6 lg:px-10">
      <Link to="/" aria-label="TheOGPirateBot Home" className="group flex min-w-0 shrink-0 items-center gap-2.5 text-white">
        <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0" />
        <span className="hidden font-display text-[13px] font-bold tracking-tight group-hover:text-zinc-200 xs:inline sm:text-sm">TheOGPirateBot</span>
      </Link>
      <Link
        to="/explore"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
      >
        <i className="ri-equalizer-line text-sm" aria-hidden="true" />
        <span className="hidden sm:inline">Explore</span>
      </Link>
    </div>
  </header>
);

export default Topnav;
