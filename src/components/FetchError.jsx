import React from "react";
import { Link } from "react-router-dom";

// Friendly failure state for listing pages — ported from Iris's
// components/FetchError.jsx verbatim.
const FetchError = ({ onRetry, message }) => (
  <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 bg-[var(--gtv-bg)] px-6 text-center">
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
      <i className="ri-cloud-off-line text-3xl text-zinc-400" />
    </span>
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg sm:text-xl font-bold text-white">
        Couldn't load this page
      </h2>
      <p className="max-w-sm text-xs sm:text-sm leading-relaxed text-zinc-500">
        {message ||
          "The movie database is unreachable right now. This is usually temporary — please try again in a moment."}
      </p>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-3">
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-6 py-2.5 text-xs sm:text-sm font-bold text-black transition hover:bg-zinc-200 active:scale-95"
      >
        <i className="ri-refresh-line" /> Try Again
      </button>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white transition hover:bg-white/10 active:scale-95"
      >
        <i className="ri-home-4-line" /> Go Home
      </Link>
    </div>
  </div>
);

export default FetchError;
