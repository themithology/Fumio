import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Hero from "../components/partials/Hero.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import TrendingSearches from "../components/partials/TrendingSearches.jsx";
import RecommendationsRow from "../components/partials/RecommendationsRow.jsx";
import ForYou from "../components/partials/ForYou.jsx";
import ScrollRow from "../components/partials/ScrollRow.jsx";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import Footer from "../components/Footer.jsx";
import axios from "../lib/irisAxios.js";
import { readMyList, removeFromMyList } from "../utils/myList.js";
import { readContinueWatching, removeContinueWatching, writeContinueWatching } from "../utils/watchHistory.js";

const SectionHeader = ({ title, viewMorePath, children }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pb-1 pt-12 sm:px-8 md:px-12 lg:px-16 xl:px-20">
    <h2 className="font-editorial text-2xl font-bold leading-tight text-white sm:text-3xl">{title}</h2>
    <div className="flex flex-wrap items-center gap-2">
      {viewMorePath && <Link to={viewMorePath} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-zinc-400 transition-colors hover:text-white">View all <i className="ri-arrow-right-up-line text-sm" aria-hidden="true" /></Link>}
      {children}
    </div>
  </div>
);

// Keep the same queue Iris uses so the expanded Home does not fire every rail
// at once when a visitor scrolls quickly.
const homeFetchQueue = [];
let homeFetchActive = 0;
const HOME_FETCH_CONCURRENCY = 2;
const HOME_FETCH_STAGGER_MS = 500;

function processHomeQueue() {
  if (homeFetchActive >= HOME_FETCH_CONCURRENCY) return;
  const next = homeFetchQueue.shift();
  if (!next) return;
  homeFetchActive += 1;
  next().finally(() => {
    homeFetchActive -= 1;
    setTimeout(processHomeQueue, HOME_FETCH_STAGGER_MS);
  });
}

function enqueueHomeFetch(fn) {
  return new Promise((resolve, reject) => {
    homeFetchQueue.push(async () => {
      try {
        resolve(await fn());
      } catch (error) {
        reject(error);
      }
    });
    processHomeQueue();
  });
}

const LazyCarousel = ({ title, fetchFn, widescreen = false, top10 = false, viewMorePath, limit = 12 }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    if (!ref) return undefined;
    const load = async (attempt = 0) => {
      const started = Date.now();
      try {
        setData(await enqueueHomeFetch(fetchFn) || []);
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
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !data && !loading) {
        setLoading(true);
        load();
      }
    }, { rootMargin: "500px" });
    observer.observe(ref);
    return () => observer.disconnect();
  }, [data, fetchFn, loading, ref]);

  return (
    <section ref={setRef} className="gtv-lazy-section flex min-h-[220px] w-full flex-col gap-1">
      <SectionHeader title={title} viewMorePath={viewMorePath} />
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        {data ? <HorizontalCards data={data} widescreen={widescreen} top10={top10} limit={limit} /> : (
          <div className="flex w-full select-none gap-4 overflow-hidden px-1 py-4">
            {[...Array(6)].map((_, index) => <div key={index} className={`animate-pulse shrink-0 rounded-2xl border border-white/5 bg-zinc-900/60 ${widescreen ? "aspect-video w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px]" : "aspect-[2/3] w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]"}`} />)}
          </div>
        )}
      </div>
    </section>
  );
};

const readLocalJSON = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const isValidList = (data) => Boolean(data && data.success !== false && Array.isArray(data.results));

const fetchResults = async (url) => {
  const { data } = await axios.get(url);
  if (!isValidList(data)) throw new Error(`TMDB returned an invalid list: ${url}`);
  return data.results;
};

const dedupeItems = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item?.id) return false;
    const key = `${item.media_type || (item.title ? "movie" : "tv")}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchHalf = async (type, primaryUrl, fallbackUrls, filter) => {
  let results = [];
  try {
    results = await fetchResults(primaryUrl);
  } catch {
    results = [];
  }
  if (!results.length && fallbackUrls) {
    for (const url of [].concat(fallbackUrls)) {
      try {
        results = await fetchResults(url);
      } catch {
        results = [];
      }
      if (results.length) break;
    }
  }
  return dedupeItems(results.filter((item) => item && item.id && item.adult !== true && (!filter || filter(item))).map((item) => ({ ...item, media_type: item.media_type || type })));
};

const buildPersonalizedHero = async () => {
  const watched = readLocalJSON("continueWatching")
    .filter((item) => item?.id && ["movie", "tv"].includes(item.type))
    .sort((a, b) => Number(b.lastUpdated || 0) - Number(a.lastUpdated || 0));
  const watchedKeys = new Set(watched.map((item) => `${item.type}-${item.id}`));
  const seeds = watched.slice(0, 4).map((item, index) => ({ id: item.id, type: item.type, weight: 3 * (1 - index * 0.2) }));
  readMyList().filter((item) => item?.id && ["movie", "tv"].includes(item.type)).slice(0, 3).forEach((item, index) => {
    seeds.push({ id: item.id, type: item.type, weight: 2 * (1 - index * 0.2) });
  });

  for (const query of readLocalJSON("recentSearches").filter((item) => typeof item === "string" && item.trim()).slice(0, 3)) {
    if (seeds.length >= 7) break;
    try {
      const { data } = await axios.get(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`);
      const hit = (isValidList(data) ? data.results : []).find((item) => item?.id && ["movie", "tv"].includes(item.media_type));
      if (hit && !watchedKeys.has(`${hit.media_type}-${hit.id}`)) seeds.push({ id: hit.id, type: hit.media_type, weight: 1.5 });
    } catch {
      // Personalization is optional.
    }
  }
  if (!seeds.length) return { items: [], watchedKeys };

  const recommendationLists = [];
  for (const seed of seeds) {
    try {
      const { data } = await axios.get(`/${seed.type}/${seed.id}/recommendations`);
      let list = isValidList(data) ? data.results : [];
      if (!list.length) {
        const similar = await axios.get(`/${seed.type}/${seed.id}/similar`).catch(() => null);
        list = similar && isValidList(similar.data) ? similar.data.results : [];
      }
      recommendationLists.push(list.filter((item) => item?.id).slice(0, 15).map((item) => ({ ...item, media_type: seed.type })));
    } catch {
      recommendationLists.push([]);
    }
  }

  const scored = new Map();
  recommendationLists.forEach((list, seedIndex) => {
    list.forEach((item, itemIndex) => {
      const key = `${item.media_type}-${item.id}`;
      const previous = scored.get(key) || { item, score: 0 };
      previous.score += seeds[seedIndex].weight * Math.max(1 - itemIndex * 0.05, 0.4) + Math.min(Number(item.popularity || 0) / 200, 0.5);
      scored.set(key, previous);
    });
  });
  const items = [...scored.values()].sort((a, b) => b.score - a.score).map(({ item }) => item).filter((item) => !watchedKeys.has(`${item.media_type}-${item.id}`)).slice(0, 20);
  return { items, watchedKeys };
};

const QUICK_DISCOVERY_LINKS = [
  { label: "Top Rated", path: "/explore?sort_by=vote_average.desc" },
  { label: "Action", path: "/explore?genre=28" },
  { label: "Sci-Fi", path: "/explore?genre=878" },
  { label: "K-Drama", path: "/explore?lang=ko" },
  { label: "Indian Cinema", path: "/explore?lang=hi" },
];

const OTT_PLATFORMS = [
  [8, "Netflix", "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg", "US"],
  [9, "Prime Video", "/pvske1MyAoymrs5bguRfVqYiM9a.jpg", "US"],
  [337, "Disney+", "/97yvRBw1GzX7fXprcF80er19ot.jpg", "US"],
  [2336, "Hotstar", "/kVqjgpcwvDJOhCupjcLzwwtOp52.jpg", "IN"],
  [283, "Crunchyroll", "/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg", "US"],
  [350, "Apple TV", "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg", "US"],
  [232, "Zee5", "/gP67NRy1ShUJilrzMsbOmEmdmcv.jpg", "IN"],
  [237, "SonyLIV", "/3973zlBbBXdXxaWqRWzGG2GYxbT.jpg", "IN"],
  [344, "Viki", "/73uV3YooOA8gD9YQTXFj2XakZWA.jpg", "US"],
];

export default function Home() {
  const [trending, setTrending] = useState(null);
  const [trendingError, setTrendingError] = useState(false);
  const [topRated, setTopRated] = useState(null);
  const [heroCandidates, setHeroCandidates] = useState(null);
  const [heroData, setHeroData] = useState(null);
  const [continueWatching, setContinueWatching] = useState(() => readContinueWatching());
  const [clearedHistory, setClearedHistory] = useState(null);
  const [myList, setMyList] = useState(() => readMyList());
  const HERO_TARGET = 7;

  const fetchTopRated = useCallback(async () => {
    const [movies, tv] = await Promise.all([
      fetchHalf("movie", "/movie/top_rated?include_adult=false&page=1"),
      fetchHalf("tv", "/tv/top_rated?include_adult=false&page=1"),
    ]);
    return dedupeItems([...movies, ...tv]).filter((item) => Number(item.vote_count || 0) >= 100).sort((a, b) => Number(b.vote_average || 0) - Number(a.vote_average || 0)).slice(0, 20);
  }, []);

  const getHomeData = useCallback(async () => {
    setTrendingError(false);
    let trendingRows = null;
    try {
      const { data } = await axios.get("/trending/all/week?include_adult=false");
      if (!isValidList(data)) throw new Error("invalid trending list");
      trendingRows = data.results;
    } catch {
      try {
        const [movies, tv] = await Promise.all([axios.get("/movie/popular?include_adult=false&page=1"), axios.get("/tv/popular?include_adult=false&page=1")]);
        const movieRows = isValidList(movies.data) ? movies.data.results.map((item) => ({ ...item, media_type: "movie" })) : [];
        const tvRows = isValidList(tv.data) ? tv.data.results.map((item) => ({ ...item, media_type: "tv" })) : [];
        trendingRows = dedupeItems([...movieRows, ...tvRows]).sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, 20);
      } catch {
        trendingRows = [];
      }
    }

    let ratedPool = [];
    try {
      ratedPool = await fetchTopRated();
    } catch {
      ratedPool = [];
    }
    if (!ratedPool.length) ratedPool = (trendingRows || []).slice(0, 20);
    if (!trendingRows?.length) trendingRows = ratedPool;
    if (!ratedPool.length && !trendingRows.length) {
      setTrendingError(true);
      return;
    }
    setTrending(trendingRows);
    setTopRated(ratedPool);
  }, [fetchTopRated]);

  useEffect(() => {
    getHomeData();
    buildPersonalizedHero().then((result) => setHeroCandidates(result || { items: [], watchedKeys: new Set() })).catch(() => setHeroCandidates({ items: [], watchedKeys: new Set() }));
  }, [getHomeData]);

  useEffect(() => {
    if (!heroCandidates || !Array.isArray(topRated)) return;
    const seen = new Set(heroCandidates.items.map((item) => `${item.media_type}-${item.id}`));
    const pool = [...heroCandidates.items];
    for (const item of topRated) {
      if (pool.length >= HERO_TARGET) break;
      const key = `${item.media_type || (item.title ? "movie" : "tv")}-${item.id}`;
      if (seen.has(key) || heroCandidates.watchedKeys.has(key)) continue;
      pool.push({ ...item, media_type: item.media_type || (item.title ? "movie" : "tv") });
    }
    setHeroData(pool.slice(0, HERO_TARGET));
  }, [heroCandidates, topRated]);

  useEffect(() => {
    const reload = () => {
      setContinueWatching(readContinueWatching());
      setMyList(readMyList());
    };
    reload();
    window.addEventListener("storage", reload);
    window.addEventListener("history-updated", reload);
    window.addEventListener("mylist-updated", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("history-updated", reload);
      window.removeEventListener("mylist-updated", reload);
    };
  }, []);

  const fetchAnime = useCallback(async () => {
    const [movies, tv] = await Promise.all([
      fetchHalf("movie", "/discover/movie?with_original_language=ja&with_genres=16&sort_by=popularity.desc&vote_count.gte=500&include_adult=false&page=1", "/discover/movie?with_original_language=ja&with_genres=16&sort_by=popularity.desc&include_adult=false&page=1", (item) => Number(item.vote_count || 0) >= 100),
      fetchHalf("tv", "/discover/tv?with_original_language=ja&with_genres=16&sort_by=popularity.desc&vote_count.gte=500&include_adult=false&page=1", "/discover/tv?with_original_language=ja&with_genres=16&sort_by=popularity.desc&include_adult=false&page=1", (item) => Number(item.vote_count || 0) >= 100),
    ]);
    return dedupeItems([...movies, ...tv]).sort((a, b) => Number(b.vote_count || 0) - Number(a.vote_count || 0)).slice(0, 20);
  }, []);

  const fetchKdrama = useCallback(async () => {
    const filter = (item) => item.original_language === "ko" && (item.genre_ids || []).includes(18) && Number(item.vote_count || 0) >= 50;
    const [movies, tv] = await Promise.all([
      fetchHalf("movie", "/discover/movie?with_original_language=ko&with_genres=18&sort_by=popularity.desc&vote_count.gte=50&include_adult=false&page=1", "/discover/movie?with_original_language=ko&with_genres=18&sort_by=popularity.desc&include_adult=false&page=1", filter),
      fetchHalf("tv", "/discover/tv?with_original_language=ko&with_genres=18&sort_by=popularity.desc&vote_count.gte=50&include_adult=false&page=1", "/discover/tv?with_original_language=ko&with_genres=18&sort_by=popularity.desc&include_adult=false&page=1", filter),
    ]);
    return dedupeItems([...movies, ...tv]).sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, 12);
  }, []);

  const fetchIndian = useCallback(async () => {
    const filter = (item) => item.original_language === "hi" && Number(item.vote_count || 0) >= 50;
    const [movies, tv] = await Promise.all([
      fetchHalf("movie", "/discover/movie?with_original_language=hi&sort_by=popularity.desc&vote_count.gte=50&include_adult=false&page=1", "/discover/movie?with_original_language=hi&sort_by=popularity.desc&include_adult=false&page=1", filter),
      fetchHalf("tv", "/discover/tv?with_original_language=hi&sort_by=popularity.desc&vote_count.gte=50&include_adult=false&page=1", "/discover/tv?with_original_language=hi&sort_by=popularity.desc&include_adult=false&page=1", filter),
    ]);
    return dedupeItems([...movies, ...tv]).sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, 12);
  }, []);

  const fetchMix = useCallback(async (genreIds, minVotes = 200) => {
    const filter = (item) => (item.genre_ids || []).some((genre) => genreIds.includes(genre)) && Number(item.vote_count || 0) >= minVotes;
    const [movies, tv] = await Promise.all([
      fetchHalf("movie", `/discover/movie?with_genres=${genreIds.join(",")}&sort_by=popularity.desc&vote_count.gte=${minVotes}&include_adult=false&page=1`, "/discover/movie?sort_by=popularity.desc&include_adult=false&page=1", filter),
      fetchHalf("tv", `/discover/tv?with_genres=${genreIds.join(",")}&sort_by=popularity.desc&vote_count.gte=${minVotes}&include_adult=false&page=1`, ["/discover/tv?sort_by=popularity.desc&include_adult=false&page=1", "/tv/popular?include_adult=false&page=1"], filter),
    ]);
    return dedupeItems([...movies, ...tv]).sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, 12);
  }, []);

  const removeFromContinue = (item) => removeContinueWatching(item);
  const continueWithResume = continueWatching.map((item) => ({ ...item, resumePath: undefined }));
  const keyOf = (item) => `${item.media_type || item.type || (item.title ? "movie" : "tv")}-${item.id}`;
  const heroKeys = new Set((heroData || []).map(keyOf));
  const ratedKeys = new Set((topRated || []).map(keyOf));

  if (trendingError && !trending) return <FetchError onRetry={getHomeData} />;
  if (!trending || !topRated || !heroData) return <Loading />;

  return (
    <div className="gtv-browse flex min-h-screen w-full select-none flex-col bg-[var(--gtv-bg)] pb-28 animate-fade-in sm:pb-24">
      <Topnav />
      <Hero data={heroData} />
      <RecommendationsRow />

      <nav aria-label="Discover by mood" className="mx-4 mt-3 flex items-center gap-5 border-b border-white/10 sm:mx-8 md:mx-12 lg:mx-16 xl:mx-20">
        <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:block">Discover</span>
        <ScrollRow label="discover by mood" className="gtv-no-scrollbar flex min-w-0 flex-1 items-center gap-6 overflow-x-auto py-2 sm:gap-8">
          {QUICK_DISCOVERY_LINKS.map((item) => <Link key={item.label} to={item.path} className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap text-sm font-semibold text-zinc-400 transition-colors hover:text-white">{item.label}</Link>)}
        </ScrollRow>
      </nav>

      {clearedHistory && <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900 p-3 text-xs text-zinc-300 sm:mx-8 md:mx-12 lg:mx-16 xl:mx-20"><span>Continue Watching cleared.</span><button type="button" onClick={() => { writeContinueWatching(clearedHistory); setClearedHistory(null); }} className="min-h-11 rounded-full bg-white px-5 font-bold text-black">Undo</button></div>}

      {continueWatching.length > 0 && (
        <section className="flex min-h-[150px] flex-col gap-1">
          <SectionHeader title="Continue Watching">
            <button type="button" onClick={() => { setClearedHistory(continueWatching); writeContinueWatching([]); }} className="flex min-h-10 items-center gap-1.5 rounded-full border border-white/5 bg-white/5 px-3.5 text-[10px] font-semibold text-zinc-500 transition hover:bg-white/10 hover:text-white"><i className="ri-delete-bin-line" /> Clear History</button>
          </SectionHeader>
          <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><HorizontalCards data={continueWithResume} widescreen onRemove={removeFromContinue} /></div>
        </section>
      )}

      {myList.length > 0 && (
        <section className="flex min-h-[150px] flex-col gap-1">
          <SectionHeader title="My List"><Link to="/my-list" className="flex min-h-10 items-center gap-1.5 rounded-full border border-white/5 bg-white/5 px-3.5 text-[10px] font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"><i className="ri-arrow-right-up-line" /> Manage</Link></SectionHeader>
          <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><HorizontalCards data={myList} onRemove={(item) => removeFromMyList(item)} /></div>
        </section>
      )}

      {topRated.length > 0 && (() => {
        const rated = topRated.filter((item) => !heroKeys.has(keyOf(item))).slice(0, 10).map((item, index) => ({ ...item, top10Rank: index + 1 }));
        return rated.length ? <section><SectionHeader title="Top 10 Rated" viewMorePath="/explore?sort_by=vote_average.desc" /><div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><HorizontalCards data={rated} top10 /></div></section> : null;
      })()}

      {trending.length > 0 && (() => {
        const row = dedupeItems(trending).filter((item) => !heroKeys.has(keyOf(item)) && !ratedKeys.has(keyOf(item))).slice(0, 12);
        return row.length ? <section><SectionHeader title="Trending This Week" viewMorePath="/explore" /><div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><HorizontalCards data={row} /></div></section> : null;
      })()}

      <ForYou />

      <section className="gtv-lazy-section flex min-h-[120px] flex-col gap-1 py-4">
        <SectionHeader title="Streaming Platforms" />
        <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20"><ScrollRow label="streaming platforms" className="gtv-no-scrollbar flex gap-4 overflow-x-auto pb-3">
          {OTT_PLATFORMS.map(([id, name, logo, region]) => <Link key={id} to={`/explore?provider=${id}&providerName=${encodeURIComponent(name)}&region=${region}`} className="group flex shrink-0 cursor-pointer flex-col items-center gap-2"><img src={`https://image.tmdb.org/t/p/w185${logo}`} alt={name} className="h-12 w-12 rounded-lg object-cover opacity-75 transition duration-300 group-hover:scale-105 group-hover:opacity-100" /><span className="max-w-[65px] truncate text-[9px] font-black uppercase tracking-wider text-zinc-500 transition group-hover:text-white">{name}</span></Link>)}
        </ScrollRow></div>
      </section>

      <LazyCarousel title="Anime" fetchFn={fetchAnime} viewMorePath="/anime" limit={20} />
      <LazyCarousel title="Korean Dramas" fetchFn={fetchKdrama} viewMorePath="/explore?lang=ko" />
      <LazyCarousel title="Indian Cinema" fetchFn={fetchIndian} viewMorePath="/explore?lang=hi" />
      <LazyCarousel title="Action & Crime" fetchFn={() => fetchMix([28, 80], 200)} viewMorePath="/explore?genre=28" />
      <LazyCarousel title="Sci-Fi & Horror" fetchFn={() => fetchMix([878, 27], 200)} viewMorePath="/explore?genre=878" widescreen />
      <LazyCarousel title="Comedy" fetchFn={() => fetchMix([35], 200)} viewMorePath="/explore?genre=35" />

      <TrendingSearches data={heroData} title="Trending Now" variant="rail" />
      <Footer />
    </div>
  );
}
