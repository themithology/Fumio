import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { tmdbGet } from "../lib/tmdb.js";
import PlayerStage from "../components/PlayerStage.jsx";
import { saveContinueWatching, saveContinueWatchingProgress } from "../utils/watchHistory.js";
import { fetchIrisSeasonData } from "../lib/irisEpisodes.js";
import { buildAnimeSources, resolveAnimeEmbeds } from "../providers/animeEmbeds.js";
import { resolveToonStream, toonStreamSource } from "../providers/toonStream.js";
import { FUMIO_SOURCES } from "../providers/sources.js";
import { lockPlayerLandscape, unlockPlayerOrientation } from "../utils/playerOrientation.js";
import {
  parseProgressMessage,
  parseReportedEpisode,
  resolveReportedEpisode,
} from "../utils/watchProgress.js";

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

const neighborPair = (seasons, season, episode, delta) => {
  const list = Array.isArray(seasons) ? seasons.filter((item) => item && item.season_number > 0) : [];
  if (!list.length) {
    const nextEpisode = episode + delta;
    if (nextEpisode < 1) return null;
    return { season, episode: nextEpisode, playerSeason: season, playerEpisode: nextEpisode };
  }
  const ordered = [...list].sort((a, b) => a.season_number - b.season_number);
  const index = ordered.findIndex((item) => item.season_number === season);
  if (index < 0) return null;
  if (delta > 0) {
    const count = Number(ordered[index].episode_count) || 0;
    if (count > 0 && episode < count) {
      return { season, episode: episode + 1, playerSeason: season, playerEpisode: episode + 1 };
    }
    const next = ordered[index + 1];
    if (!next) return null;
    return { season: next.season_number, episode: 1, playerSeason: next.season_number, playerEpisode: 1 };
  }
  if (episode > 1) {
    return { season, episode: episode - 1, playerSeason: season, playerEpisode: episode - 1 };
  }
  const prev = ordered[index - 1];
  if (!prev) return null;
  const count = Number(prev.episode_count) || 1;
  return { season: prev.season_number, episode: count, playerSeason: prev.season_number, playerEpisode: count };
};

export default function Player() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const season = Number(params.get("season") || 1);
  const episode = Number(params.get("episode") || 1);
  const uiSeason = Number(params.get("uiSeason") || season || 1);
  const uiEpisode = Number(params.get("uiEpisode") || episode || 1);
  const preferredServerKey = readServerPreference(id, params.get("server"));

  const [details, setDetails] = useState(null);
  const [animeSources, setAnimeSources] = useState([]);
  const [toonStream, setToonStream] = useState(null);
  const [toonStreamLoading, setToonStreamLoading] = useState(false);
  const [switchNotice, setSwitchNotice] = useState("");

  const episodeNavRef = useRef(null);
  const detailsRef = useRef(null);
  detailsRef.current = details;

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
      setToonStream(null);
      setToonStreamLoading(false);
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
    if (!details || !isAnimeTitle(details)) {
      setToonStream(null);
      setToonStreamLoading(false);
      return undefined;
    }
    let cancelled = false;
    setToonStream(null);
    setToonStreamLoading(true);
    const tmdbSeasonCount = (details.seasons || []).filter(
      (item) => Number(item.season_number) > 0 && Number(item.episode_count) > 0,
    ).length;
    resolveToonStream({
      type,
      title: details.name || details.title,
      id,
      season: uiSeason,
      episode: uiEpisode,
      global: tmdbSeasonCount <= 1,
    })
      .then((resolved) => {
        if (cancelled) return;
        setToonStream(resolved?.url ? toonStreamSource(resolved.url) : null);
      })
      .catch(() => {
        if (!cancelled) setToonStream(null);
      })
      .finally(() => {
        if (!cancelled) setToonStreamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [details, id, type, uiEpisode, uiSeason]);

  const persistWatching = useCallback((override = {}) => {
    const info = detailsRef.current;
    if (!info) return;
    const nextSeason = override.season ?? season;
    const nextEpisode = override.episode ?? episode;
    const nextUiSeason = override.uiSeason ?? uiSeason;
    const nextUiEpisode = override.uiEpisode ?? uiEpisode;
    try {
      window.FumioNative?.trackWatch?.(
        type,
        String(id),
        String(type === "tv" ? nextSeason : 1),
        String(type === "tv" ? nextEpisode : 1),
      );
    } catch {
      /* web */
    }
    saveContinueWatching({
      id: Number(id),
      type,
      media_type: type,
      title: info.title || info.name,
      poster_path: info.poster_path || null,
      backdrop_path: info.backdrop_path || null,
      vote_average: info.vote_average || 0,
      release_date: info.release_date || "",
      first_air_date: info.first_air_date || "",
      minutesLeft: type === "movie" ? (info.runtime || 0) : (info.episode_run_time?.[0] || 0),
      season: type === "tv" ? nextSeason : undefined,
      episode: type === "tv" ? nextEpisode : undefined,
      uiSeason: type === "tv" ? nextUiSeason : undefined,
      uiEpisode: type === "tv" ? nextUiEpisode : undefined,
      server: preferredServerKey || undefined,
      episodeName: "",
      episodeStill: "",
    });
  }, [episode, id, preferredServerKey, season, type, uiEpisode, uiSeason]);

  useEffect(() => {
    const t = details?.title || details?.name;
    document.title = t ? `Playing ${t} | TheOGPirateBot` : "TheOGPirateBot — Movies & TV";
    if (!details) return;
    persistWatching();
  }, [details, persistWatching]);

  const bridged = type === "tv" && (uiSeason !== season || uiEpisode !== episode);
  episodeNavRef.current = {
    urlSeason: season,
    urlEpisode: episode,
    bridged,
    seasons: Array.isArray(details?.seasons) ? details.seasons : null,
    candidates: [
      { season, episode, playerSeason: season, playerEpisode: episode },
      neighborPair(details?.seasons, season, episode, 1),
      neighborPair(details?.seasons, season, episode, -1),
    ].filter(Boolean),
  };

  const followPlayerEpisode = useCallback((target) => {
    if (!target || type !== "tv") return false;
    const next = new URLSearchParams(params);
    next.set("season", String(target.season));
    next.set("episode", String(target.episode));
    if (!bridged) {
      next.set("uiSeason", String(target.season));
      next.set("uiEpisode", String(target.episode));
    } else if (target.season === season) {
      const delta = target.episode - episode;
      next.set("uiEpisode", String(Math.max(1, uiEpisode + delta)));
    }
    persistWatching({
      season: target.season,
      episode: target.episode,
      uiSeason: Number(next.get("uiSeason") || uiSeason),
      uiEpisode: Number(next.get("uiEpisode") || uiEpisode),
    });
    setSwitchNotice(`Now tracking S${target.season} E${target.episode}`);
    navigate(`/watch/${type}/${id}?${next.toString()}`, { replace: true });
    return true;
  }, [bridged, episode, id, navigate, params, persistWatching, season, type, uiEpisode, uiSeason]);

  useEffect(() => {
    if (!id || !type) return undefined;
    let latest = null;
    let lastSaved = 0;
    let lastSavedPos = -1;
    let foreignEpisode = false;
    let navigatedTo = null;

    const saveProgress = () => {
      if (!latest || foreignEpisode) return;
      const pos = Math.round(latest.currentTime);
      if (pos === lastSavedPos) return;
      saveContinueWatchingProgress(
        { id: Number(id), type, season, episode },
        latest.currentTime,
        latest.duration,
      );
      lastSaved = Date.now();
      lastSavedPos = pos;
    };

    const onMessage = (event) => {
      if (event.source === window) return;
      if (type === "tv") {
        const target = resolveReportedEpisode(parseReportedEpisode(event.data), episodeNavRef.current);
        if (target) {
          const key = `${target.season}:${target.episode}`;
          if (navigatedTo !== key) {
            navigatedTo = key;
            foreignEpisode = true;
            followPlayerEpisode(target);
          }
          return;
        }
      }

      const parsed = parseProgressMessage(event.data);
      if (!parsed) return;
      latest = parsed;
      const word = String(event.data?.data?.event || event.data?.event || "").toLowerCase();
      const urgent = parsed.ended || word === "pause" || word === "paused" || word === "seeked";
      if (urgent || Date.now() - lastSaved >= 15000) saveProgress();
    };

    const onHide = () => {
      if (document.visibilityState === "hidden") saveProgress();
    };

    const readIframeEpisode = () => {
      if (type !== "tv") return;
      // When the server list came from the WEBSITE (the app's dynamic list),
      // the episode numbers inside those embed URLs are the SITE's numbering —
      // anime arcs, TMDB/AniList bridges, its own season mapping. Following
      // them would move the app to a season it never asked for ("Now tracking
      // S2 E50" on a S1E1 click). Playback tracking stays with the player's own
      // progress messages, and the embed URL is what the site would play.
      const liveList = typeof window !== "undefined" && Boolean(window.__fumioLiveSources);
      if (liveList) return;
      document.querySelectorAll("iframe").forEach((frame) => {
        const src = frame.getAttribute("src") || "";
        const match = src.match(/\/(?:embed\/)?tv\/(\d+)\/(\d+)\/(\d+)/i);
        if (!match || String(match[1]) !== String(id)) return;
        const nextSeason = Number(match[2]);
        const nextEpisode = Number(match[3]);
        if (!nextSeason || !nextEpisode) return;
        if (nextSeason === season && nextEpisode === episode) return;
        followPlayerEpisode({ season: nextSeason, episode: nextEpisode });
      });
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", saveProgress);
    const iframeTimer = window.setInterval(readIframeEpisode, 2000);
    return () => {
      saveProgress();
      window.clearInterval(iframeTimer);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", saveProgress);
    };
  }, [episode, followPlayerEpisode, id, season, type]);

  const close = useCallback(() => {
    unlockPlayerOrientation();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try {
      if (window.FumioNative?.closePlayer) {
        window.FumioNative.closePlayer();
        return;
      }
    } catch {
      /* web */
    }
    navigate(`/details/${type}/${id}`, { replace: true });
  }, [navigate, type, id]);

  return (
    <div className="fixed inset-0 z-50 h-[100dvh] w-[100dvw] max-h-[100dvh] max-w-[100vw] overflow-hidden bg-black">
      <PlayerStage
        tmdbId={id}
        mediaType={type}
        season={season}
        episode={episode}
        animeSources={animeSources}
        toonStreamSource={toonStream}
        toonStreamLoading={toonStreamLoading}
        preferredServerKey={preferredServerKey}
      />
      <button
        onClick={close}
        aria-label="Close player"
        className="absolute z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
        style={{
          top: "max(12px, env(safe-area-inset-top, 0px))",
          right: "max(12px, env(safe-area-inset-right, 0px))",
        }}
      >
        ✕
      </button>
      {switchNotice && (
        <p className="pointer-events-none absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-[11px] font-bold text-white backdrop-blur">
          {switchNotice}
        </p>
      )}
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
