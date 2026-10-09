import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { tmdbGet, img } from "../lib/tmdb.js";
import {
  fetchIrisEpisodes,
  fetchIrisSeasonData,
  mapIrisEpisodeToTmdb,
} from "../lib/irisEpisodes.js";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import Topnav from "../components/partials/Topnav.jsx";

export default function Details() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const [details, setDetails] = useState(null);
  const [err, setErr] = useState(null);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [irisMeta, setIrisMeta] = useState(null);
  const [irisEpisodes, setIrisEpisodes] = useState(null);
  const [irisLoading, setIrisLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setErr(null);
    setIrisMeta(null);
    setIrisEpisodes(null);
    setIrisLoading(false);
    setSeason(1);
    setEpisode(1);

    tmdbGet(`${type}/${id}`)
      .then((data) => {
        if (cancelled) return;
        setDetails(data);
        const firstRealSeason = (data.seasons || []).find((s) => s.season_number > 0);
        if (firstRealSeason) setSeason(firstRealSeason.season_number);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [type, id]);

  // Iris owns the anime season/episode catalog. It returns null for ordinary
  // television, so the TheOGPirateBot/TMDB season list remains a safe fallback rather
  // than blocking every TV details page on a second provider.
  useEffect(() => {
    if (!details || type !== "tv") return undefined;
    let cancelled = false;
    const tmdbEpisodes = (details.seasons || [])
      .filter((item) => item.season_number > 0 && item.episode_count > 0)
      .reduce((total, item) => total + item.episode_count, 0);
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
        if (metadata?.seasons?.length) {
          setSeason((current) =>
            metadata.seasons.some((item) => item.season_number === current)
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
  }, [details, type]);

  const tmdbSeasons = useMemo(
    () => (details?.seasons || []).filter((item) => item.season_number > 0),
    [details],
  );
  const seasons = irisMeta?.seasons?.length ? irisMeta.seasons : tmdbSeasons;
  const activeSeason = seasons.find((item) => item.season_number === season) || seasons[0] || null;
  const episodeItems = irisEpisodes?.episodes || [];
  const episodeCount =
    episodeItems.length || irisEpisodes?.count || activeSeason?.episode_count || 1;

  // Load the selected Iris season's real episode titles and thumbnails. The
  // selector still paints immediately from the season count, then upgrades to
  // Iris's numbered list when the response arrives.
  useEffect(() => {
    setIrisEpisodes(null);
    const anilistId = activeSeason?.anilist_id;
    if (!irisMeta || !anilistId) return undefined;
    let cancelled = false;
    fetchIrisEpisodes(anilistId).then((episodes) => {
      if (!cancelled) setIrisEpisodes(episodes);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSeason?.anilist_id, irisMeta]);

  useEffect(() => {
    setEpisode((current) => Math.min(Math.max(current, 1), episodeCount));
  }, [episodeCount]);

  useEffect(() => {
    const title = details?.title || details?.name;
    document.title = title ? `${title} | TheOGPirateBot` : "TheOGPirateBot — Movies & TV";
  }, [details]);

  if (err)
    return (
      <div className="min-h-screen bg-[var(--gtv-bg)]">
        <Topnav />
        <FetchError onRetry={() => navigate(0)} message={`Couldn't load this title: ${err}`} />
      </div>
    );
  if (!details) return <Loading />;

  const title = details.title || details.name;
  const year = (details.release_date || details.first_air_date || "").slice(0, 4);

  // Fullscreen requires a real user gesture — this click handler IS one, so
  // the request fires here, synchronously, before navigating. Doing it on
  // the Player page's own mount (after an async route transition) is too
  // late and most browsers silently refuse it.
  const play = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    const pair =
      type === "tv" && irisMeta
        ? mapIrisEpisodeToTmdb(season, episode, irisMeta.seasonsMap, tmdbSeasons)
        : { season, episode };
    const qs = type === "tv" ? `?season=${pair.season}&episode=${pair.episode}` : "";
    navigate(`/watch/${type}/${id}${qs}`);
  };

  const episodeOptions = episodeItems.length
    ? episodeItems
    : Array.from({ length: episodeCount }, (_, index) => ({ number: index + 1, title: "" }));

  return (
    <div className="relative min-h-screen bg-[var(--gtv-bg)] pb-24">
      <Topnav />
      {details.backdrop_path && (
        <div className="absolute inset-x-0 top-0 h-[50vh] overflow-hidden">
          <img src={img(details.backdrop_path, "w1280")} alt="" className="h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--gtv-bg)] via-[var(--gtv-bg)]/70 to-transparent" />
        </div>
      )}
      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 pt-6 pb-10 sm:flex-row sm:px-8">
        <div className="w-40 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 shadow-2xl sm:w-56">
          {details.poster_path ? (
            <img src={img(details.poster_path, "w500")} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="aspect-[2/3] bg-zinc-900" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <h1 className="font-editorial text-2xl font-bold text-white sm:text-4xl">
            {title} {year && <span className="font-normal text-zinc-500">({year})</span>}
          </h1>
          {details.genres?.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gtv-accent)]">
              {details.genres.map((genre) => genre.name).join(" • ")}
            </p>
          )}
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">{details.overview}</p>

          {type === "tv" && seasons.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-zinc-500">Season</span>
                <select
                  value={activeSeason?.season_number || season}
                  onChange={(event) => {
                    setSeason(Number(event.target.value));
                    setEpisode(1);
                  }}
                  className="max-w-[15rem] rounded-lg border border-white/10 bg-[var(--gtv-surface-2)] px-3 py-1.5 text-white outline-none focus:border-[var(--gtv-accent)]"
                >
                  {seasons.map((item) => (
                    <option key={item.season_number} value={item.season_number}>
                      {item.name || `Season ${item.season_number}`} · {item.episode_count || "?"} eps
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-zinc-500">Episode</span>
                <select
                  value={Math.min(episode, episodeCount)}
                  onChange={(event) => setEpisode(Number(event.target.value))}
                  className="max-w-[18rem] rounded-lg border border-white/10 bg-[var(--gtv-surface-2)] px-3 py-1.5 text-white outline-none focus:border-[var(--gtv-accent)]"
                >
                  {episodeOptions.map((item) => (
                    <option key={item.number} value={item.number}>
                      Episode {item.number}{item.title ? ` — ${item.title}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {irisLoading && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <i className="ri-loader-4-line animate-spin" aria-hidden="true" /> Syncing Iris data
                </span>
              )}
              {irisMeta && !irisLoading && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <i className="ri-check-line text-zinc-300" aria-hidden="true" /> Iris episodes
                </span>
              )}
            </div>
          )}

          <button
            onClick={play}
            className="mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-zinc-200 active:scale-95"
          >
            <i className="ri-play-fill text-lg" /> Play
          </button>
        </div>
      </div>
    </div>
  );
}
