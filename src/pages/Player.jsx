import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { tmdbGet } from "../lib/tmdb.js";
import PlayerStage from "../components/PlayerStage.jsx";
import { saveContinueWatching } from "../utils/watchHistory.js";

export default function Player() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const season = Number(params.get("season") || 1);
  const episode = Number(params.get("episode") || 1);

  const [details, setDetails] = useState(null);

  useEffect(() => {
    tmdbGet(`${type}/${id}`)
      .then(setDetails)
      .catch(() => setDetails(null));
  }, [type, id]);

  useEffect(() => {
    const t = details?.title || details?.name;
    document.title = t ? `Playing ${t} | TheOGPirateBot` : "TheOGPirateBot — Movies & TV";
    if (!details) return;
    saveContinueWatching({
      id: Number(id),
      type,
      media_type: type,
      title: t,
      poster_path: details.poster_path || null,
      backdrop_path: details.backdrop_path || null,
      vote_average: details.vote_average || 0,
      release_date: details.release_date || "",
      first_air_date: details.first_air_date || "",
      minutesLeft: type === "movie" ? (details.runtime || 0) : (details.episode_run_time?.[0] || 0),
      season: type === "tv" ? season : undefined,
      episode: type === "tv" ? episode : undefined,
      episodeName: "",
      episodeStill: "",
    });
  }, [details, episode, id, season, type]);

  const close = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(`/details/${type}/${id}`, { replace: true });
  }, [navigate, type, id]);

  // If the user backs out of fullscreen with Esc/the browser's own chrome,
  // treat it the same as pressing Close — this page has no purpose outside
  // fullscreen.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) navigate(`/details/${type}/${id}`, { replace: true });
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [navigate, type, id]);

  return (
    <div className="fixed inset-0 z-50 h-screen w-screen bg-black">
      <PlayerStage tmdbId={id} mediaType={type} season={season} episode={episode} />
      <button
        onClick={close}
        aria-label="Close player"
        className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
      >
        ✕
      </button>
    </div>
  );
}
