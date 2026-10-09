import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Hero from "../components/partials/Hero.jsx";
import ForYou from "../components/partials/ForYou.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import Cards from "../components/partials/Cards.jsx";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import Footer from "../components/Footer.jsx";
import axios from "../lib/irisAxios.js";

const SectionHeader = ({ title, viewMorePath }) => (
  <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-12 pb-1 sm:px-8 md:px-12 lg:px-16 xl:px-20">
    <h2 className="font-editorial text-2xl font-bold leading-tight text-white sm:text-3xl">{title}</h2>
    {viewMorePath && (
      <Link to={viewMorePath} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-zinc-400 transition hover:text-white">
        View all <i className="ri-arrow-right-up-line text-sm" aria-hidden="true" />
      </Link>
    )}
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

const LazyMediaCarousel = ({ title, fetchFn, widescreen = false, viewMorePath }) => {
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
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: "350px" });
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

const MEDIA_CONFIG = {
  movie: {
    label: "Movies",
    tag: "MOVIE",
    type: "movie",
    heroUrls: ["/trending/movie/week", "/movie/now_playing", "/discover/movie?sort_by=popularity.desc&vote_count.gte=50&page=1"],
    topUrl: "/trending/movie/week",
    rows: [
      ["In Theatres & Latest Releases", "/movie/now_playing", true, "/movie"],
      ["Action & Blockbusters", "/discover/movie?with_genres=28&sort_by=popularity.desc&vote_count.gte=50&page=1", false, "/movie?genre=28"],
      ["Sci-Fi & Cyberpunk", "/discover/movie?with_genres=878&sort_by=popularity.desc&vote_count.gte=50&page=1", false, "/movie?genre=878"],
      ["Thriller & Mystery", "/discover/movie?with_genres=53,9648&sort_by=popularity.desc&vote_count.gte=50&page=1", false, "/movie?genre=53"],
      ["Horror & Supernatural", "/discover/movie?with_genres=27&sort_by=popularity.desc&vote_count.gte=30&page=1", false, "/movie?genre=27"],
      ["Comedy Hits", "/discover/movie?with_genres=35&sort_by=popularity.desc&vote_count.gte=30&page=1", false, "/movie?genre=35"],
      ["Indian Cinema", "/discover/movie?with_original_language=hi&sort_by=popularity.desc&vote_count.gte=20&page=1", false, "/movie?lang=hi"],
      ["All-Time Classics", "/movie/top_rated?page=1", false, "/movie?sort=top_rated"],
    ],
  },
  tv: {
    label: "Series",
    tag: "SERIES",
    type: "tv",
    heroUrls: ["/trending/tv/week", "/tv/on_the_air", "/discover/tv?sort_by=popularity.desc&vote_count.gte=50&page=1"],
    topUrl: "/trending/tv/week",
    rows: [
      ["Currently Airing & Hot Series", "/tv/on_the_air", true, "/tv"],
      ["Drama & Prestige Series", "/discover/tv?with_genres=18&sort_by=popularity.desc&vote_count.gte=50&page=1", false, "/tv?genre=18"],
      ["Korean Dramas & Asian TV", "/discover/tv?with_original_language=ko&sort_by=popularity.desc&vote_count.gte=20&page=1", false, "/tv?lang=ko"],
      ["Sci-Fi & Fantasy", "/discover/tv?with_genres=10765&sort_by=popularity.desc&vote_count.gte=30&page=1", false, "/tv?genre=10765"],
      ["Action & Adventure", "/discover/tv?with_genres=10759&sort_by=popularity.desc&vote_count.gte=30&page=1", false, "/tv?genre=10759"],
      ["Crime & Mystery", "/discover/tv?with_genres=80,9648&sort_by=popularity.desc&vote_count.gte=30&page=1", false, "/tv?genre=80"],
      ["Comedy & Sitcoms", "/discover/tv?with_genres=35&sort_by=popularity.desc&vote_count.gte=30&page=1", false, "/tv?genre=35"],
      ["All-Time Classics", "/tv/top_rated?page=1", false, "/tv?sort=top_rated"],
    ],
  },
};

const dedupe = (items, type) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item?.id || item.adult === true) return false;
    const key = `${item.media_type || type}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => ({ ...item, media_type: item.media_type || type }));
};

const fetchList = async (url, type) => {
  try {
    const { data } = await axios.get(url);
    return dedupe(data?.results || [], type);
  } catch {
    return [];
  }
};

const MediaHub = ({ mediaType = "movie" }) => {
  const config = MEDIA_CONFIG[mediaType] || MEDIA_CONFIG.movie;
  const [searchParams] = useSearchParams();
  const genre = searchParams.get("genre") || "";
  const language = searchParams.get("lang") || "";
  const sort = searchParams.get("sort") || "";
  const isFiltered = Boolean(genre || language || sort);
  const [category, setCategory] = useState(config.type === "movie" ? "now_playing" : "on_the_air");
  const [gridItems, setGridItems] = useState(null);
  const [heroPool, setHeroPool] = useState(null);
  const [top10, setTop10] = useState(null);
  const [error, setError] = useState(false);

  const loadHub = useCallback(async () => {
    setError(false);
    const heroResponses = await Promise.all(config.heroUrls.map((url) => fetchList(url, config.type)));
    const heroItems = dedupe(heroResponses.flat(), config.type).sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
    const topItems = await fetchList(config.topUrl, config.type);
    if (!heroItems.length) {
      setError(true);
      return;
    }
    setHeroPool(heroItems.slice(0, 6));
    setTop10((topItems.length ? topItems : heroItems).slice(0, 10).map((item, index) => ({ ...item, top10Rank: index + 1 })));
  }, [config]);

  const loadGrid = useCallback(async () => {
    if (!isFiltered) return;
    let url;
    if (sort === "top_rated") {
      url = `/${config.type}/top_rated?page=1`;
    } else if (genre || language) {
      const params = new URLSearchParams({ page: "1", sort_by: "popularity.desc" });
      if (genre) params.set("with_genres", genre);
      if (language) params.set("with_original_language", language);
      url = `/discover/${config.type}?${params.toString()}`;
    } else {
      url = `/${config.type}/${category}?page=1`;
    }
    setGridItems(await fetchList(url, config.type));
  }, [category, config, genre, isFiltered, language, sort]);

  useEffect(() => {
    document.title = `TheOGPirateBot | ${isFiltered ? `${genre ? "Featured" : language ? "Language" : "Top Rated"} ${config.label}` : config.label}`;
    if (isFiltered) return undefined;
    loadHub();
    return undefined;
  }, [config, genre, isFiltered, language, loadHub]);

  useEffect(() => {
    if (!isFiltered) return undefined;
    setGridItems(null);
    loadGrid();
    return undefined;
  }, [isFiltered, loadGrid]);

  const rowFetchers = useMemo(
    () => config.rows.map(([, url]) => () => fetchList(url, config.type)),
    [config],
  );

  if (isFiltered) {
    const pageTitle = genre ? `Featured ${config.label}` : language ? `${language.toUpperCase()} ${config.label}` : `Top Rated ${config.label}`;
    if (!gridItems) return <Loading />;
    return (
      <div className="flex min-h-screen w-full flex-col bg-[var(--gtv-bg)] pb-28 animate-fade-in select-none">
        <Topnav />
        <main className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-8 md:px-12 lg:px-16 xl:px-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div className="flex items-center gap-3">
              <Link to={config.type === "movie" ? "/movie" : "/tv"} aria-label={`Back to ${config.label}`} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/5 bg-white/5 text-xl text-zinc-400 transition hover:bg-white/10 hover:text-white">
                <i className="ri-arrow-left-line" />
              </Link>
              <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">{pageTitle}</h1>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
              <span className="hidden sm:inline">Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white outline-none">
                {(config.type === "movie" ? ["now_playing", "popular", "top_rated", "upcoming"] : ["on_the_air", "popular", "top_rated", "airing_today"]).map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
              </select>
            </label>
          </div>
          {gridItems.length ? <Cards data={gridItems} title={config.type} /> : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
              <i className="ri-filter-off-line text-3xl text-zinc-600" />
              <h2 className="font-display text-lg font-bold text-white">No titles found</h2>
              <p className="text-xs text-zinc-500">Try another genre, language or category.</p>
            </div>
          )}
        </main>
        <Footer />
      </div>
    );
  }

  if (!heroPool && !error) return <Loading />;
  if (error && !heroPool) return <FetchError onRetry={loadHub} />;

  return (
    <div className="gtv-browse flex min-h-screen w-full flex-col bg-[var(--gtv-bg)] pb-28 animate-fade-in select-none">
      <Topnav />
      <div className="w-full flex-1">
        <Hero data={heroPool} />
        {top10?.length > 0 && (
          <section className="flex min-h-[300px] flex-col gap-1">
            <SectionHeader title={`Top 10 ${config.label} This Week`} viewMorePath={config.type === "movie" ? "/movie" : "/tv"} />
            <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><HorizontalCards data={top10} top10 limit={10} /></div>
          </section>
        )}
        <ForYou />
        {config.rows.map(([title, , widescreen, viewMorePath], index) => (
          <LazyMediaCarousel
            key={title}
            title={title}
            fetchFn={rowFetchers[index]}
            widescreen={widescreen}
            viewMorePath={viewMorePath}
          />
        ))}
      </div>
      <Footer />
    </div>
  );
};

export default MediaHub;
