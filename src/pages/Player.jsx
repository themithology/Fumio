import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { tmdbGet } from "../lib/tmdb.js";
import { resolveStream } from "../providers/index.js";
import VideoPlayer from "../components/VideoPlayer.jsx";
import Loading from "../components/Loading.jsx";

export default function Player() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const season = Number(params.get("season") || 1);
  const episode = Number(params.get("episode") || 1);

  const [details, setDetails] = useState(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    tmdbGet(`${type}/${id}`)
      .then(setDetails)
      .catch(() => setDetails(null));
  }, [type, id]);

  useEffect(() => {
    setStream(null);
    setError(null);
    resolveStream({ tmdbId: id, type, season, episode, title: details?.title || details?.name })
      .then(setStream)
      .catch((e) => setError(e.message));
  }, [id, type, season, episode, details]);

  const title = details?.title || details?.name || "Loading…";

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

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Couldn't resolve a stream: {error}
        </div>
      )}
      {!error && !stream && <Loading label="Resolving stream…" />}
      {stream && (
        <>
          <VideoPlayer src={stream.url} type={stream.type} />
          <p className="text-xs text-zinc-600">Source: {stream.providerName || stream.provider}</p>
        </>
      )}
    </div>
  );
}
