import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import axios from "../lib/irisAxios.js";

const Section = ({ title, items, widescreen = false }) => (
  <section className="flex flex-col gap-1">
    <div className="flex items-end justify-between gap-4 px-4 pt-10 sm:px-8 md:px-12 lg:px-16 xl:px-20">
      <h2 className="font-editorial text-2xl font-bold leading-tight text-white sm:text-3xl">{title}</h2>
      <Link to="/explore?type=tv&genre=animation" className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-zinc-400 transition hover:text-white">
        Browse all <i className="ri-arrow-right-up-line" />
      </Link>
    </div>
    <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
      <HorizontalCards data={items} widescreen={widescreen} limit={14} />
    </div>
  </section>
);

const Anime = () => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const urls = [
        ["Trending anime", "/trending/tv/week", false],
        ["Popular series", "/discover/tv?with_original_language=ja&with_genres=16&sort_by=popularity.desc&vote_count.gte=20&page=1", false],
        ["Anime movies", "/discover/movie?with_original_language=ja&with_genres=16&sort_by=popularity.desc&vote_count.gte=10&page=1", false],
        ["Currently airing", "/discover/tv?with_original_language=ja&with_genres=16&sort_by=first_air_date.desc&air_date.lte=2099-12-31&page=1", false],
      ];
      const results = await Promise.all(
        urls.map(async ([title, url, widescreen]) => {
          const response = await axios.get(url);
          const items = (response.data?.results || [])
            .filter((item) => {
              if (!item || !item.id || item.adult === true) return false;
              return item.genre_ids?.includes(16) || item.original_language === "ja" || item.origin_country?.includes("JP");
            })
            .map((item) => ({ ...item, media_type: url.includes("/movie") ? "movie" : "tv" }));
          return { title, items, widescreen };
        }),
      );
      setRows(results.map((row) => {
        const seen = new Set();
        return {
          ...row,
          items: row.items.filter((item) => {
            const key = `${item.media_type}-${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        };
      }));
    } catch (loadError) {
      console.error("Anime hub failed to load", loadError);
      setError(true);
    }
  }, []);

  useEffect(() => {
    document.title = "TheOGPirateBot | Anime";
    load();
  }, [load]);

  if (!rows && !error) return <Loading />;
  if (error && !rows) return <FetchError onRetry={load} />;

  return (
    <div className="min-h-screen w-full bg-[var(--gtv-bg)] pb-28 animate-fade-in">
      <Topnav />
      <header className="relative overflow-hidden px-4 pb-2 pt-8 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <p className="relative text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-300/80">Iris anime hub</p>
        <h1 className="relative mt-2 max-w-2xl font-editorial text-4xl font-black tracking-tight text-white sm:text-6xl">Anime, ready when you are.</h1>
        <p className="relative mt-3 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">Discover Japanese series and films from the live catalogue, then jump into the same Iris season and episode browser on every title.</p>
      </header>
      {rows.map((row) => row.items.length > 0 && <Section key={row.title} {...row} />)}
      <Footer />
    </div>
  );
};

export default Anime;
