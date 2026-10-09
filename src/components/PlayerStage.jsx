import { useEffect, useRef, useState } from "react";
import { TG_VID_SOURCE, buildStreamUrl, defaultAudio } from "../providers/sources.js";
import { checkStreamAlive } from "../lib/streamCheck.js";
import FumioPlayerStage from "./FumioPlayerStage.jsx";

// ─── PlayerStage ────────────────────────────────────────────────────────────
// Two lanes, intentionally kept separate:
//
//   1. TG Vid is attempted once as the preferred source.
//   2. Any TG Vid failure hands off to FumioPlayerStage, which owns Fumio's
//      original source list and exposes a manual server picker.
//
// This means TG Vid is not mixed into or duplicated inside Fumio's source
// picker. Once the fallback lane is mounted, no server changes without a
// viewer click.
const TG_LOAD_TIMEOUT_MS = 12000;

export default function PlayerStage({ tmdbId, mediaType, season, episode }) {
  const [useFumioPlayer, setUseFumioPlayer] = useState(false);
  const [phase, setPhase] = useState("checking"); // checking | playing
  const timeoutRef = useRef(null);

  useEffect(() => {
    setUseFumioPlayer(false);
    setPhase("checking");
  }, [tmdbId, mediaType, season, episode]);

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
      />
    );
  }

  return (
    <div className="relative h-full w-full bg-black" data-player="tgvid-primary">
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
