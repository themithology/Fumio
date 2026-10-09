import { useEffect, useRef, useState } from "react";
import { FUMIO_SOURCES, buildStreamUrl, defaultAudio } from "../providers/sources.js";
import { checkStreamAlive } from "../lib/streamCheck.js";

// The original Fumio player lane. It owns the complete source list and its
// existing automatic failover; TG Vid is intentionally handled by the outer
// PlayerStage before this component is mounted.
const LOAD_TIMEOUT_MS = 12000;

export default function FumioPlayerStage({ tmdbId, mediaType, season, episode }) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [phase, setPhase] = useState("checking"); // checking | playing | exhausted
  const timeoutRef = useRef(null);

  useEffect(() => {
    setCandidateIndex(0);
    setPhase("checking");
  }, [tmdbId, mediaType, season, episode]);

  const source = FUMIO_SOURCES[candidateIndex] || null;
  const src = source
    ? buildStreamUrl(source, tmdbId, mediaType, season, episode, defaultAudio(source))
    : null;

  useEffect(() => {
    if (!source) {
      setPhase("exhausted");
      return undefined;
    }
    let cancelled = false;
    setPhase("checking");
    checkStreamAlive(src).then((alive) => {
      if (cancelled) return;
      if (alive) setPhase("playing");
      else setCandidateIndex((index) => index + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [source, src]);

  useEffect(() => {
    if (phase !== "playing") return undefined;
    timeoutRef.current = setTimeout(() => {
      setCandidateIndex((index) => index + 1);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [phase, candidateIndex]);

  const handleLoad = () => clearTimeout(timeoutRef.current);
  const handleError = () => setCandidateIndex((index) => index + 1);

  if (phase === "exhausted") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black text-center text-zinc-400">
        <span className="text-sm font-bold uppercase tracking-widest">No server currently has this title</span>
        <span className="text-xs text-zinc-600">Every source failed — try again later.</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black" data-player="fumio">
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
          title="TheOGPirateBot player"
        />
      )}
    </div>
  );
}
