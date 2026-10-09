import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import MediaImage from "../components/partials/MediaImage.jsx";
import ScrollRow from "../components/partials/ScrollRow.jsx";
import {
  airStatus,
  displayTitle,
  fetchWeekSchedule,
  formatCountdown,
  getLocalWeek,
  groupByLocalDay,
  isSameLocalDay,
  resolveTmdbId,
} from "../utils/animeSchedule.js";

// ─── /schedule — weekly anime airing schedule ───
// Single-day timeline (justanime-style): a "Recently Aired" strip, a big
// day-tab row for the local Mon→Sun week, then the selected day's episodes
// grouped by hour on a vertical rail. Data is AniList via the edge-first
// backend, localized to the visitor's timezone. Zero TMDB quota on render;
// a TMDB id is resolved only when a card is clicked.

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_LABELS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long" });
const longDate = (d) => `${ordinal(d.getDate())} ${monthFmt.format(d)}`;
const rangeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const rangeYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const formatWeekRange = (days) => {
  const first = days[0];
  const last = days[6];
  const left = first.getFullYear() === last.getFullYear() ? rangeFmt.format(first) : rangeYearFmt.format(first);
  return `${left} – ${rangeYearFmt.format(last)}`;
};

// 24h "07:30" — the reference layout uses a compact 24h clock in the card.
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clock = (airingAt) => clockFmt.format(new Date(airingAt * 1000));
const hourLabel = (airingAt) => {
  const d = new Date(airingAt * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
};
const hourKey = (airingAt) => {
  const d = new Date(airingAt * 1000);
  return d.getHours();
};

/** Group one day's items by local hour, in airing order. */
const groupByHour = (list) => {
  const groups = [];
  let current = null;
  const sorted = [...list].sort((a, b) => a.airingAt - b.airingAt || (a.id ?? 0) - (b.id ?? 0));
  for (const it of sorted) {
    const h = hourKey(it.airingAt);
    if (!current || current.hour !== h) {
      current = { hour: h, label: hourLabel(it.airingAt), items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  return groups;
};

// ── Status word under the clock: AIRED / LIVE / in 5h 12m ──
const StatusWord = ({ airingAt, nowS }) => {
  const status = airStatus(airingAt, nowS);
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white shadow-[0_0_8px_#fff]" />
        Live
      </span>
    );
  }
  if (status === "upcoming") {
    return <span className="text-[10px] font-bold tracking-wide text-zinc-300">{formatCountdown(airingAt, nowS)}</span>;
  }
  return <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Aired</span>;
};

// ── One timeline card: cover · title / EP · time block, banner faded behind ──
const EpisodeCard = ({ item, nowS, busy, onOpen }) => {
  const { media } = item;
  const status = airStatus(item.airingAt, nowS);
  const title = displayTitle(media);
  const banner = media.bannerImage || null;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      disabled={busy}
      aria-busy={busy || undefined}
      title={`${title} — Episode ${item.episode}`}
      className={`group relative flex w-full items-center overflow-hidden rounded-2xl border text-left transition-all duration-300 active:scale-[0.99] disabled:cursor-wait ${
        status === "live"
          ? "border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.08)]"
          : status === "aired"
          ? "border-white/[0.06] hover:border-white/20"
          : "border-white/10 hover:border-white/30"
      }`}
    >
      {/* Banner art, desaturated & faded like the reference */}
      <div className="absolute inset-0 bg-[var(--gtv-surface)]">
        {banner && (
          <img
            src={banner}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover object-right grayscale transition-transform duration-700 group-hover:scale-105 ${
              status === "aired" ? "opacity-[0.18]" : "opacity-30"
            }`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/40" />
      </div>

      <div className="relative flex w-full items-center gap-4 p-3 sm:p-3.5">
        <div className="relative h-[72px] w-[54px] shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-white/10 shadow-lg">
          <MediaImage
            src={media.coverImage?.large || null}
            alt={title}
            title={title}
            compact
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className={`line-clamp-2 font-display text-[15px] font-bold leading-snug ${status === "aired" ? "text-zinc-200" : "text-white"}`}>
            {title}
          </h3>
          <span className="text-[12px] font-semibold tracking-wide text-zinc-400">EP {item.episode}</span>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-center border-l border-white/10 pl-4 pr-1">
          <span className={`font-display text-[22px] font-black leading-none tabular-nums ${status === "aired" ? "text-zinc-300" : "text-white"}`}>
            {clock(item.airingAt)}
          </span>
          <span className="mt-1.5">
            <StatusWord airingAt={item.airingAt} nowS={nowS} />
          </span>
        </div>
      </div>
    </button>
  );
};

// ── "Recently aired" strip card ──
const RecentCard = ({ item, busy, onOpen }) => {
  const { media } = item;
  const title = displayTitle(media);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      disabled={busy}
      title={`${title} — Episode ${item.episode}`}
      className="group relative flex h-[104px] w-[300px] shrink-0 snap-start items-center overflow-hidden rounded-2xl border border-white/10 text-left transition hover:border-white/30 active:scale-[0.99] sm:w-auto sm:flex-1"
    >
      <div className="absolute inset-0 bg-[var(--gtv-surface)]">
        {media.bannerImage && (
          <img src={media.bannerImage} alt="" aria-hidden="true" loading="lazy" decoding="async"
            className="h-full w-full object-cover object-right opacity-30 grayscale transition-transform duration-700 group-hover:scale-105" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/30" />
      </div>
      <div className="relative flex items-center gap-4 p-3">
        <div className="relative h-[76px] w-[56px] shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 shadow-lg">
          <MediaImage src={media.coverImage?.large || null} alt={title} title={title} compact loading="lazy" decoding="async" className="h-full w-full object-cover" />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="line-clamp-2 font-display text-[15px] font-bold leading-snug text-white">{title}</h3>
          <span className="text-[12px] font-semibold text-zinc-400">EP {item.episode}</span>
        </div>
      </div>
    </button>
  );
};

// ── Skeletons ──
const SkeletonCard = () => (
  <div className="flex h-[96px] items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-3">
    <div className="h-[72px] w-[54px] shrink-0 animate-pulse rounded-lg bg-white/10" />
    <div className="flex flex-1 flex-col gap-2">
      <div className="h-3.5 w-3/5 animate-pulse rounded bg-white/10" />
      <div className="h-3 w-1/4 animate-pulse rounded bg-white/10" />
    </div>
    <div className="flex flex-col items-end gap-2 pl-4">
      <div className="h-5 w-14 animate-pulse rounded bg-white/10" />
      <div className="h-2.5 w-10 animate-pulse rounded bg-white/10" />
    </div>
  </div>
);

const SkeletonTimeline = () => (
  <div className="flex flex-col gap-8">
    {[0, 1, 2].map((g) => (
      <div key={g} className="relative pl-9">
        <span className="absolute left-0 top-1 h-3 w-3 rounded-full bg-white/30" />
        <div className="mb-4 h-5 w-20 animate-pulse rounded bg-white/10" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard />
          {g === 1 && <SkeletonCard />}
        </div>
      </div>
    ))}
  </div>
);

const Schedule = () => {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0); // weeks from the current local week
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));
  const [reloadTick, setReloadTick] = useState(0);
  const tabsRef = useRef(null);

  const week = useMemo(() => getLocalWeek(offset), [offset]);
  const today = useMemo(() => new Date(), []);
  const todayIdx = useMemo(() => week.days.findIndex((d) => isSameLocalDay(d, today)), [week, today]);
  const [activeDay, setActiveDay] = useState(() => Math.max(0, todayIdx));

  // Selected day: today when the current week is shown, else Monday.
  useEffect(() => {
    setActiveDay(todayIdx >= 0 ? todayIdx : 0);
  }, [todayIdx, offset]);

  // Keep the active tab visible in the horizontally scrolling tab row.
  useEffect(() => {
    const el = tabsRef.current?.querySelector(`[data-day="${activeDay}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeDay]);

  // Countdown / LIVE words tick once a minute.
  useEffect(() => {
    const id = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchWeekSchedule(week.start, week.end, { signal });
        if (signal?.aborted) return;
        setItems(data);
      } catch (err) {
        if (signal?.aborted || err?.name === "AbortError") return;
        setItems(null);
        setError(err?.message || "Schedule unavailable");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [week.start, week.end]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, reloadTick]);

  const retry = () => setReloadTick((t) => t + 1);

  const buckets = useMemo(() => groupByLocalDay(items || [], week.days), [items, week.days]);
  const total = items ? items.length : 0;
  const hourGroups = useMemo(() => groupByHour(buckets[activeDay] || []), [buckets, activeDay]);

  // Recently aired: the latest already-aired episodes in this week, newest first.
  const recent = useMemo(() => {
    if (!items) return [];
    return items
      .filter((it) => it.airingAt <= nowS)
      .sort((a, b) => b.airingAt - a.airingAt)
      .slice(0, 3);
  }, [items, nowS]);

  // Click → resolve TMDB on demand, else graceful search fallback.
  // Episodes that already aired (or are airing NOW) go straight to the
  // player; upcoming episodes still open the details page, as before.
  // The `anilist` anchor (the airing AniList entry) lets the player land on
  // the right UI season — the schedule only knows the entry + global
  // episode, and the player already loads the AniList chain in anime mode.
  const openItem = async (item) => {
    if (busyId) return;
    setBusyId(item.id);
    const title = displayTitle(item.media);
    try {
      const tmdbId = await resolveTmdbId(item.media);
      if (tmdbId && item.airingAt <= nowS) {
        const isMovie = item.media?.format === "MOVIE";
        if (isMovie || (Number.isInteger(item.episode) && item.episode > 0)) {
          const params = new URLSearchParams({ id: String(tmdbId), type: isMovie ? "movie" : "tv" });
          if (!isMovie) {
            params.set("season", "1");
            params.set("episode", String(item.episode));
            if (item.media?.id) params.set("anilist", String(item.media.id));
          }
          navigate(`/player?${params.toString()}`);
          return;
        }
      }
      navigate(tmdbId ? `/tv/details/${tmdbId}` : `/search?q=${encodeURIComponent(title)}`);
    } catch {
      navigate(`/search?q=${encodeURIComponent(title)}`);
    } finally {
      setBusyId(null);
    }
  };

  const initialLoading = loading && !items;

  return (
    <div className="flex w-full min-h-screen flex-col bg-[var(--gtv-bg)] select-none">
      <Topnav />

      <div className="flex-1 flex flex-col gap-6 px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 pt-6 pb-28 sm:pb-24">
        {/* Header: title + week nav */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="section-rule font-display text-2xl sm:text-3xl font-bold text-white">Anime Schedule</h1>
            <p className="pl-[calc(0.9rem+3px)] text-xs text-zinc-500">
              {formatWeekRange(week.days)}
              {" · "}
              {initialLoading ? "loading…" : `${total} episode${total === 1 ? "" : "s"}`}
              {" · "}
              times shown in your timezone
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white active:scale-95">
              <i className="ri-arrow-left-s-line text-lg" />
            </button>
            <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}
              className={`h-11 min-w-[7.5rem] rounded-full border px-4 text-xs font-bold transition active:scale-95 ${
                offset === 0 ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
              }`}>
              {offset === 0 ? "This Week" : offset === 1 ? "Next Week" : offset === -1 ? "Last Week" : formatWeekRange(week.days)}
            </button>
            <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Next week"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white active:scale-95">
              <i className="ri-arrow-right-s-line text-lg" />
            </button>
          </div>
        </div>

        {/* Soft error state */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
              <i className="ri-cloud-off-line text-2xl text-zinc-400" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-lg font-bold text-white">Couldn't load the schedule</h2>
              <p className="max-w-sm text-xs leading-relaxed text-zinc-500">The schedule service is unreachable right now. This is usually temporary.</p>
            </div>
            <button type="button" onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black transition hover:bg-zinc-200 active:scale-95">
              <i className="ri-refresh-line" /> Retry
            </button>
          </div>
        )}

        {/* Empty week */}
        {!error && !loading && items && total === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
            <i className="ri-calendar-2-line text-3xl text-zinc-600" />
            <h2 className="font-display text-lg font-bold text-white">Nothing scheduled this week</h2>
            <p className="max-w-sm text-xs leading-relaxed text-zinc-500">AniList hasn't listed any airing episodes between these dates yet. Try another week.</p>
          </div>
        )}

        {!error && (loading || total > 0) && (
          <>
            {/* ● RECENTLY AIRED */}
            {(initialLoading || recent.length > 0) && (
              <section aria-label="Recently aired" className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">
                  <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_8px_#fff]" />
                  Recently Aired
                </h2>
                <ScrollRow label="recently aired" className="gtv-no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                  {initialLoading
                    ? [0, 1, 2].map((i) => <div key={i} className="h-[104px] w-[300px] shrink-0 animate-pulse rounded-2xl bg-white/[0.05] sm:w-auto sm:flex-1" />)
                    : recent.map((it) => <RecentCard key={`r-${it.id}`} item={it} busy={busyId === it.id} onOpen={openItem} />)}
                </ScrollRow>
              </section>
            )}

            {/* Day tabs — SUNDAY MONDAY … with the date under the active one */}
            <div ref={tabsRef} role="tablist" aria-label="Day of week"
              className="gtv-no-scrollbar sticky top-[calc(var(--domain-banner-h,0px)+53px)] z-[90] -mx-4 flex items-start gap-6 overflow-x-auto bg-[var(--gtv-bg)]/90 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:gap-8 sm:px-0 lg:justify-between">
              {week.days.map((d, i) => {
                const active = i === activeDay;
                const isToday = i === todayIdx;
                return (
                  <button key={i} type="button" role="tab" data-day={i} aria-selected={active} onClick={() => setActiveDay(i)}
                    className="group flex shrink-0 flex-col items-center gap-1 outline-none active:scale-95">
                    <span className={`font-display text-2xl font-black uppercase tracking-tight transition-colors sm:text-3xl lg:text-[28px] xl:text-3xl ${
                      active ? "text-white" : "text-zinc-600 group-hover:text-zinc-400"
                    }`}>
                      <span className="sm:hidden">{DAY_LABELS_SHORT[i]}</span>
                      <span className="hidden sm:inline">{DAY_LABELS[i]}</span>
                    </span>
                    <span className={`h-4 text-[10px] font-bold uppercase tracking-[0.25em] transition-opacity ${
                      active ? "text-zinc-400 opacity-100" : "opacity-0"
                    }`}>
                      {longDate(d)}
                      {isToday && active && " · Today"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Timeline rail */}
            <div role="tabpanel" className="relative">
              {initialLoading ? (
                <SkeletonTimeline />
              ) : hourGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-3 py-14 text-center">
                  <i className="ri-moon-clear-line text-2xl text-zinc-600" />
                  <p className="text-xs font-medium text-zinc-500">Nothing airing on {activeDay === todayIdx ? "today" : DAY_LABELS[activeDay]}</p>
                </div>
              ) : (
                <div className="relative flex flex-col gap-10 pl-9">
                  {/* vertical line */}
                  <span aria-hidden="true" className="absolute bottom-2 left-[5px] top-2 w-px bg-white/15" />
                  {hourGroups.map((g) => (
                    <section key={g.hour} aria-label={g.label} className="relative">
                      <span aria-hidden="true" className="absolute -left-9 top-1.5 h-3 w-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]" />
                      <h3 className="mb-4 flex items-center gap-2 font-display text-xl font-bold tabular-nums text-zinc-400">
                        <i className="ri-arrow-right-s-line text-lg text-zinc-500" />
                        {g.label}
                      </h3>
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        {g.items.map((it) => (
                          <EpisodeCard key={it.id} item={it} nowS={nowS} busy={busyId === it.id} onOpen={openItem} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default Schedule;
