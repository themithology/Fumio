import React from "react";

// Branded loading state — ported from Iris's components/Loading.jsx.
const Loading = () => {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--gtv-bg)]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-white/10 border-t-[var(--gtv-accent)]" />
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black shadow-md">
            <i className="ri-tv-fill text-lg" />
          </span>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-600">
          TheOGPirateBot
        </p>
      </div>
    </div>
  );
};

export default Loading;
