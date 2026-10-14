import { useEffect, useMemo, useRef, useState } from "react";
import {
  TG_VID_SOURCE,
  buildStreamUrl,
  defaultAudio,
} from "../providers/sources.js";
import { buildPlayerServerSlots } from "../providers/serverSlots.js";
import { checkStreamAlive } from "../lib/streamCheck.js";
import ServerPickerBar from "./ServerPickerBar.jsx";
import FumioPlayerStage from "./FumioPlayerStage.jsx";

// TG Vid remains the preferred attempt, but a probe/iframe hiccup never
// silently replaces it with another host. The viewer chooses a fallback from
// the server bar below the video. This prevents a stream that briefly renders
// and then disappears from unexpectedly jumping to VidStuck.
const TG_LOAD_TIMEOUT_MS = 12000;

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
  toonStreamSource = null,
  toonStreamLoading = false,
  preferredServerKey = null,
}) {
  const [useFumioPlayer, setUseFumioPlayer] = useState(false);
  const [phase, setPhase] = useState("checking"); // checking | playing | error
  const [fallbackSourceId, setFallbackSourceId] = useState(null);
  const timeoutRef = useRef(null);
  const tgLoadedRef = useRef(false);

  const slots = useMemo(
    () => buildPlayerServerSlots({ animeSources, toonStreamSource, toonStreamLoading }),
    [animeSources, toonStreamSource, toonStreamLoading],
  );
  const { fallbackSources, pickerSources } = slots;

  useEffect(() => {
    setUseFumioPlayer(false);
    setPhase("checking");
    setFallbackSourceId(null);
    tgLoadedRef.current = false;
  }, [tmdbId, mediaType, season, episode]);

  // A deliberately chosen/persisted stable key is still honored, but only a
  // viewer choice can move to a fallback after this player has opened.
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
      if (cancelled || tgLoadedRef.current) return;
      if (!alive) setPhase("error");
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // A stuck TG Vid frame should show an error state and leave the choice to
  // the viewer. It must never mount VidStuck automatically.
  useEffect(() => {
    if (useFumioPlayer || phase === "playing" || phase === "error") return undefined;
    timeoutRef.current = setTimeout(() => {
      if (!tgLoadedRef.current) setPhase("error");
    }, TG_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [phase, src, useFumioPlayer]);

  const chooseServer = (server) => {
    if (!server || server.pending) return;
    clearTimeout(timeoutRef.current);
    if (server.id === TG_VID_SOURCE.id) {
      rememberServer(server.id, tmdbId);
      tgLoadedRef.current = false;
      setFallbackSourceId(null);
      setUseFumioPlayer(false);
      setPhase("checking");
      return;
    }
    rememberServer(server.id, tmdbId);
    setFallbackSourceId(server.id);
    setUseFumioPlayer(true);
  };

  const returnToPrimary = () => chooseServer(TG_VID_SOURCE);

  if (useFumioPlayer) {
    return (
      <FumioPlayerStage
        tmdbId={tmdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        sources={fallbackSources}
        initialSourceId={fallbackSourceId}
        primarySource={pickerSources[0]}
        onSelectPrimary={returnToPrimary}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-black">
      <div className="relative min-h-0 flex-1 bg-black" data-player="tgvid-primary">
        {phase === "checking" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-white" />
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/85 px-6 text-center backdrop-blur-sm">
            <i className="ri-wifi-off-line text-3xl text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-black text-white">TG Vid did not stay connected</p>
            <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
              TG Vid was left selected. Choose another server below if you want to continue; the app will not switch servers by itself.
            </p>
          </div>
        )}
        <iframe
          key={src}
          src={src}
          onLoad={() => {
            tgLoadedRef.current = true;
            clearTimeout(timeoutRef.current);
            setPhase("playing");
          }}
          onError={() => setPhase("error")}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          webkitallowfullscreen="true"
          mozallowfullscreen="true"
          frameBorder="0"
          title="TG Vid player"
        />
      </div>
      <ServerPickerBar
        sources={pickerSources}
        activeId={TG_VID_SOURCE.id}
        onSelect={chooseServer}
      />
    </div>
  );
}
