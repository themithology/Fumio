import { useEffect, useRef, useState } from "react";
import { SOURCES, buildStreamUrl, defaultAudio } from "../providers/sources.js";
import { checkStreamAlive } from "../lib/streamCheck.js";

// ─── PlayerStage ────────────────────────────────────────────────────────────
// tgvid first, automatic failover through the rest of TheOGPirateBot's real
// source list if it's down — no Quality/Audio pickers, no server-switcher UI.
// Just: try the best source, silently fall back if it's dead, play it
// edge-to-edge. One probe (worker-side, see /api/stream-check) decides "is
// this host even up" before committing to an iframe; an iframe-level error
// or stall still advances to the next candidate as a second safety net.

const LOAD_TIMEOUT_MS = 12000;

export default function PlayerStage({ tmdbId, mediaType, season, episode }) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [phase, setPhase] = useState("checking"); // checking | playing | exhausted
  const timeoutRef = useRef(null);

  // Reset to the top of the list whenever the title/episode changes.
  useEffect(() => {
    setCandidateIndex(0);
    setPhase("checking");
  }, [tmdbId, mediaType, season, episode]);

  const source = SOURCES[candidateIndex] || null;
  const src = source ? buildStreamUrl(source, tmdbId, mediaType, season, episode, defaultAudio(source)) : null;

  // Probe the current candidate before mounting its iframe.
  useEffect(() => {
    if (!source) {
      setPhase("exhausted");
      return undefined;
    }
    let cancelled = false;
    setPhase("checking");
    checkStreamAlive(src).then((alive) => {
      if (cancelled) return; // a newer candidate superseded this probe
      if (alive) {
        setPhase("playing");
      } else {
        setCandidateIndex((i) => i + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source, src]);

  // Belt-and-suspenders: if the iframe never actually loads (host hangs),
  // move on. Cleared on unmount/candidate change.
  useEffect(() => {
    if (phase !== "playing") return undefined;
    timeoutRef.current = setTimeout(() => {
      setCandidateIndex((i) => i + 1);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [phase, candidateIndex]);

  const handleLoad = () => clearTimeout(timeoutRef.current);
  const handleError = () => setCandidateIndex((i) => i + 1);

  if (phase === "exhausted") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black text-center text-zinc-400">
        <span className="text-sm font-bold uppercase tracking-widest">No server currently has this title</span>
        <span className="text-xs text-zinc-600">Every source failed — try again later.</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      {phase === "checking" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-white" />
        </div>
      )}
      {source && (
        <iframe
          key={src}
          src={src}
          onLoad={handleLoad}
          onError={handleError}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          frameBorder="0"
          title="Player"
        />
      )}
    </div>
  );
}
