import React from "react";
import { Link } from "react-router-dom";

// Ported from Iris's components/Footer.jsx, trimmed to routes this build
// actually has — no Anime/Live TV/My List hubs, no About/FAQ/Legal pages.
const browseLinks = [
  ["Explore all", "/explore"],
  ["Movies", "/explore?type=movie"],
  ["TV shows", "/explore?type=tv"],
];

const Footer = () => (
  <footer className="mt-12 border-t border-white/10 bg-[var(--gtv-surface)] px-4 pt-10 pb-28 text-zinc-400 sm:px-8 sm:pt-12 sm:pb-24 md:px-12 lg:px-16 xl:px-20">
    <div className="mx-auto grid max-w-7xl gap-10 border-b border-white/10 pb-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-12 lg:gap-20">
      <div className="max-w-sm">
        <Link to="/" className="inline-flex items-center gap-3 font-display text-lg font-extrabold tracking-tight text-white transition-opacity hover:opacity-75">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black" aria-hidden="true">
            <i className="ri-tv-fill text-xl" />
          </span>
          TheOGPirateBot
        </Link>
        <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-400">
          Less scrolling, more watching. Find movies and shows in one place.
        </p>
        <p className="mt-3 text-xs font-medium text-zinc-500">Free to browse · No account required</p>
      </div>

      <nav aria-label="Footer navigation" className="grid grid-cols-1 gap-x-8 gap-y-6">
        <div>
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-300">Browse</h2>
          <ul className="space-y-3">
            {browseLinks.map(([label, to]) => (
              <li key={to}><Link to={to} className="text-sm text-zinc-400 transition-colors hover:text-white">{label}</Link></li>
            ))}
          </ul>
        </div>
      </nav>
    </div>

    <div className="mx-auto flex max-w-7xl flex-col gap-4 pt-6 text-xs text-zinc-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p>© {new Date().getFullYear()} TheOGPirateBot. We don’t host the videos linked here.</p>
    </div>
  </footer>
);

export default Footer;
