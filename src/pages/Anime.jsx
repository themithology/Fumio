import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import AnimeHero from "../components/partials/AnimeHero.jsx";
import ForYou from "../components/partials/ForYou.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import Footer from "../components/Footer.jsx";
import axios from "../lib/irisAxios.js";
import { readContinueWatching } from "../utils/watchHistory.js";
import { readMyList } from "../utils/myList.js";
import { fetchAnimeTrending, resolveAnimeMatch } from "../utils/animeSchedule.js";

const SectionHeader = ({ title, viewMorePath, children }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pt-12 pb-1 sm:px-8 md:px-12 lg:px-16 xl:px-20">
    <h2 className="font-editorial text-2xl font-bold leading-tight text-white sm:text-3xl">{title}</h2>
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {viewMorePath && (
        <Link to={viewMorePath} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-zinc-400 transition-colors hover:text-white">
          View all <i className="ri-arrow-right-up-line text-sm" aria-hidden="true" />
        </Link>
      )}
    </div>
  </div>
);

const SkeletonRail = ({ widescreen = false }) => (
  <div className="flex w-full gap-4 overflow-hidden px-1 py-4">
    {[0, 1, 2, 3, 4, 5].map((index) => (
      <div
        key={index}
        className={`shrink-0 animate-pulse rounded-2xl border border-white/5 bg-zinc-900/60 ${
          widescreen
            ? "aspect-video w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px]"
            : "aspect-[2/3] w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]"
        }`}
      />
    ))}
  </div>
);

const LazyAnimeCarousel = ({ title, fetchFn, widescreen = false, viewMorePath }) => {
  const [items, setItems] = useState(null);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    if (!ref || items !== null) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchFn();
        if (!cancelled) setItems(result || []);
      } catch {
        if (!cancelled) setItems([]);
      }
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "350px" },
    );
    observer.observe(ref);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [fetchFn, items, ref]);

  return (
    <section ref={setRef} className="flex min-h-[220px] w-full flex-col gap-1">
      <SectionHeader title={title} viewMorePath={viewMorePath} />
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        {items === null ? <SkeletonRail widescreen={widescreen} /> : <HorizontalCards data={items} widescreen={widescreen} limit={15} />}
      </div>
    </section>
  );
};

const isAnime = (item) => {
  if (!item?.id || item.adult === true) return false;
  const genres = item.genre_ids || [];
  const japanese = item.original_language === "ja" || (item.origin_country || []).includes("JP");
  return (genres.includes(16) && japanese) || (genres.length === 0 && japanese);
};

const dedupe = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item?.id) return false;
    const key = `${item.media_type || (item.title ? "movie" : "tv")}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchResults = async (url, type) => {
  try {
    const { data } = await axios.get(url);
    return (data?.results || []).filter((item) => item?.id && item.adult !== true).map((item) => ({
      ...item,
      media_type: item.media_type || type,
    }));
  } catch {
    return [];
  }
};

const localAnimeSeeds = () => {
  const local = [...readContinueWatching(), ...readMyList()];
  return dedupe(local
    .filter((item) => item?.id && ["tv", "movie"].includes(item.type || item.media_type))
    .filter((item) => isAnime(item) || item.original_language === "ja")
    .map((item) => ({ ...item, media_type: item.media_type || item.type })));
};

const Anime = () => {
  const [heroPool, setHeroPool] = useState(null);
  const [top10Anime, setTop10Anime] = useState(null);
  const [qualityOnly, setQualityOnly] = useState(() => {
    try {
      return localStorage.getItem("animeQualityOnly") !== "0";
    } catch {
      return true;
    }
  });
  const [error, setError] = useState(false);

  const loadHub = useCallback(async () => {
    setError(false);
    const [trendingTv, discoverTv, discoverMovies, aniListTrending] = await Promise.all([
      fetchResults("/trending/tv/week", "tv"),
      fetchResults("/discover/tv?with_original_language=ja&with_genres=16&sort_by=popularity.desc&vote_count.gte=20&page=1", "tv"),
      fetchResults("/discover/movie?with_original_language=ja&with_genres=16&sort_by=popularity.desc&vote_count.gte=10&page=1", "movie"),
      fetchAnimeTrending().catch(() => []),
    ]);
    const resolvedTrending = (await Promise.all(aniListTrending.slice(0, 16).map(resolveAnimeMatch))).filter(Boolean);
    const fallbackPool = dedupe([...resolvedTrending, ...trendingTv, ...discoverTv, ...discoverMovies].filter(isAnime))
      .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
    const localSeeds = localAnimeSeeds();
    const hero = dedupe([...localSeeds, ...resolvedTrending, ...fallbackPool]).slice(0, 6);
    const ranked = dedupe([...resolvedTrending, ...trendingTv.filter(isAnime), ...discoverTv.filter(isAnime), ...discoverMovies.filter(isAnime)])
      .slice(0, 12)
      .map((item, index) => ({ ...item, top10Rank: index + 1 }));

    if (!hero.length) {
      setError(true);
      return;
    }
    setHeroPool(hero);
    setTop10Anime(ranked.length ? ranked : hero.map((item, index) => ({ ...item, top10Rank: index + 1 })));
  }, []);

  useEffect(() => {
    document.title = "TheOGPirateBot | Anime";
    loadHub();
  }, [loadHub]);

  useEffect(() => {
    try {
      localStorage.setItem("animeQualityOnly", qualityOnly ? "1" : "0");
    } catch {
      // Preferences are optional.
    }
  }, [qualityOnly]);

  const fetchAnimeMovies = useCallback(async () => (
    dedupe((await fetchResults("/discover/movie?with_original_language=ja&with_genres=16&sort_by=vote_count.desc&vote_count.gte=50&page=1", "movie")).filter(isAnime)).slice(0, 15)
  ), []);
  const fetchShonen = useCallback(async () => (
    dedupe([
      ...(await fetchResults("/discover/tv?with_original_language=ja&with_genres=16,28&sort_by=popularity.desc&vote_count.gte=20&page=1", "tv")),
      ...(await fetchResults("/discover/movie?with_original_language=ja&with_genres=16,28&sort_by=popularity.desc&vote_count.gte=10&page=1", "movie")),
    ].filter(isAnime)).slice(0, 15)
  ), []);
  const fetchIsekai = useCallback(async () => (
    dedupe((await fetchResults("/discover/tv?with_original_language=ja&with_genres=16&with_keywords=237451|293198&sort_by=popularity.desc&page=1", "tv")).filter(isAnime)).slice(0, 15)
  ), []);
  const fetchDarkFantasy = useCallback(async () => (
    dedupe((await fetchResults("/discover/tv?with_original_language=ja&with_genres=16,80&sort_by=popularity.desc&page=1", "tv")).filter(isAnime)).slice(0, 15)
  ), []);
  const fetchRomance = useCallback(async () => (
    dedupe((await fetchResults("/discover/tv?with_original_language=ja&with_genres=16,10749&sort_by=popularity.desc&page=1", "tv")).filter(isAnime)).slice(0, 15)
  ), []);
  const fetchSciFi = useCallback(async () => (
    dedupe([
      ...(await fetchResults("/discover/tv?with_original_language=ja&with_genres=16,878&sort_by=popularity.desc&page=1", "tv")),
      ...(await fetchResults("/discover/movie?with_original_language=ja&with_genres=16,878&sort_by=popularity.desc&page=1", "movie")),
    ].filter(isAnime)).slice(0, 15)
  ), []);
  const fetchClassics = useCallback(async () => (
    dedupe([
      ...(await fetchResults("/discover/tv?with_original_language=ja&with_genres=16&sort_by=vote_average.desc&vote_count.gte=300&page=1", "tv")),
      ...(await fetchResults("/discover/movie?with_original_language=ja&with_genres=16&sort_by=vote_average.desc&vote_count.gte=100&page=1", "movie")),
    ].filter(isAnime)).sort((a, b) => Number(b.vote_average || 0) - Number(a.vote_average || 0)).slice(0, 15)
  ), []);

  if (!heroPool && !error) return <Loading />;
  if (error && !heroPool) return <FetchError onRetry={loadHub} />;

  const qualityRow = (top10Anime || []).filter((item) => Number(item.vote_average || 0) >= 6.5);
  const topRow = qualityOnly && qualityRow.length ? qualityRow.slice(0, 10) : (top10Anime || []).slice(0, 10);

  return (
    <div className="gtv-browse flex min-h-screen w-full flex-col bg-[var(--gtv-bg)] pb-28 animate-fade-in select-none">
      <Topnav />
      <div className="w-full flex-1">
        <AnimeHero data={heroPool} />

        {topRow.length > 0 && (
          <section className="flex min-h-[300px] flex-col gap-1">
            <SectionHeader title="Top 10 Anime This Week" viewMorePath="/explore?type=tv&genre=16&lang=ja">
              <button
                type="button"
                onClick={() => setQualityOnly((value) => !value)}
                aria-pressed={qualityOnly}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition active:scale-95 ${qualityOnly ? "border-amber-400/40 bg-amber-500/15 text-amber-300" : "border-white/5 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
              >
                <i className={qualityOnly ? "ri-star-fill text-amber-400" : "ri-star-line"} /> Quality <span className="opacity-70">★6.5+</span>
              </button>
            </SectionHeader>
            <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><HorizontalCards data={topRow} top10 limit={10} /></div>
          </section>
        )}

        <ForYou />
        <LazyAnimeCarousel title="Anime Movies" fetchFn={fetchAnimeMovies} widescreen viewMorePath="/explore?type=movie&genre=16&lang=ja" />
        <LazyAnimeCarousel title="Shōnen & Action" fetchFn={fetchShonen} viewMorePath="/explore?type=tv&genre=16&lang=ja" />
        <LazyAnimeCarousel title="Isekai & Fantasy" fetchFn={fetchIsekai} viewMorePath="/explore?type=tv&genre=16&lang=ja" />
        <LazyAnimeCarousel title="Dark Fantasy & Seinen" fetchFn={fetchDarkFantasy} viewMorePath="/explore?type=tv&genre=16&lang=ja" />
        <LazyAnimeCarousel title="Romance & Slice of Life" fetchFn={fetchRomance} viewMorePath="/explore?type=tv&genre=16&lang=ja" />
        <LazyAnimeCarousel title="Sci-Fi & Cyberpunk" fetchFn={fetchSciFi} viewMorePath="/explore?type=tv&genre=16&lang=ja" />
        <LazyAnimeCarousel title="All-Time Classics" fetchFn={fetchClassics} viewMorePath="/explore?type=tv&genre=16&lang=ja" />
      </div>
      <Footer />
    </div>
  );
};

export default Anime;
