import { useEffect, useState } from "react";
import { tmdbGet } from "../lib/tmdb.js";
import MediaCard from "../components/MediaCard.jsx";
import Loading from "../components/Loading.jsx";

const ROWS = [
  { title: "Trending this week", path: "trending/all/week" },
  { title: "Popular Movies", path: "movie/popular", mediaType: "movie" },
  { title: "Popular TV Shows", path: "tv/popular", mediaType: "tv" },
  { title: "Top Rated Movies", path: "movie/top_rated", mediaType: "movie" },
  { title: "Top Rated TV Shows", path: "tv/top_rated", mediaType: "tv" },
];

function Row({ title, path, mediaType }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    tmdbGet(path)
      .then((data) => alive && setItems(data.results || []))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">{title}</h2>
      {err && <p className="text-xs text-red-400">Couldn't load: {err}</p>}
      {!items && !err && <Loading label="Loading…" />}
      {items && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {items.slice(0, 20).map((item) => (
            <MediaCard key={item.id} item={{ ...item, media_type: item.media_type || mediaType }} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = "TheOGPirateBot — Movies & TV";
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-8">
      {ROWS.map((row) => (
        <Row key={row.path} {...row} />
      ))}
    </div>
  );
}
