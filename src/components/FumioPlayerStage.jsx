import { useEffect, useRef, useState } from "react";
import { FUMIO_SOURCES, buildStreamUrl, defaultAudio } from "../providers/sources.js";
import { checkStreamAlive } from "../lib/streamCheck.js";

// Fumio's original fallback lane. Sources never switch themselves: the
// viewer owns the choice from the compact top-left picker. TG Vid is handled
// by PlayerStage as the preferred attempt before this lane is mounted; valid
// Anime Sub/Dub lanes can be appended without changing the original sources.
const LOAD_TIMEOUT_MS = 12000;

const rememberServer = (serverKey, titleId) => {
  try {
    localStorage.setItem("preferredServerKey", serverKey);
    if (titleId) localStorage.setItem(`preferredServerKey:${titleId}`, serverKey);
  } catch {
    // Storage is optional; playback must continue in private mode.
  }
};

export default function FumioPlayerStage({
  tmdbId,
  mediaType,
  season,
  episode,
  sources = FUMIO_SOURCES,
  initialSourceId = null,
}) {
  const availableSources = sources?.length ? sources : FUMIO_SOURCES;
  const initialIndex = Math.max(
    0,
    availableSources.findIndex((candidate) => candidate.id === initialSourceId),
  );
  const [candidateIndex, setCandidateIndex] = useState(initialIndex);
  const [phase, setPhase] = useState("checking"); // checking | playing | error | exhausted
  const [retryNonce, setRetryNonce] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    setCandidateIndex(initialIndex);
    setPhase("checking");
    setRetryNonce(0);
    setPickerOpen(false);
  }, [tmdbId, mediaType, season, episode, initialIndex]);

  const source = availableSources[candidateIndex] || null;
  const src = source
    ? buildStreamUrl(source, tmdbId, mediaType, season, episode, defaultAudio(source))
    : null;

  useEffect(() => {
    if (!source || !src) {
      setPhase("exhausted");
      return undefined;
    }
    let cancelled = false;
    setPhase("checking");
    checkStreamAlive(src).then((alive) => {
      if (cancelled) return;
      // A dead probe marks THIS server as unavailable; it never advances to
      // another one without an explicit click in the picker.
      setPhase(alive ? "playing" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [retryNonce, source, src]);

  useEffect(() => {
    if (!source || phase !== "playing") return undefined;
    timeoutRef.current = setTimeout(() => setPhase("error"), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [phase, candidateIndex, source]);

  const selectSource = (index) => {
    clearTimeout(timeoutRef.current);
    if (availableSources[index]?.id) rememberServer(availableSources[index].id, tmdbId);
    setCandidateIndex(index);
    setPhase("checking");
    setPickerOpen(false);
  };

  const retry = () => {
    clearTimeout(timeoutRef.current);
    setPhase("checking");
    // Changing the key makes the iframe retry without selecting another server.
    setRetryNonce((nonce) => nonce + 1);
  };

  const handleLoad = () => {
    clearTimeout(timeoutRef.current);
    setPhase("playing");
  };
  const handleError = () => setPhase("error");

  if (phase === "exhausted") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black text-center text-zinc-400">
        <span className="text-sm font-bold uppercase tracking-widest">No servers configured</span>
        <span className="text-xs text-zinc-600">There are no TheOGPirateBot fallback sources available.</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black" data-player="fumio">
      <div className="absolute left-3 top-3 z-30 sm:left-4 sm:top-4">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          aria-label="Change streaming server"
          className="flex min-h-10 items-center gap-2 rounded-full border border-white/20 bg-black/75 px-3.5 text-xs font-black text-white shadow-lg backdrop-blur-md transition hover:bg-white hover:text-black active:scale-95"
        >
          <i className="ri-server-line text-sm" />
          <span>{source?.name || "Choose server"}</span>
          <i className={pickerOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
        </button>

        {pickerOpen && (
          <div className="mt-2 w-64 overflow-hidden rounded-2xl border border-white/15 bg-black/95 p-1.5 shadow-2xl backdrop-blur-xl">
            <p className="px-3 pb-1.5 pt-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              Choose server
            </p>
            <div className="max-h-[min(68vh,360px)] overflow-y-auto">
            {availableSources.map((candidate, index) => {
              const active = index === candidateIndex;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => selectSource(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${active ? "bg-black text-white" : "bg-white/10 text-zinc-400"}`}>
                    <i className="ri-play-circle-line" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-black">{candidate.name}</span>
                    <span className={`block text-[10px] ${active ? "text-zinc-600" : "text-zinc-500"}`}>{candidate.quality}</span>
                  </span>
                  {active && <i className="ri-check-line text-base" />}
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
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Checking {source?.name}…</span>
        </div>
      )}

      {source && (
        <iframe
          key={`${src}-${candidateIndex}-${retryNonce}`}
          src={src}
          onLoad={handleLoad}
          onError={handleError}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          frameBorder="0"
          title={`${source.name} player`}
        />
      )}

      {phase === "error" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center backdrop-blur-[2px]">
          <i className="ri-wifi-off-line text-3xl text-zinc-500" />
          <p className="text-sm font-black text-white">{source?.name} did not load</p>
          <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
            No server switches automatically. Choose another server from the top-left menu.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={retry}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white hover:text-black"
            >
              <i className="ri-refresh-line mr-1" /> Retry
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="rounded-full bg-white px-4 py-2 text-xs font-black text-black transition hover:bg-zinc-200"
            >
              Change server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
