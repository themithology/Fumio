import { useEffect, useMemo, useRef, useState } from "react";
import {
  FUMIO_SOURCES,
  TG_VID_SOURCE,
  buildStreamUrl,
  defaultAudio,
} from "../providers/sources.js";
import { checkStreamAlive } from "../lib/streamCheck.js";
import FumioPlayerStage from "./FumioPlayerStage.jsx";

// Two playback lanes stay separate:
//
// 1. TG Vid is attempted once as Fumio's preferred source.
// 2. The original Fumio lane owns all manually-selected fallbacks.
//
// The small selector below the TG Vid label is deliberately compact. Choosing
// a fallback mounts the same Fumio player used when TG Vid fails, so Anime
// Sub/Dub sources are real playable lanes rather than decorative buttons.
const TG_LOAD_TIMEOUT_MS = 12000;

const uniqueSources = (sources) => {
  const seen = new Set();
  return (sources || []).filter((source) => {
    if (!source?.id || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
};

const rememberServer = (serverKey, titleId) => {
  try {
    localStorage.setItem("preferredServerKey", serverKey);
    if (titleId) localStorage.setItem(`preferredServerKey:${titleId}`, serverKey);
  } catch {
    // Private browsing/storage-blocked mode must not stop playback.
  }
};

export default function PlayerStage({
  tmdbId,
  mediaType,
  season,
  episode,
  animeSources = [],
  preferredServerKey = null,
}) {
  const [useFumioPlayer, setUseFumioPlayer] = useState(false);
  const [phase, setPhase] = useState("checking"); // checking | playing
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fallbackSourceId, setFallbackSourceId] = useState(null);
  const timeoutRef = useRef(null);

  const fallbackSources = useMemo(
    () => uniqueSources([...FUMIO_SOURCES, ...(animeSources || [])]),
    [animeSources],
  );
  const serverOptions = useMemo(
    () => [TG_VID_SOURCE, ...fallbackSources],
    [fallbackSources],
  );

  useEffect(() => {
    setUseFumioPlayer(false);
    setPhase("checking");
    setPickerOpen(false);
    setFallbackSourceId(null);
  }, [tmdbId, mediaType, season, episode]);

  const preferredFallback = fallbackSources.find((source) => source.id === preferredServerKey);

  useEffect(() => {
    if (!preferredServerKey || preferredServerKey === TG_VID_SOURCE.id || !preferredFallback) return;
    setFallbackSourceId(preferredFallback.id);
    setUseFumioPlayer(true);
  }, [preferredFallback, preferredServerKey]);

  const src = buildStreamUrl(
    TG_VID_SOURCE,
    tmdbId,
    mediaType,
    season,
    episode,
    defaultAudio(TG_VID_SOURCE),
  );

  useEffect(() => {
    let cancelled = false;
    setPhase("checking");
    checkStreamAlive(src).then((alive) => {
      if (cancelled) return;
      if (alive) setPhase("playing");
      else setUseFumioPlayer(true);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (useFumioPlayer || phase !== "playing") return undefined;
    timeoutRef.current = setTimeout(() => setUseFumioPlayer(true), TG_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [phase, useFumioPlayer, src]);

  const chooseServer = (server) => {
    clearTimeout(timeoutRef.current);
    setPickerOpen(false);
    if (server.id === TG_VID_SOURCE.id) {
      rememberServer(server.id, tmdbId);
      setUseFumioPlayer(false);
      setPhase("checking");
      return;
    }
    rememberServer(server.id, tmdbId);
    setFallbackSourceId(server.id);
    setUseFumioPlayer(true);
  };

  const fallback = () => {
    clearTimeout(timeoutRef.current);
    setUseFumioPlayer(true);
  };

  if (useFumioPlayer) {
    return (
      <FumioPlayerStage
        tmdbId={tmdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        sources={fallbackSources}
        initialSourceId={fallbackSourceId}
      />
    );
  }

  return (
    <div className="relative h-full w-full bg-black" data-player="tgvid-primary">
      <div className="absolute left-3 top-3 z-30 sm:left-4 sm:top-4">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          aria-label="Change streaming server"
          className="flex min-h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3 text-[11px] font-black text-white shadow-lg backdrop-blur-md transition hover:bg-white hover:text-black active:scale-95"
        >
          <i className="ri-server-line text-sm" />
          <span>TG Vid</span>
          <i className={pickerOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
        </button>

        {pickerOpen && (
          <div className="mt-2 w-56 overflow-hidden rounded-2xl border border-white/15 bg-black/95 p-1.5 shadow-2xl backdrop-blur-xl">
            <p className="px-2.5 pb-1.5 pt-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">
              Servers
            </p>
            <div className="max-h-[min(68vh,360px)] overflow-y-auto">
              {serverOptions.map((server) => {
                const active = server.id === TG_VID_SOURCE.id;
                return (
                  <button
                    key={server.id}
                    type="button"
                    onClick={() => chooseServer(server)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                      active
                        ? "bg-white text-black"
                        : "text-zinc-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                        active ? "bg-black text-white" : "bg-white/10 text-zinc-400"
                      }`}
                    >
                      <i className="ri-play-circle-line text-sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-black">{server.name}</span>
                      <span className={`block truncate text-[9px] ${active ? "text-zinc-600" : "text-zinc-500"}`}>
                        {server.quality}
                      </span>
                    </span>
                    {active && <i className="ri-check-line text-sm" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {phase === "checking" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-white" />
        </div>
      )}
      <iframe
        key={src}
        src={src}
        onLoad={() => clearTimeout(timeoutRef.current)}
        onError={fallback}
        className="absolute inset-0 h-full w-full"
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
        frameBorder="0"
        title="TG Vid player"
      />
    </div>
  );
}
