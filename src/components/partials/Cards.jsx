import React from "react";
import { Link } from "react-router-dom";
import MediaImage from "./MediaImage";
import TitleHint from "./TitleHint";

const Cards = ({ data, title }) => {
  return (
    <div className="w-full px-1">
      <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 md:gap-5 lg:grid-cols-6 xl:grid-cols-7">
        {data.filter(c => c && c.id).map((c, i) => {
          const titleText =
            c.name || c.title || c.original_name || c.original_title || "Untitled";
          const year = (c.release_date || c.first_air_date || "").split("-")[0];
          const mediaType = c.media_type || title;
          const isPerson = mediaType === "person";
          const rating = c.vote_average ? c.vote_average.toFixed(1) : null;
          const imageUrl = c.poster_path || c.backdrop_path || c.profile_path
            ? `https://image.tmdb.org/t/p/w780${
                c.poster_path || c.backdrop_path || c.profile_path
              }`
            : null;

          return (
            <Link to={`/${mediaType}/details/${c.id}`} key={i} className="group relative">
              <div className="gtv-grid-art relative aspect-[2/3] overflow-hidden rounded-xl bg-[var(--gtv-surface)] shadow-lg ring-1 ring-white/5 transition-all duration-300 group-hover:scale-[1.04] group-hover:shadow-2xl group-hover:ring-white/20">
                <MediaImage
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                  src={imageUrl}
                  alt={titleText}
                  title={titleText}
                  variant={isPerson ? "person" : "poster"}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {rating && (
                  <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                    <i className="ri-star-fill text-[10px]" /> {rating}
                  </div>
                )}

                <div className="absolute inset-x-0 bottom-0 flex translate-y-2 justify-center p-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black">
                    <i className="ri-play-fill" /> View
                  </span>
                </div>
              </div>

              {/* One line per card keeps a row of posters even; the full title
                  is one hover away instead of a trip to the details page. */}
              <TitleHint className="mt-2 truncate text-sm font-medium text-white/90">
                {titleText}
              </TitleHint>
              {year && <p className="text-xs text-zinc-500">{year}</p>}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default Cards;
