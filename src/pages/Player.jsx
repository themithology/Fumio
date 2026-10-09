import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { tmdbGet } from "../lib/tmdb.js";
import PlayerStage from "../components/PlayerStage.jsx";
import { saveContinueWatching, saveContinueWatchingProgress } from "../utils/watchHistory.js";
import { fetchIrisSeasonData } from "../lib/irisEpisodes.js";
import { buildAnimeSources, resolveAnimeEmbeds } from "../providers/animeEmbeds.js";
import { FUMIO_SOURCES } from "../providers/sources.js";
import { lockPlayerLandscape, unlockPlayerOrientation } from "../utils/playerOrientation.js";

const PLAYER_ORIGINS = new Set([
  "https://tgvid.lovable.app",
  "https://vidstuck.xyz",
  "https://vidfast.vc",
  "https://bingr.one",
  "https://zxcstream.xyz",
  "https://nxsha.space",
  "https://megaplay.buzz",
  "https://zokoanime.video",
  "https://cdn.4animo.xyz",
]);

const ANIME_TITLE_HINTS = [
  "shinchan",
  "shin-chan",
  "doraemon",
  "anime",
  "pokemon",
  "naruto",
  "dragon ball",
  "one piece",
  "mushoku",
  "demon slayer",
];

const isAnimeTitle = (detail) => {
  if (!detail) return false;
  const title = (detail.name || detail.title || "").toLowerCase();
  return Boolean(
    detail.original_language === "ja" ||
      detail.genres?.some((genre) => genre.id === 16) ||
      detail.origin_country?.includes("JP") ||
      ANIME_TITLE_HINTS.some((hint) => title.includes(hint)),
  );
};

const readServerPreference = (titleId, rawServer) => {
  if (rawServer && !/^\d+$/.test(rawServer)) return rawServer;
  if (rawServer && /^\d+$/.test(rawServer)) {
    return FUMIO_SOURCES[Number(rawServer)]?.id || null;
  }
  try {
    return (
      localStorage.getItem(`preferredServerKey:${titleId}`) ||
      localStorage.getItem("preferredServerKey") ||
      null
    );
  } catch {
    return null;
  }
};

const readProgressMessage = (message) => {
  let value = message;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value?.data && typeof value.data === "object") value = value.data;
  if (value?.payload && typeof value.payload === "object") value = value.payload;
  const duration = Number(value?.duration ?? value?.totalDuration ?? value?.length);
  let current = Number(value?.currentTime ?? value?.position ?? value?.time);
  if (!Number.isFinite(current) && Number.isFinite(Number(value?.progress))) {
    const ratio = Number(value.progress);
    current = ratio >= 0 && ratio <= 1 ? ratio * duration : ratio;
  }
  return Number.isFinite(current) && Number.isFinite(duration) && duration > 0 ? { current, duration } : null;
};

export default function Player() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const season = Number(params.get("season") || 1);
  const episode = Number(params.get("episode") || 1);
  // TMDB coordinates keep the existing Fumio sources working. Anime lanes
  // use the optional Iris/AniList UI coordinates so a split cour or merged
  // season resolves to the correct AniList entry and local episode number.
  const uiSeason = Number(params.get("uiSeason") || season || 1);
  const uiEpisode = Number(params.get("uiEpisode") || episode || 1);
  const preferredServerKey = readServerPreference(id, params.get("server"));

  const [details, setDetails] = useState(null);
  const [animeSources, setAnimeSources] = useState([]);

  useEffect(() => {
    lockPlayerLandscape();
    return () => {
      unlockPlayerOrientation();
    };
  }, []);

  useEffect(() => {
    tmdbGet(`${type}/${id}`)
      .then(setDetails)
      .catch(() => setDetails(null));
  }, [type, id]);

  useEffect(() => {
    if (!details || !isAnimeTitle(details)) {
      setAnimeSources([]);
      return undefined;
    }

    let cancelled = false;
    const tmdbEpisodes = type === "tv"
      ? (details.seasons || []).reduce(
          (total, item) => total + (Number(item.episode_count) || 0),
          0,
        )
      : 0;
    const year = Number((details.first_air_date || details.release_date || "").slice(0, 4)) || null;

    fetchIrisSeasonData({
      title: details.name || details.title,
      tmdbEpisodes,
      year,
    })
      .then((metadata) => {
        if (cancelled) return;
        const resolved = resolveAnimeEmbeds({
          metadata,
          uiSeason,
          uiEpisode,
          tmdbId: id,
        });
        setAnimeSources(buildAnimeSources(resolved || {}));
      })
      .catch(() => {
        if (!cancelled) {
          const resolved = resolveAnimeEmbeds({ uiSeason, uiEpisode, tmdbId: id });
          setAnimeSources(buildAnimeSources(resolved || {}));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [details, id, type, uiEpisode, uiSeason]);

  useEffect(() => {
    const t = details?.title || details?.name;
    document.title = t ? `Playing ${t} | TheOGPirateBot` : "TheOGPirateBot — Movies & TV";
    if (!details) return;
    saveContinueWatching({
      id: Number(id),
      type,
      media_type: type,
      title: t,
      poster_path: details.poster_path || null,
      backdrop_path: details.backdrop_path || null,
      vote_average: details.vote_average || 0,
      release_date: details.release_date || "",
      first_air_date: details.first_air_date || "",
      minutesLeft: type === "movie" ? (details.runtime || 0) : (details.episode_run_time?.[0] || 0),
      season: type === "tv" ? season : undefined,
      episode: type === "tv" ? episode : undefined,
      uiSeason: type === "tv" ? uiSeason : undefined,
      uiEpisode: type === "tv" ? uiEpisode : undefined,
      server: preferredServerKey || undefined,
      episodeName: "",
      episodeStill: "",
    });
  }, [details, episode, id, preferredServerKey, season, type, uiEpisode, uiSeason]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!PLAYER_ORIGINS.has(event.origin)) return;
      const progress = readProgressMessage(event.data);
      if (!progress) return;
      saveContinueWatchingProgress({ id: Number(id), type, season, episode }, progress.current, progress.duration);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [episode, id, season, type]);

  const close = useCallback(() => {
    unlockPlayerOrientation();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(`/details/${type}/${id}`, { replace: true });
  }, [navigate, type, id]);

  // If the user backs out of fullscreen with Esc/the browser's own chrome,
  // treat it the same as pressing Close — this page has no purpose outside
  // fullscreen.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) navigate(`/details/${type}/${id}`, { replace: true });
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [navigate, type, id]);

  return (
    <div className="fixed inset-0 z-50 h-screen w-screen bg-black">
      <PlayerStage
        tmdbId={id}
        mediaType={type}
        season={season}
        episode={episode}
        animeSources={animeSources}
        preferredServerKey={preferredServerKey}
      />
      <button
        onClick={close}
        aria-label="Close player"
        className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
      >
        ✕
      </button>
      <div className="player-portrait-guard absolute inset-0 z-[110] flex-col items-center justify-center gap-5 bg-black px-8 text-center">
        <i className="ri-smartphone-line rotate-90 text-5xl text-white" aria-hidden="true" />
        <div>
          <p className="text-base font-black text-white">Rotate your phone to play</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">The player is available in landscape only.</p>
        </div>
        <button type="button" onClick={close} className="rounded-full border border-white/15 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-white/10">
          Back to title
        </button>
      </div>
    </div>
  );
}
