import { useEffect, useRef, useState } from "react";
import { FUMIO_SOURCES, buildStreamUrl, defaultAudio } from "../providers/sources.js";
import { checkStreamAlive } from "../lib/streamCheck.js";
import ServerPickerBar from "./ServerPickerBar.jsx";

// TheOGPirateBot fallback lane. Sources never switch themselves: the
// viewer owns the choice from the server bar below the video. Anime Sub/Dub
// slots can be appended without removing the original providers.
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
  primarySource = null,
  onSelectPrimary = null,
}) {
  const availableSources = sources?.length ? sources : FUMIO_SOURCES;
  const initialIndex = Math.max(
    0,
    availableSources.findIndex((candidate) => candidate.id === initialSourceId),
  );
  const [candidateIndex, setCandidateIndex] = useState(initialIndex);
  const [phase, setPhase] = useState("checking"); // checking | playing | error | exhausted
  const [retryNonce, setRetryNonce] = useState(0);
  const timeoutRef = useRef(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    setCandidateIndex(initialIndex);
    setPhase("checking");
    setRetryNonce(0);
    loadedRef.current = false;
  }, [tmdbId, mediaType, season, episode, initialIndex]);

  const source = availableSources[candidateIndex] || null;
  const src = source
    ? buildStreamUrl(source, tmdbId, mediaType, season, episode, defaultAudio(source))
    : null;
  const pickerSources = primarySource
    ? [primarySource, ...availableSources]
    : availableSources;

  useEffect(() => {
    if (!source || !src) {
      setPhase("exhausted");
      return undefined;
    }
    let cancelled = false;
    setPhase("checking");
    checkStreamAlive(src).then((alive) => {
      if (!cancelled && !loadedRef.current && !alive) setPhase("error");
    });
    return () => {
      cancelled = true;
    };
  }, [retryNonce, source, src]);

  // Only a frame that never loads gets an error state. A loaded source is not
  // replaced later by a timer; the viewer decides when to change servers.
  useEffect(() => {
    if (!source || phase !== "checking") return undefined;
    timeoutRef.current = setTimeout(() => setPhase("error"), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [phase, source, src]);

  const selectSource = (candidate) => {
    if (!candidate) return;
    if (primarySource && candidate.id === primarySource.id) {
      clearTimeout(timeoutRef.current);
      onSelectPrimary?.();
      return;
    }
    const index = availableSources.findIndex((item) => item.id === candidate.id);
    if (index < 0) return;
    clearTimeout(timeoutRef.current);
    rememberServer(candidate.id, tmdbId);
    loadedRef.current = false;
    setCandidateIndex(index);
    setPhase("checking");
  };

  const retry = () => {
    clearTimeout(timeoutRef.current);
    loadedRef.current = false;
    setPhase("checking");
    setRetryNonce((nonce) => nonce + 1);
  };

  const handleLoad = () => {
    loadedRef.current = true;
    clearTimeout(timeoutRef.current);
    setPhase("playing");
  };

  if (phase === "exhausted") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black text-center text-zinc-400">
        <span className="text-sm font-bold uppercase tracking-widest">No servers configured</span>
        <span className="text-xs text-zinc-600">There are no fallback sources available.</span>
        <ServerPickerBar
          sources={pickerSources}
          activeId={source?.id}
          onSelect={selectSource}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-black" data-player="theogpiratebot">
      <div className="relative min-h-0 flex-1 bg-black">
        {phase === "checking" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-white" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Checking {source?.name}…
            </span>
          </div>
        )}

        {source && (
          <iframe
            key={`${src}-${candidateIndex}-${retryNonce}`}
            src={src}
            onLoad={handleLoad}
            onError={() => setPhase("error")}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            webkitallowfullscreen="true"
            mozallowfullscreen="true"
            frameBorder="0"
            title={`${source.name} player`}
          />
        )}

        {phase === "error" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center backdrop-blur-[2px]">
            <i className="ri-wifi-off-line text-3xl text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-black text-white">{source?.name} did not load</p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              No server switches automatically. Choose another server below the player.
            </p>
            <button
              type="button"
              onClick={retry}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white hover:text-black"
            >
              <i className="ri-refresh-line mr-1" /> Retry this server
            </button>
          </div>
        )}
      </div>

      <ServerPickerBar
        sources={pickerSources}
        activeId={source?.id}
        onSelect={selectSource}
      />
    </div>
  );
}
