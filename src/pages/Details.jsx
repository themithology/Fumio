import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { tmdbGet, img } from "../lib/tmdb.js";
import Loading from "../components/Loading.jsx";

export default function Details() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const [details, setDetails] = useState(null);
  const [err, setErr] = useState(null);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);

  useEffect(() => {
    setDetails(null);
    setErr(null);
    tmdbGet(`${type}/${id}`)
      .then((data) => {
        setDetails(data);
        const firstRealSeason = (data.seasons || []).find((s) => s.season_number > 0);
        if (firstRealSeason) setSeason(firstRealSeason.season_number);
      })
      .catch((e) => setErr(e.message));
  }, [type, id]);

  useEffect(() => {
    const t = details?.title || details?.name;
    document.title = t ? `${t} | TheOGPirateBot` : "TheOGPirateBot — Movies & TV";
  }, [details]);

  if (err) return <p className="p-8 text-sm text-red-400">Couldn't load title: {err}</p>;
  if (!details) return <Loading label="Loading title…" />;

  const title = details.title || details.name;
  const year = (details.release_date || details.first_air_date || "").slice(0, 4);
  const seasons = (details.seasons || []).filter((s) => s.season_number > 0);
  const episodeCount = seasons.find((s) => s.season_number === season)?.episode_count || 1;

  const play = () => {
    const qs = type === "tv" ? `?season=${season}&episode=${episode}` : "";
    navigate(`/watch/${type}/${id}${qs}`);
  };

  return (
    <div className="relative">
      {details.backdrop_path && (
        <div className="absolute inset-x-0 top-0 h-[40vh] overflow-hidden">
          <img src={img(details.backdrop_path, "w1280")} alt="" className="h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/60 to-transparent" />
        </div>
      )}
      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:flex-row sm:px-8">
        <div className="w-40 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:w-56">
          {details.poster_path ? (
            <img src={img(details.poster_path, "w500")} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="aspect-[2/3] bg-zinc-900" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <h1 className="text-2xl font-black sm:text-3xl">
            {title} {year && <span className="font-normal text-zinc-500">({year})</span>}
          </h1>
          {details.genres?.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {details.genres.map((g) => g.name).join(" • ")}
            </p>
          )}
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">{details.overview}</p>

          {type === "tv" && seasons.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-zinc-500">Season</span>
                <select
                  value={season}
                  onChange={(e) => {
                    setSeason(Number(e.target.value));
                    setEpisode(1);
                  }}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-white"
                >
                  {seasons.map((s) => (
                    <option key={s.season_number} value={s.season_number}>
                      {s.name || `Season ${s.season_number}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-zinc-500">Episode</span>
                <select
                  value={episode}
                  onChange={(e) => setEpisode(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-white"
                >
                  {Array.from({ length: episodeCount }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Episode {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <button
            onClick={play}
            className="mt-2 w-fit rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-zinc-200 active:scale-95"
          >
            ▶ Play
          </button>
        </div>
      </div>
    </div>
  );
}
