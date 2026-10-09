import React from "react";
import { Link } from "react-router-dom";
import MediaImage from "./MediaImage.jsx";
import ScrollRow from "./ScrollRow.jsx";
import TitleHint from "./TitleHint.jsx";

// Iris-style cards shared by every Home rail, including Top 10, local library
// rows, and the optional remove controls for Continue Watching/My List.
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

const REMOVE_BTN_CLASS = "absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/75 text-lg text-zinc-200 shadow-md backdrop-blur-sm transition active:scale-90 hover:bg-white hover:text-black";

const HorizontalCards = ({
  data,
  widescreen = false,
  top10 = false,
  limit = 10,
  grid = false,
  onRemove,
  onEndReached,
  hasMore = false,
  loadingMore = false,
}) => {
  const cleanData = (data || []).filter((item) => item && item.id);
  const paging = Boolean(onEndReached) && hasMore;
  if (cleanData.length === 0) return null;

  const visible = grid || paging ? cleanData : cleanData.slice(0, limit);
  if (grid) {
    const Card = widescreen ? WidescreenCard : PosterCard;
    return (
      <div className="w-full animate-slide-up-fade">
        <style>{STAGGER_CSS}</style>
        <div className={`grid gap-x-3 gap-y-6 sm:gap-x-4 ${widescreen ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
          {visible.map((item) => <Card key={`${item.media_type || item.type || "movie"}-${item.id}`} item={item} onRemove={onRemove} fluid />)}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full animate-slide-up-fade group/row">
      <style>{STAGGER_CSS}</style>
      <ScrollRow label="titles" className="gtv-no-scrollbar flex snap-x gap-4 overflow-x-auto px-1 py-4" onEndReached={paging ? onEndReached : undefined}>
        {visible.map((item, index) => {
          if (top10) {
            return (
              <div key={`${item.media_type || item.type || "movie"}-${item.id}`} className="relative flex shrink-0 snap-start items-center pl-1 pr-6">
                <span style={{ WebkitTextStroke: "2px rgba(255,255,255,0.18)", color: "transparent" }} className="z-0 -mr-6 shrink-0 select-none font-display text-[6rem] font-black leading-none tracking-tighter drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)] sm:-mr-8 sm:text-[7rem] md:text-[8rem]">
                  {item.top10Rank || index + 1}
                </span>
                <div className="relative z-10"><PosterCard item={item} onRemove={onRemove} /></div>
              </div>
            );
          }
          const Card = widescreen ? WidescreenCard : PosterCard;
          return <div key={`${item.media_type || item.type || "movie"}-${item.id}-${index}`} className="shrink-0 snap-start"><Card item={item} onRemove={onRemove} /></div>;
        })}
        {paging && loadingMore && (
          <div className={`flex shrink-0 snap-start items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03] ${widescreen ? "aspect-video w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px]" : "aspect-[2/3] w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]"}`} aria-label="Loading more titles">
            <i className="ri-loader-4-line animate-spin text-2xl text-zinc-500" aria-hidden="true" />
          </div>
        )}
      </ScrollRow>
      <div className="pointer-events-none absolute right-0 top-1/2 h-full w-12 -translate-y-1/2 bg-gradient-to-l from-black to-transparent opacity-0 transition-opacity duration-300 group-hover/row:opacity-100" />
    </div>
  );
};

const metaLine = (item, mediaType) => {
  const year = (item.release_date || item.first_air_date || "").split("-")[0];
  const rating = item.vote_average ? Number(item.vote_average).toFixed(1) : null;
  const episode = item.lastUpdated && mediaType === "tv" && item.season && item.episode ? `S${item.season}:E${item.episode}` : null;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-zinc-500 sm:text-xs">
      {rating && <span className="flex items-center gap-0.5 text-zinc-400"><i className="ri-star-fill text-[11px]" /> {rating}</span>}
      <span>·</span><span>{episode || year || "N/A"}</span><span>·</span><span className="capitalize">{mediaType === "tv" ? "Series" : "Movie"}</span>
    </div>
  );
};

const cardPath = (item, mediaType) => {
  if (!item.lastUpdated) return `/${mediaType}/details/${item.id}`;
  const query = mediaType === "tv" ? `?season=${Number(item.season) || 1}&episode=${Number(item.episode) || 1}` : "";
  return `/watch/${mediaType}/${item.id}${query}`;
};

const RemoveButton = ({ item, title, onRemove }) => {
  if (!onRemove) return null;
  return (
    <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove(item); }} aria-label={`Remove ${title} from list`} className={REMOVE_BTN_CLASS}>
      <i className="ri-close-line" />
    </button>
  );
};

const WidescreenCard = ({ item, onRemove, fluid = false }) => {
  const title = item.title || item.name || "Untitled";
  const mediaType = item.media_type || item.type || (item.title ? "movie" : "tv");
  const rawStill = item.episodeStill;
  const imageUrl = rawStill
    ? (rawStill.startsWith("http") ? rawStill : `https://image.tmdb.org/t/p/w500${rawStill}`)
    : item.backdrop_path || item.poster_path
      ? `https://image.tmdb.org/t/p/w780${item.backdrop_path || item.poster_path}`
      : null;
  return (
    <Link to={cardPath(item, mediaType)} className={`group block ${fluid ? "w-full" : "w-[170px] sm:w-[210px] md:w-[240px] lg:w-[270px] xl:w-[290px]"}`}>
      <div className="gtv-media-art relative aspect-video overflow-hidden rounded-2xl border border-white/5 bg-[var(--gtv-surface)] shadow-lg transition-all duration-300 group-hover:scale-[1.04] group-hover:border-white/20 group-hover:shadow-[0_12px_30px_rgba(0,0,0,0.65)]">
        <RemoveButton item={item} title={title} onRemove={onRemove} />
        <MediaImage src={imageUrl} alt={title} title={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-300 group-hover:opacity-100"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/25 text-white shadow-md backdrop-blur"><i className="ri-play-fill ml-0.5 text-2xl" /></span></div>
      </div>
      <div className="mt-3 px-1"><TitleHint className="truncate text-xs font-bold text-white transition duration-200 group-hover:text-[var(--gtv-accent-2)] sm:text-sm">{title}</TitleHint>{metaLine(item, mediaType)}</div>
    </Link>
  );
};

const PosterCard = ({ item, onRemove, fluid = false }) => {
  const title = item.title || item.name || "Untitled";
  const mediaType = item.media_type || item.type || (item.title ? "movie" : "tv");
  const imageUrl = item.poster_path || item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.poster_path || item.backdrop_path}` : null;
  return (
    <Link to={cardPath(item, mediaType)} className={`group block ${fluid ? "w-full" : "w-[130px] sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]"}`}>
      <div className="gtv-media-art relative aspect-[2/3] overflow-hidden rounded-2xl border border-white/5 bg-[var(--gtv-surface)] shadow-lg transition-all duration-300 group-hover:scale-[1.04] group-hover:border-white/20 group-hover:shadow-[0_12px_30px_rgba(0,0,0,0.65)]">
        <RemoveButton item={item} title={title} onRemove={onRemove} />
        <MediaImage src={imageUrl} alt={title} title={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-300 group-hover:opacity-100"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 text-white shadow-md backdrop-blur"><i className="ri-play-fill ml-0.5 text-xl" /></span></div>
      </div>
      <div className="mt-3 px-1"><TitleHint className="truncate text-xs font-bold text-white/95 transition duration-200 group-hover:text-[var(--gtv-accent-2)] sm:text-sm">{title}</TitleHint>{metaLine(item, mediaType)}</div>
    </Link>
  );
};

export default HorizontalCards;
