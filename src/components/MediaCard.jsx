import { Link } from "react-router-dom";
import { img } from "../lib/tmdb.js";

export default function MediaCard({ item }) {
  const type = item.media_type || (item.title ? "movie" : "tv");
  const title = item.title || item.name || "Untitled";
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);

  return (
    <Link to={`/details/${type}/${item.id}`} className="group block w-32 shrink-0 sm:w-40" title={title}>
      <div className="aspect-[2/3] overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/5">
        {item.poster_path ? (
          <img
            src={img(item.poster_path, "w342")}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">No image</div>
        )}
      </div>
      <p className="mt-1.5 line-clamp-1 text-xs font-semibold text-zinc-200">{title}</p>
      {year && <p className="text-[10px] text-zinc-500">{year}</p>}
    </Link>
  );
}
