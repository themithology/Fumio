import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "../../lib/irisAxios.js";
import MediaImage from "./MediaImage";
import ScrollRow from "./ScrollRow";

// ─── Trending Searches (Hotstar-style discovery) ───
// Ranked suggestion cards straight from /trending/all/day — hooks users
// into content without typing a single character.
//   variant="rail" → horizontal scroll rail (Home page, below TOP 10 Today;
//                    reuses the already-fetched trending list)
//   variant="grid" → responsive poster grid (the dedicated /search page)
const TrendingSearches = ({ data = null, title = "Trending Searches", variant = "rail" }) => {
  const [items, setItems] = useState(data || null);

  useEffect(() => {
    if (data) {
      setItems(data);
      return;
    }
    let cancelled = false;
    axios
      .get("/trending/all/day")
      .then((res) => {
        if (!cancelled) setItems(res.data?.results || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (!items) return null;

  const isGrid = variant === "grid";

  const results = items
    .filter((s) => s && s.id && (s.media_type === "movie" || s.media_type === "tv"))
    .slice(0, isGrid ? 20 : 14);

  if (results.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 py-4">
      <div className="flex items-end justify-between px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 pt-8 pb-2">
        <h2 className="font-editorial text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span className="w-1.5 h-6 rounded-full bg-[var(--gtv-bg)]" />
          {title}
          <i className="ri-fire-fill text-base text-zinc-500" />
        </h2>
      </div>
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <ScrollRow
          enabled={!isGrid}
          label="trending searches"
          className={
            isGrid
              ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3.5"
              : "gtv-no-scrollbar flex gap-3.5 overflow-x-auto pb-3"
          }
        >
          {results.map((s, i) => {
            const name = s.name || s.title || s.original_name || s.original_title;
            const year = (s.release_date || s.first_air_date || "").split("-")[0];
            return (
              <Link
                key={`${s.id}-${i}`}
                to={`/${s.media_type}/details/${s.id}`}
                className={`group relative ${isGrid ? "w-full" : "w-[108px] sm:w-[118px] shrink-0"}`}
              >
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[var(--gtv-surface)] transition-all duration-300 group-hover:border-white/30 group-hover:scale-[1.03] active:scale-95">
                  <MediaImage
                    src={
                      s.poster_path
                        ? `https://image.tmdb.org/t/p/w300${s.poster_path}`
                        : s.backdrop_path
                          ? `https://image.tmdb.org/t/p/w300${s.backdrop_path}`
                          : null
                    }
                    alt={name}
                    title={name}
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                  <span className="absolute top-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 border border-white/15 text-[10px] font-black text-white backdrop-blur">
                    #{i + 1}
                  </span>
                  <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-all duration-300 group-hover:opacity-100">
                    <i className="ri-play-fill text-base" />
                  </span>
                  <div className="absolute inset-x-0 bottom-0 p-2">
                    <p className="line-clamp-2 text-[11px] font-bold leading-tight text-white">
                      {name}
                    </p>
                  </div>
                </div>
                <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                  {s.media_type === "tv" ? "Series" : "Movie"}
                  {year && <span className="text-zinc-600"> · {year}</span>}
                </p>
              </Link>
            );
          })}
        </ScrollRow>
      </div>
    </div>
  );
};

export default TrendingSearches;
