import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { tmdbGet } from "../lib/tmdb.js";
import MediaCard from "../components/MediaCard.jsx";
import Loading from "../components/Loading.jsx";

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const [results, setResults] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    document.title = q ? `"${q}" — Search | TheOGPirateBot` : "Search | TheOGPirateBot";
  }, [q]);

  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    setResults(null);
    setErr(null);
    tmdbGet("search/multi", { query: q, include_adult: "false" })
      .then((data) =>
        setResults((data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv"))
      )
      .catch((e) => setErr(e.message));
  }, [q]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-8">
      <h1 className="text-lg font-bold">
        {q ? (
          <>
            Results for <span className="text-zinc-400">"{q}"</span>
          </>
        ) : (
          "Type something to search"
        )}
      </h1>
      {err && <p className="text-sm text-red-400">Couldn't load: {err}</p>}
      {q && !results && !err && <Loading label="Searching…" />}
      {results && results.length === 0 && q && <p className="text-sm text-zinc-500">No results.</p>}
      {results && results.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {results.map((item) => (
            <MediaCard key={`${item.media_type}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
