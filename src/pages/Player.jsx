import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { tmdbGet } from "../lib/tmdb.js";
import StreamFrame from "../components/StreamFrame.jsx";
import Loading from "../components/Loading.jsx";

export default function Player() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const season = Number(params.get("season") || 1);
  const episode = Number(params.get("episode") || 1);

  const [details, setDetails] = useState(null);

  useEffect(() => {
    tmdbGet(`${type}/${id}`)
      .then(setDetails)
      .catch(() => setDetails(null));
  }, [type, id]);

  const title = details?.title || details?.name || "Loading…";

  useEffect(() => {
    const year = (details?.release_date || details?.first_air_date || "").slice(0, 4);
    document.title = details
      ? `Playing ${title}${year ? ` (${year})` : ""} | TheOGPirateBot`
      : "TheOGPirateBot — Movies & TV";
  }, [details, title]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold line-clamp-1">{title}</h1>
          {type === "tv" && (
            <p className="text-xs text-zinc-500">
              Season {season} · Episode {episode}
            </p>
          )}
        </div>
        <Link
          to={`/details/${type}/${id}`}
          className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10"
        >
          Close
        </Link>
      </div>

      {!details && <Loading label="Loading…" />}
      {details && <StreamFrame tmdbId={id} mediaType={type} season={season} episode={episode} />}
    </div>
  );
}
