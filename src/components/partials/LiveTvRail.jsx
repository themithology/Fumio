import React, { memo, useState } from "react";
import { Link } from "react-router-dom";
import ScrollRow from "./ScrollRow";

// ─── Live TV shared UI: cards, rails, grids ────────────────────────────────
// Speaks the house card language (HorizontalCards/Cards) on purpose: flat
// gtv-surface tile, hairline border, hover lift, truncate title. And ONE
// hard rule the rest of the site follows — ZERO infinite animation inside
// lists. (A pinging dot on 150 cards is what melted phones.)

export const LiveDot = ({ className = "" }) => (
  <span className={`flex items-center gap-1 ${className}`}>
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
    <span className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-300">Live</span>
  </span>
);

const ChannelLogo = memo(({ channel }) => {
  const [failed, setFailed] = useState(false);
  const initial = (channel?.name || "?").trim().charAt(0).toUpperCase() || "?";
  if (failed || !channel?.logo) {
    return (
      <span className="flex h-full w-full items-center justify-center font-display text-3xl font-black text-white/80">
        {initial}
      </span>
    );
  }
  return (
    <img
      src={channel.logo}
      alt={channel.name}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
    />
  );
});

export const LiveTvCard = memo(({ channel, favs, onToggleFav, active = false, onSelect = null }) => {
  if (!channel) return null;
  const isFav = favs?.has?.(String(channel.id));
  return (
    <Link
      to={`/live-tv/watch/${channel.id}`}
      // onSelect (the watch sheet) intercepts plain left clicks; middle-click
      // / open-in-new-tab still lands on solo playback.
      onClick={onSelect ? (e) => { e.preventDefault(); onSelect(channel); } : undefined}
      className="group block w-[104px] shrink-0 snap-start sm:w-[120px] md:w-[136px]"
      aria-label={`Watch ${channel.name} live`}
    >
      <span
        className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-[var(--gtv-surface)] p-3 shadow-lg transition-all duration-300 group-hover:scale-[1.04] group-active:scale-[0.98] ${
          active ? "border-white/60" : "border-white/5 group-hover:border-white/20"
        }`}
      >
        <ChannelLogo channel={channel} />
        {/* Static LIVE tag — the house duration-badge shape, no pulse. */}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md border border-white/10 bg-black px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
          <span className="h-1 w-1 rounded-full bg-red-500" /> Live
        </span>
        {active && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-px text-[8px] font-black uppercase tracking-widest text-black">
            Now
          </span>
        )}
        {onToggleFav && (
          <span
            role="button"
            tabIndex={0}
            aria-label={isFav ? `Remove ${channel.name} from favorites` : `Add ${channel.name} to favorites`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFav(channel.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onToggleFav(channel.id);
              }
            }}
            className={`absolute right-1.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border text-sm shadow-md transition active:scale-90 ${
              isFav
                ? "border-white/20 bg-white text-black opacity-100"
                : "border-white/20 bg-black/80 text-zinc-200 opacity-100 hover:bg-white hover:text-black pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
            }`}
          >
            <i className={`${isFav ? "ri-heart-3-fill" : "ri-heart-3-line"}`} />
          </span>
        )}
      </span>
      <span className="mt-2 line-clamp-2 block w-full text-center text-xs font-bold leading-tight text-white">
        {channel.name}
      </span>
    </Link>
  );
});

// House SectionHeader, exactly (white bar + View More pill). Rails are
// capped like everywhere else on the site (limit=12 default) — the full
// section lives one tap away on its tab.
export const LiveTvRail = memo(({ title, channels, favs, onToggleFav, action, onSelect = null, limit = 12 }) => {
  if (!channels || channels.length === 0) return null;
  const shown = channels.slice(0, limit);
  return (
    <section className="gtv-lazy-section flex w-full flex-col">
      <div className="flex items-end justify-between px-4 pb-2 pt-10 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <h2 className="flex items-center gap-2 font-editorial text-xl font-bold tracking-tight text-white sm:text-2xl">
          <span className="h-6 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
          {title}
        </h2>
        <div className="flex items-center gap-2">{action}</div>
      </div>
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <ScrollRow label="live channels" className="gtv-no-scrollbar">
          {shown.map((c) => (
            <LiveTvCard key={c.id} channel={c} favs={favs} onToggleFav={onToggleFav} onSelect={onSelect} />
          ))}
        </ScrollRow>
      </div>
    </section>
  );
});

// House grid (Cards.jsx): 3 → 7 columns. The parent slices + pages.
export const LiveTvGrid = memo(({ channels, favs, onToggleFav, onSelect = null }) => {
  if (!channels || channels.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 md:gap-5 lg:grid-cols-6 xl:grid-cols-7">
      {channels.map((c) => (
        <div key={c.id} className="[&>a]:w-full">
          <LiveTvCard channel={c} favs={favs} onToggleFav={onToggleFav} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
});

export const LiveTvRailSkeleton = () => (
  <div className="flex w-full flex-col" aria-hidden="true">
    <div className="flex items-center gap-2 px-4 pt-10 sm:px-8 md:px-12 lg:px-16 xl:px-20">
      <div className="h-6 w-1.5 rounded-full bg-zinc-900" />
      <div className="h-6 w-40 animate-pulse rounded-lg bg-zinc-900" />
    </div>
    <div className="px-4 pt-3 sm:px-8 md:px-12 lg:px-16 xl:px-20">
      <ScrollRow label="live channels" wrapClassName="pointer-events-none select-none" className="gtv-no-scrollbar">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex w-[104px] shrink-0 flex-col items-center sm:w-[120px]">
            <div className="aspect-square w-full animate-pulse rounded-2xl border border-white/5 bg-zinc-900/60" />
            <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-zinc-900/60" />
          </div>
        ))}
      </ScrollRow>
    </div>
  </div>
);

export const LiveTvEmpty = ({ icon = "ri-tv-line", title, hint, action }) => (
  <div className="flex w-full flex-col items-center gap-2 px-6 py-14 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-500">
      <i className={`${icon} text-xl`} />
    </span>
    <p className="text-[13px] font-bold text-white">{title}</p>
    {hint && <p className="max-w-xs text-[11px] leading-relaxed text-zinc-500">{hint}</p>}
    {action}
  </div>
);
