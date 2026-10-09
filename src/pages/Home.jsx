import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Hero from "../components/partials/Hero.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import TrendingSearches from "../components/partials/TrendingSearches.jsx";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import Footer from "../components/Footer.jsx";
import axios from "../lib/irisAxios.js";
import { readMyList } from "../utils/myList.js";
import { readContinueWatching } from "../utils/watchHistory.js";

// ─── Home ───────────────────────────────────────────────────────────────────
// Ported from Iris's components/Home.jsx, trimmed: no personalized
// recommendation engine or OTT provider-logo row. The local-first My List and
// Continue Watching rails are kept here and optionally synced by accountSync.
// What's left is the real visual language — rotating
// hero, lazy-loaded rows that fetch only once scrolled into view, Trending
// Searches poster grid — wired to TheOGPirateBot's own TMDB proxy via irisAxios.

const SectionHeader = ({ title, viewMorePath }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pt-12 pb-1 sm:px-8 md:px-12 lg:px-16 xl:px-20">
    <h2 className="font-editorial text-2xl font-bold leading-tight text-white sm:text-3xl">{title}</h2>
    {viewMorePath && (
      <Link to={viewMorePath} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-zinc-400 transition-colors hover:text-white">
        View all <i className="ri-arrow-right-up-line text-sm" aria-hidden="true" />
      </Link>
    )}
  </div>
);

const LocalRail = ({ title, data, viewMorePath }) => {
  if (!data.length) return null;
  return (
    <section>
      <SectionHeader title={title} viewMorePath={viewMorePath} />
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <HorizontalCards data={data} limit={14} />
      </div>
    </section>
  );
};

const LocalLibraryRails = () => {
  const [library, setLibrary] = useState(() => ({ myList: readMyList(), continueWatching: readContinueWatching() }));

  useEffect(() => {
    const refresh = () => setLibrary({ myList: readMyList(), continueWatching: readContinueWatching() });
    window.addEventListener("mylist-updated", refresh);
    window.addEventListener("history-updated", refresh);
    return () => {
      window.removeEventListener("mylist-updated", refresh);
      window.removeEventListener("history-updated", refresh);
    };
  }, []);

  return (
    <>
      <LocalRail title="Continue Watching" data={library.continueWatching} />
      <LocalRail title="My List" data={library.myList} viewMorePath="/account" />
    </>
  );
};

// Lazy-loaded carousel: fetches only once scrolled near, with a staggered
// queue so a fast scroll doesn't fire every row's request at once.
const homeFetchQueue = [];
let homeFetchActive = 0;
const HOME_FETCH_CONCURRENCY = 2;
const HOME_FETCH_STAGGER_MS = 400;

function processHomeQueue() {
  if (homeFetchActive >= HOME_FETCH_CONCURRENCY) return;
  const next = homeFetchQueue.shift();
  if (!next) return;
  homeFetchActive++;
  next().finally(() => {
    homeFetchActive--;
    setTimeout(processHomeQueue, HOME_FETCH_STAGGER_MS);
  });
}

function enqueueHomeFetch(fn) {
  return new Promise((resolve, reject) => {
    homeFetchQueue.push(async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
    processHomeQueue();
  });
}

const LazyCarousel = ({ title, fetchFn, widescreen = false, viewMorePath }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    if (!ref) return undefined;
    const load = async (attempt = 0) => {
      const started = Date.now();
      try {
        const res = await enqueueHomeFetch(fetchFn);
        setData(res || []);
        setLoading(false);
      } catch {
        if (attempt < 1 && Date.now() - started < 3000) {
          setTimeout(() => load(attempt + 1), 800);
          return;
        }
        setData([]);
        setLoading(false);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !data && !loading) {
          setLoading(true);
          load();
        }
      },
      { rootMargin: "500px" }
    );
    observer.observe(ref);
    return () => observer.disconnect();
  }, [ref, fetchFn, data, loading]);

  return (
    <div ref={setRef} className="flex flex-col gap-1 min-h-[220px] w-full gtv-lazy-section">
      <SectionHeader title={title} viewMorePath={viewMorePath} />
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        {data ? (
          <HorizontalCards data={data} widescreen={widescreen} limit={14} />
        ) : (
          <div className="w-full flex gap-4 overflow-hidden py-4 px-1 select-none pointer-events-none">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className={`shrink-0 rounded-2xl bg-zinc-900/60 animate-pulse border border-white/5 ${
                  widescreen
                    ? "aspect-video w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px]"
                    : "aspect-[2/3] w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const isValidList = (data) => Boolean(data && data.success !== false && Array.isArray(data.results));

const fetchResults = async (url) => {
  const { data } = await axios.get(url);
  if (!isValidList(data)) throw new Error(`TMDB returned an invalid list: ${url}`);
  return data.results.filter((r) => r && r.id && r.adult !== true);
};

const Home = () => {
  useEffect(() => {
    document.title = "TheOGPirateBot — Watch Movies & TV";
  }, []);

  const [heroItems, setHeroItems] = useState(null);
  const [error, setError] = useState(false);

  const loadHero = useCallback(() => {
    setError(false);
    setHeroItems(null);
    fetchResults("/trending/all/week")
      .then((items) => setHeroItems(items.filter((i) => i.backdrop_path).slice(0, 6)))
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    loadHero();
  }, [loadHero]);

  if (error) return <FetchError onRetry={loadHero} />;
  if (!heroItems) return <Loading />;

  return (
    <div className="w-full min-h-screen bg-[var(--gtv-bg)] flex flex-col select-none animate-fade-in">
      <Topnav />
      <Hero data={heroItems} />

      <LocalLibraryRails />
      <TrendingSearches data={heroItems} title="Trending Now" variant="rail" />

      <LazyCarousel title="Popular Movies" viewMorePath="/explore?type=movie" fetchFn={() => fetchResults("/movie/popular")} />
      <LazyCarousel title="Popular TV Shows" viewMorePath="/explore?type=tv" fetchFn={() => fetchResults("/tv/popular")} />
      <LazyCarousel title="Top Rated Movies" viewMorePath="/explore?type=movie&sort_by=vote_average.desc" fetchFn={() => fetchResults("/movie/top_rated")} />
      <LazyCarousel title="Top Rated TV Shows" viewMorePath="/explore?type=tv&sort_by=vote_average.desc" fetchFn={() => fetchResults("/tv/top_rated")} />
      <LazyCarousel title="Now Playing" widescreen viewMorePath="/explore?type=movie" fetchFn={() => fetchResults("/movie/now_playing")} />

      <Footer />
    </div>
  );
};

export default Home;
