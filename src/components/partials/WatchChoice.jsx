import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LiveDot } from "./LiveTvRail.jsx";

// Live TV opens a small Iris-style watch sheet before entering the theater.
// The party system is not part of this build, so this keeps the useful solo
// action and never links the user to a dead watch-party route.
const WatchChoice = ({ channel, onAlone, onClose }) => {
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => setLogoFailed(false), [channel]);

  useEffect(() => {
    if (!channel) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [channel, onClose]);

  if (!channel) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Watch ${channel.name}`}>
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-t-3xl border border-white/15 bg-[#0d0d0f] p-5 shadow-2xl sm:rounded-3xl" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/15 hover:text-white">
          <i className="ri-close-line" />
        </button>
        <div className="flex items-center gap-3.5 pr-14">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black p-2">
            {channel.logo && !logoFailed ? (
              <img src={channel.logo} alt="" onError={() => setLogoFailed(true)} className="h-full w-full object-contain" />
            ) : (
              <span className="font-display text-xl font-black text-white/70">{(channel.name || "?").charAt(0)}</span>
            )}
          </span>
          <span className="min-w-0">
            <LiveDot />
            <span className="mt-0.5 block truncate font-display text-lg font-black leading-tight text-white">{channel.name}</span>
          </span>
        </div>
        <button type="button" onClick={onAlone} className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left transition hover:bg-zinc-200 active:scale-[0.99]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black text-white"><i className="ri-play-fill text-xl" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-black text-black">Watch live</span><span className="block text-xs font-semibold text-zinc-600">Open the channel theater</span></span>
          <i className="ri-arrow-right-s-line shrink-0 text-lg text-zinc-500" />
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default WatchChoice;
