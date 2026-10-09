import React from "react";
import { Link } from "react-router-dom";
import MediaImage from "./MediaImage";
import ScrollRow from "./ScrollRow";
import TitleHint from "./TitleHint";

// ─── HorizontalCards ────────────────────────────────────────────────────────
// Ported from Iris's src/components/partials/HorizontalCards.jsx, trimmed:
// no "remove" button, no Top 10 / AniList rail (the anime lane isn't ported —
// see src/providers/sources.js). The same two card shapes are also used by the
// local-first Continue Watching and My List rails.

const STAGGER_CSS = `
  @keyframes slideUpFade {
    0% { opacity: 0; transform: translateY(16px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  .animate-slide-up-fade {
    animation: slideUpFade 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  @media (prefers-reduced-motion: reduce) {
    .animate-slide-up-fade { animation: none; opacity: 1; }
  }
`;

// `grid` (optional): lay the cards out as a wrapping grid instead of a
// horizontal scroll row — used by Search's category tabs & Explore.
const HorizontalCards = ({
  data,
  widescreen = false,
  limit = 10,
  grid = false,
  onEndReached,
  hasMore = false,
  loadingMore = false,
}) => {
  const cleanData = (data || []).filter((item) => item && item.id);
  // `hasMore` is a safety net: stop asking for more once the parent says
  // there's nothing left, even if it forgets to also drop onEndReached.
  const paging = Boolean(onEndReached) && hasMore;

  if (cleanData.length === 0) return null;

  const visible = grid || paging ? cleanData : cleanData.slice(0, limit);
  const Card = widescreen ? WidescreenCard : PosterCard;

  if (grid) {
    return (
      <div className="w-full animate-slide-up-fade">
        <style>{STAGGER_CSS}</style>
        <div
          className={`grid gap-x-3 gap-y-6 sm:gap-x-4 ${
            widescreen ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
          }`}
        >
          {visible.map((item) => (
            <Card key={`${item.media_type || "movie"}-${item.id}`} item={item} fluid />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full animate-slide-up-fade relative group/row">
      <style>{STAGGER_CSS}</style>
      <ScrollRow
        label="titles"
        className="gtv-no-scrollbar flex gap-4 overflow-x-auto snap-x py-4 px-1"
        onEndReached={paging ? onEndReached : undefined}
      >
        {visible.map((item, index) => (
          <div key={item.id || index} className="shrink-0 snap-start">
            <Card item={item} />
          </div>
        ))}
        {paging && loadingMore && (
          <div
            className={`shrink-0 snap-start flex items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03] ${
              widescreen
                ? "w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px] aspect-video"
                : "w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px] aspect-[2/3]"
            }`}
            aria-label="Loading more titles"
          >
            <i className="ri-loader-4-line animate-spin text-2xl text-zinc-500" aria-hidden="true" />
          </div>
        )}
      </ScrollRow>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 h-full w-12 bg-gradient-to-l from-black to-transparent pointer-events-none opacity-0 group-hover/row:opacity-100 transition-opacity duration-300" />
    </div>
  );
};

const metaLine = (item, mediaType) => {
  const year = (item.release_date || item.first_air_date || "").split("-")[0];
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  const episode = item.lastUpdated && mediaType === "tv" && item.season && item.episode
    ? `S${item.season}:E${item.episode}`
    : null;
  return (
    <div className="flex items-center gap-1.5 mt-1 text-[10px] sm:text-xs text-zinc-500 font-bold tracking-wide">
      {rating && (
        <span className="flex items-center gap-0.5 text-zinc-400">
          <i className="ri-star-fill text-[11px]" /> {rating}
        </span>
      )}
      <span>·</span>
      <span>{episode || year || "N/A"}</span>
      <span>·</span>
      <span className="capitalize">{mediaType === "tv" ? "Series" : "Movie"}</span>
    </div>
  );
};

const cardPath = (item, mediaType) => {
  if (!item.lastUpdated) return `/${mediaType}/details/${item.id}`;
  const query = mediaType === "tv" ? `?season=${Number(item.season) || 1}&episode=${Number(item.episode) || 1}` : "";
  return `/watch/${mediaType}/${item.id}${query}`;
};

/* Landscape 16:9 card — Trending/featured rows. */
const WidescreenCard = ({ item, fluid = false }) => {
  const title = item.title || item.name || "Untitled";
  const mediaType = item.media_type || item.type || (item.title ? "movie" : "tv");
  const imageUrl =
    item.backdrop_path || item.poster_path
      ? `https://image.tmdb.org/t/p/w780${item.backdrop_path || item.poster_path}`
      : null;

  return (
    <Link
      to={cardPath(item, mediaType)}
      className={`group block ${fluid ? "w-full" : "w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px]"}`}
    >
      <div className="gtv-media-art relative aspect-video overflow-hidden rounded-2xl bg-[var(--gtv-surface)] border border-white/5 shadow-lg transition-all duration-300 group-hover:scale-[1.04] group-hover:shadow-[0_12px_30px_rgba(0,0,0,0.65)] group-hover:border-white/20">
        <MediaImage
          src={imageUrl}
          alt={title}
          title={title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-black/45 backdrop-blur-[1px]">
          <span className="h-10 w-10 rounded-full bg-white/25 flex items-center justify-center text-white backdrop-blur shadow-md">
            <i className="ri-play-fill text-2xl ml-0.5" />
          </span>
        </div>
      </div>
      <div className="mt-3 px-1">
        <TitleHint className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-[var(--gtv-accent-2)] transition duration-200">
          {title}
        </TitleHint>
        {metaLine(item, mediaType)}
      </div>
    </Link>
  );
};

/* Classic 2:3 poster card — most rows. `fluid` fills the parent (grid mode). */
const PosterCard = ({ item, fluid = false }) => {
  const title = item.title || item.name || "Untitled";
  const mediaType = item.media_type || item.type || (item.title ? "movie" : "tv");
  const imageUrl =
    item.poster_path || item.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${item.poster_path || item.backdrop_path}`
      : null;

  return (
    <Link
      to={cardPath(item, mediaType)}
      className={`group block ${fluid ? "w-full" : "w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]"}`}
    >
      <div className="gtv-media-art relative aspect-[2/3] overflow-hidden rounded-2xl bg-[var(--gtv-surface)] border border-white/5 shadow-lg transition-all duration-300 group-hover:scale-[1.04] group-hover:shadow-[0_12px_30px_rgba(0,0,0,0.65)] group-hover:border-white/20">
        <MediaImage
          src={imageUrl}
          alt={title}
          title={title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-black/45 backdrop-blur-[1px]">
          <span className="h-9 w-9 rounded-full bg-white/25 flex items-center justify-center text-white backdrop-blur shadow-md">
            <i className="ri-play-fill text-xl ml-0.5" />
          </span>
        </div>
      </div>
      <div className="mt-3 px-1">
        <TitleHint className="text-xs sm:text-sm font-bold text-white/95 truncate group-hover:text-[var(--gtv-accent-2)] transition duration-200">
          {title}
        </TitleHint>
        {metaLine(item, mediaType)}
      </div>
    </Link>
  );
};

export default HorizontalCards;
