import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { tmdbGet, img } from "../lib/tmdb.js";
import {
  fetchIrisEpisodes,
  fetchIrisSeasonData,
  mapIrisEpisodeToTmdb,
  tmdbEnrichAnilistEpisodes,
  tmdbSeasonEpisodes,
} from "../lib/irisEpisodes.js";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import Footer from "../components/Footer.jsx";
import Topnav from "../components/partials/Topnav.jsx";
import SeasonEpisodeBrowser from "../components/partials/SeasonEpisodeBrowser.jsx";
import { isInMyList, toggleMyList } from "../utils/myList.js";
import { lockPlayerLandscape } from "../utils/playerOrientation.js";

const firstTrailer = (videos) =>
  (videos?.results || []).find(
    (video) => video.site === "YouTube" && (video.type === "Trailer" || video.type === "Teaser"),
  ) || (videos?.results || []).find((video) => video.site === "YouTube");

const castImage = (path) => (path ? `https://image.tmdb.org/t/p/w185${path}` : null);

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
    detail.genres?.some((genre) => genre.id === 16) ||
      detail.origin_country?.includes("JP") ||
      ANIME_TITLE_HINTS.some((hint) => title.includes(hint)),
  );
};

export default function Details() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const [details, setDetails] = useState(null);
  const [err, setErr] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodeRetry, setEpisodeRetry] = useState(0);
  const [irisLoading, setIrisLoading] = useState(false);
  const [irisMeta, setIrisMeta] = useState(null);
  const [episodeSource, setEpisodeSource] = useState(null);
  const [nextAiring, setNextAiring] = useState(null);
  const [inMyList, setInMyList] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [trailerOpen, setTrailerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setErr(null);
    setIrisMeta(null);
    setIrisLoading(false);
    setEpisodes([]);
    setEpisodeSource(null);
    setEpisodeRetry(0);
    setNextAiring(null);
    setInMyList(false);
    setNowSeconds(Math.floor(Date.now() / 1000));
    setSelectedSeason(1);
    setSelectedEpisode(null);
    setSelectedPair(null);
    setTrailerOpen(false);

    tmdbGet(`${type}/${id}`, {
      append_to_response: "videos,credits,images",
    })
      .then((data) => {
        if (cancelled) return;
        setDetails(data);
        setInMyList(isInMyList({ id: Number(id), type }));
        // Match Iris's own anime gate: anime seasons/episodes wait for Iris;
        // ordinary TV stays on the normal TMDB fallback immediately.
        if (type === "tv" && isAnimeTitle(data)) setIrisLoading(true);
        const firstSeason = (data.seasons || []).find((season) => season.season_number > 0);
        if (firstSeason) setSelectedSeason(firstSeason.season_number);
      })
      .catch((error) => {
        if (!cancelled) setErr(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [type, id]);

  const tmdbSeasons = useMemo(
    () =>
      (details?.seasons || [])
        .filter((season) => season.season_number > 0)
        .map((season) => ({
          ...season,
          poster_path: img(season.poster_path, "w300"),
        })),
    [details],
  );

  // Iris is the source for the selector whenever the title has an Iris/AniList
  // season chain. Ordinary TV falls back cleanly to TMDB's own season list;
  // a resolved Iris title never falls back to a mismatched TMDB list.
  useEffect(() => {
    if (!details || type !== "tv" || !isAnimeTitle(details)) {
      setIrisLoading(false);
      return undefined;
    }
    let cancelled = false;
    const tmdbEpisodes = tmdbSeasons.reduce(
      (total, season) => total + (Number(season.episode_count) || 0),
      0,
    );
    const year = Number((details.first_air_date || "").slice(0, 4)) || null;

    setIrisLoading(true);
    fetchIrisSeasonData({
      title: details.name || details.title,
      tmdbEpisodes,
      year,
    })
      .then((metadata) => {
        if (cancelled) return;
        setIrisMeta(metadata);
        setNextAiring(metadata?.nextAiring || null);
        if (metadata?.seasons?.length) {
          setSelectedSeason((current) =>
            metadata.seasons.some((season) => season.season_number === current)
              ? current
              : metadata.seasons[0].season_number,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setIrisMeta(null);
      })
      .finally(() => {
        if (!cancelled) setIrisLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [details, type, tmdbSeasons]);

  // AniList's nextAiringEpisode is a Unix timestamp. Tick every second while
  // the title is airing so the hero never displays a stale countdown.
  useEffect(() => {
    if (!nextAiring?.airingAt) return undefined;
    setNowSeconds(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [nextAiring]);

  const waitingForIris = type === "tv" && isAnimeTitle(details) && irisLoading && !irisMeta;
  const seasons = irisMeta?.seasons?.length
    ? irisMeta.seasons
    : waitingForIris
      ? []
      : tmdbSeasons;
  const activeSeason = seasons.find((season) => season.season_number === selectedSeason) || seasons[0] || null;

  useEffect(() => {
    if (waitingForIris) {
      setEpisodes([]);
      setEpisodeSource(null);
      setEpisodesLoading(true);
      return undefined;
    }

    if (!details || type !== "tv" || !activeSeason) {
      setEpisodes([]);
      setEpisodeSource(null);
      setEpisodesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setEpisodesLoading(true);
    setSelectedEpisode(null);
    setSelectedPair(null);

    const setFirstEpisode = (items, source) => {
      if (cancelled) return;
      setEpisodes(items);
      setEpisodeSource(source);
      if (items.length > 0) {
        setSelectedEpisode(items[0].episode_number);
        setSelectedPair({
          season: items[0].playerSeason,
          episode: items[0].playerEpisode,
        });
      }
    };

    const toPlayerItems = (list, source) =>
      list.map((episode) => {
        const number = episode.episode_number || episode.number;
        const pair =
          source === "iris"
            ? mapIrisEpisodeToTmdb(selectedSeason, number, irisMeta?.seasonsMap, tmdbSeasons)
            : { season: selectedSeason, episode: number };
        const thumbnail = episode.thumbnail;
        const stillPath =
          episode.still_path ||
          (typeof thumbnail === "string" ? thumbnail : thumbnail?.large || thumbnail?.medium || null);
        return {
          ...episode,
          id: `${source}-${selectedSeason}-${number}`,
          episode_number: number,
          name: episode.name || episode.title || `Episode ${number}`,
          overview: episode.overview || "",
          still_path: stillPath,
          air_date: episode.air_date || "",
          playerSeason: pair.season,
          playerEpisode: pair.episode,
        };
      });

    const loadEpisodes = async () => {
      // Same ladder as Iris TvDetails: AniList collection first, then a mapped
      // TMDB grid, then a full TMDB season list. Never leave the page empty.
      if (irisMeta && activeSeason.anilist_id) {
        const irisData = await fetchIrisEpisodes(activeSeason.anilist_id);
        if (irisData?.episodes?.length) {
          const enriched = await tmdbEnrichAnilistEpisodes({
            id,
            season: selectedSeason,
            episodes: irisData.episodes,
            irisSeasonsMap: irisMeta.seasonsMap,
            tmdbSeasons,
          });
          setFirstEpisode(toPlayerItems(enriched, "iris"), "iris");
          return;
        }

        const rawCount = irisMeta.rawCounts?.[selectedSeason] ?? irisMeta.rawCounts?.[String(selectedSeason)];
        if (rawCount == null) {
          // One Piece-style placeholder count: drop the 12-episode AniList
          // shell and show TMDB's real seasons, exactly as Iris does.
          setIrisMeta(null);
          return;
        }

        const first = mapIrisEpisodeToTmdb(selectedSeason, 1, irisMeta.seasonsMap, tmdbSeasons);
        const tmdbEpisodes = await tmdbSeasonEpisodes(id, first.season);
        const count = Number(irisMeta.seasonsMap?.[selectedSeason]) || tmdbEpisodes.length || 0;
        const mapped = [];
        for (let number = 1; number <= count; number += 1) {
          const pair = mapIrisEpisodeToTmdb(selectedSeason, number, irisMeta.seasonsMap, tmdbSeasons);
          const tmdb = tmdbEpisodes.find((item) => item.episode_number === pair.episode);
          mapped.push({
            episode_number: number,
            name: tmdb?.name || `Episode ${number}`,
            overview: tmdb?.overview || "",
            still_path: tmdb?.still_path || null,
            air_date: tmdb?.air_date || "",
            playerSeason: pair.season,
            playerEpisode: pair.episode,
          });
        }
        if (mapped.length) {
          setFirstEpisode(toPlayerItems(mapped, "iris"), "iris");
          return;
        }
      }

      const tmdbEpisodes = await tmdbSeasonEpisodes(id, selectedSeason);
      setFirstEpisode(toPlayerItems(tmdbEpisodes, "tmdb"), "tmdb");
    };

    loadEpisodes()
      .catch(() => {
        if (!cancelled) {
          setEpisodes([]);
          setEpisodeSource(null);
        }
      })
      .finally(() => {
        if (!cancelled) setEpisodesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSeason, details, episodeRetry, id, irisMeta, selectedSeason, tmdbSeasons, type, waitingForIris]);

  useEffect(() => {
    const refreshListState = () => setInMyList(isInMyList({ id: Number(id), type }));
    window.addEventListener("mylist-updated", refreshListState);
    return () => window.removeEventListener("mylist-updated", refreshListState);
  }, [id, type]);

  useEffect(() => {
    const title = details?.title || details?.name;
    document.title = title ? `${title} | TheOGPirateBot` : "TheOGPirateBot — Movies & TV";
  }, [details]);

  if (err) {
    return (
      <div className="min-h-screen bg-[var(--gtv-bg)]">
        <Topnav />
        <FetchError onRetry={() => navigate(0)} message={`Couldn't load this title: ${err}`} />
      </div>
    );
  }
  if (!details) return <Loading />;

  const title = details.title || details.name || "Untitled";
  const year = (details.release_date || details.first_air_date || "").slice(0, 4);
  const trailer = firstTrailer(details.videos);
  const backdrop = img(details.backdrop_path || details.poster_path, "w1280");
  const logoPath = details.images?.logos?.find((logo) => logo.iso_639_1 === "en")?.file_path || details.images?.logos?.[0]?.file_path;
  const logoSrc = img(logoPath, "w500");
  const runtime = details.runtime || details.episode_run_time?.[0];
  const mediaLabel = type === "tv" ? "Series" : "Movie";
  const selectedEpisodeItem = episodes.find((episode) => episode.episode_number === selectedEpisode);
  const animeDetails = type === "tv" && isAnimeTitle(details);
  const nextAirAt = Number(nextAiring?.airingAt) || 0;
  const secondsUntilAir = nextAirAt - nowSeconds;
  const formatCountdown = (seconds) => {
    const remaining = Math.max(0, seconds);
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const secs = remaining % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };
  const airingDate = nextAirAt
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(nextAirAt * 1000))
    : "";
  const scheduleState = !animeDetails
    ? "none"
    : irisLoading && !irisMeta
      ? "loading"
      : nextAirAt > nowSeconds
        ? "upcoming"
        : irisMeta
          ? "ended"
          : "unavailable";
  const libraryItem = {
    id: Number(id),
    type,
    title: details.title || details.name,
    poster_path: details.poster_path || null,
    backdrop_path: details.backdrop_path || null,
    vote_average: details.vote_average || 0,
    release_date: details.release_date || "",
    first_air_date: details.first_air_date || "",
  };

  const play = async (episodeItem = selectedEpisodeItem) => {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen is optional; native orientation locking still applies.
    }
    await lockPlayerLandscape();
    if (type === "movie") {
      navigate(`/watch/movie/${id}`);
      return;
    }
    const pair = episodeItem
      ? { season: episodeItem.playerSeason, episode: episodeItem.playerEpisode }
      : selectedPair ||
        (irisMeta
          ? mapIrisEpisodeToTmdb(selectedSeason, selectedEpisode || 1, irisMeta.seasonsMap, tmdbSeasons)
          : { season: selectedSeason, episode: selectedEpisode || 1 });
    const watchParams = new URLSearchParams({
      season: String(pair.season),
      episode: String(pair.episode),
    });
    if (animeDetails) {
      watchParams.set("uiSeason", String(selectedSeason));
      watchParams.set("uiEpisode", String(episodeItem?.episode_number || selectedEpisode || 1));
    }
    navigate(`/watch/tv/${id}?${watchParams.toString()}`);
  };

  const handleLibraryToggle = () => {
    setInMyList(toggleMyList(libraryItem));
  };

  const handleEpisodeClick = (episode) => {
    setSelectedEpisode(episode.episode_number);
    setSelectedPair({ season: episode.playerSeason, episode: episode.playerEpisode });
    play(episode);
  };

  return (
    <div className="min-h-screen w-full bg-[var(--gtv-bg)] text-white">
      <Topnav />

      <section className="relative min-h-[min(78svh,840px)] overflow-hidden bg-black">
        {trailerOpen && trailer?.key ? (
          <iframe
            title={`${title} trailer`}
            src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1`}
            className="absolute inset-0 h-full w-full scale-[1.02] border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          backdrop && (
            <img
              src={backdrop}
              alt=""
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          )
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/35 to-transparent" />

        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="absolute left-4 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-lg backdrop-blur transition hover:bg-white hover:text-black sm:left-8"
        >
          <i className="ri-arrow-left-line" />
        </button>

        {trailer?.key && (
          <button
            type="button"
            onClick={() => setTrailerOpen((open) => !open)}
            className="absolute right-4 top-5 z-20 inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-black/55 px-4 text-xs font-bold uppercase tracking-wider backdrop-blur transition hover:bg-white hover:text-black sm:right-8"
          >
            <i className={trailerOpen ? "ri-pause-line" : "ri-film-line"} />
            {trailerOpen ? "Stop trailer" : "Trailer"}
          </button>
        )}

        <div className="relative z-10 flex min-h-[min(78svh,840px)] items-end px-4 pb-10 pt-28 sm:px-8 md:px-12 lg:px-16 xl:px-20">
          <div className="max-w-3xl animate-slide-up-fade">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400">
              {mediaLabel}{year ? ` · ${year}` : ""}
            </p>
            {logoSrc ? (
              <img src={logoSrc} alt={title} className="max-h-24 w-auto max-w-[min(82vw,30rem)] object-contain object-left sm:max-h-32" />
            ) : (
              <h1 className="font-editorial text-4xl font-black leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-7xl">
                {title}
              </h1>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-bold text-zinc-300">
              {details.vote_average > 0 && (
                <span className="inline-flex items-center gap-1 text-white">
                  <i className="ri-star-fill" /> {details.vote_average.toFixed(1)}
                </span>
              )}
              {year && <span>{year}</span>}
              {runtime > 0 && <span>{runtime} min</span>}
              {type === "tv" && seasons.length > 0 && <span>{seasons.length} seasons</span>}
              {details.genres?.slice(0, 3).map((genre) => (
                <span key={genre.id} className="rounded-full border border-white/15 px-2.5 py-1 text-zinc-400">
                  {genre.name}
                </span>
              ))}
            </div>

            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-base">
              {details.overview || "No overview is available for this title yet."}
            </p>

            {animeDetails && scheduleState !== "none" && (
              <div className="mt-5 inline-flex max-w-full items-center gap-3 rounded-2xl border border-white/15 bg-black/45 px-3.5 py-2.5 backdrop-blur-md" aria-live="polite">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${scheduleState === "upcoming" ? "bg-white text-black" : "bg-white/10 text-zinc-400"}`}>
                  <i className={scheduleState === "loading" ? "ri-loader-4-line animate-spin" : scheduleState === "upcoming" ? "ri-calendar-schedule-line" : "ri-calendar-close-line"} />
                </span>
                <span className="min-w-0">
                  {scheduleState === "loading" && <span className="block text-xs font-bold text-zinc-200">Checking next episode…</span>}
                  {scheduleState === "upcoming" && (
                    <>
                      <span className="block text-xs font-black text-white">
                        Next episode{nextAiring?.episode ? ` · EP ${nextAiring.episode}` : ""} in <span className="tabular-nums">{formatCountdown(secondsUntilAir)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] font-semibold text-zinc-500">Airs {airingDate}</span>
                    </>
                  )}
                  {scheduleState === "ended" && <span className="block text-xs font-bold text-zinc-400">No upcoming episode scheduled</span>}
                  {scheduleState === "unavailable" && <span className="block text-xs font-bold text-zinc-500">Episode schedule is unavailable right now</span>}
                </span>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => play()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-black text-black transition hover:bg-zinc-200 active:scale-95"
              >
                <i className="ri-play-fill text-lg" />
                {type === "tv" && selectedEpisode ? `Play S${selectedSeason}:E${selectedEpisode}` : "Play"}
              </button>
              <button
                type="button"
                onClick={handleLibraryToggle}
                aria-pressed={inMyList}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-bold backdrop-blur transition ${inMyList ? "border-white bg-white text-black hover:bg-zinc-200" : "border-white/20 bg-white/10 text-white hover:bg-white/20"}`}
              >
                <i className={inMyList ? "ri-check-line" : "ri-add-line"} />
                {inMyList ? "In My List" : "Add to My List"}
              </button>
              {trailer?.key && (
                <button
                  type="button"
                  onClick={() => setTrailerOpen((open) => !open)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
                >
                  <i className="ri-film-line" /> Trailer
                </button>
              )}
            </div>

            {details.credits?.cast?.length > 0 && (
              <div className="mt-7">
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Cast</p>
                <div className="flex -space-x-2">
                  {details.credits.cast.slice(0, 8).map((person) => (
                    <div key={person.id} className="h-10 w-10 overflow-hidden rounded-full border-2 border-black bg-zinc-800" title={person.name}>
                      {person.profile_path ? (
                        <img src={castImage(person.profile_path)} alt={person.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[9px] font-black text-zinc-400">
                          {(person.name || "?").slice(0, 1)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {type === "tv" && (seasons.length > 0 || waitingForIris) && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-5 sm:px-8 md:px-12 lg:px-16 xl:px-20">
            <div>
              <p className="section-rule font-display text-lg font-bold text-white">Choose your episode</p>
              <p className="mt-2 text-xs text-zinc-500">
                {irisLoading
                  ? "Loading seasons from the anime service…"
                  : episodeSource === "iris"
                    ? "Season and episode data from the anime service"
                    : "Using the TMDB fallback for a title without anime metadata"}
              </p>
            </div>
            {episodes.length > 0 && (
              <span className="text-xs font-semibold text-zinc-500">
                {episodes.length} episodes · Season {selectedSeason}
              </span>
            )}
          </div>
          {waitingForIris ? (
            <div className="flex flex-col items-center justify-center gap-3 border-b border-white/5 py-20 text-zinc-500">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-[var(--gtv-accent)] border-zinc-800" />
              <span className="text-xs font-bold uppercase tracking-widest">Fetching seasons…</span>
            </div>
          ) : (
            <SeasonEpisodeBrowser
              seasons={seasons}
              selectedSeason={activeSeason?.season_number || selectedSeason}
              onSeasonSelect={(seasonNumber) => {
                setSelectedSeason(seasonNumber);
                setSelectedEpisode(null);
                setSelectedPair(null);
              }}
              posterFallback={img(details.poster_path, "w300")}
              episodes={episodes}
              episodesLoading={episodesLoading}
              selectedEpisode={selectedEpisode}
              startsPlayback
              onEpisodeClick={handleEpisodeClick}
              stillFallback={img(details.backdrop_path || details.poster_path, "w500")}
              emptyMessage="No episodes are available for this season yet."
              emptyAction={episodeSource === "iris" ? (
                <button
                  type="button"
                  onClick={() => setEpisodeRetry((attempt) => attempt + 1)}
                  className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-xs font-bold text-zinc-200 transition hover:border-white/30 hover:bg-white hover:text-black"
                >
                  <i className="ri-refresh-line" /> Retry episodes
                </button>
              ) : null}
              searchResetKey={selectedSeason}
            />
          )}
        </section>
      )}

      <Footer />
    </div>
  );
}
