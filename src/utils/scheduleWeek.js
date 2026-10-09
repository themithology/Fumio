// ─── /schedule pure helpers — local week math, grouping, air status ───
//
// Framework-free on purpose (no axios/edge imports) so the node harness in
// tests/schedule-week.test.mjs can exercise it under several TZ values.
// All calendar math uses the visitor's LOCAL Date so "Monday" is their
// Monday and DST shifts inside a week are honoured.

const DAY_S = 86400;

// ── Local week math ─────────────────────────────────────────────────────────

/** Local midnight of the Monday that starts the week containing `date`. */
export const startOfLocalWeek = (date = new Date()) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  d.setDate(d.getDate() - dow);
  return d;
};

/**
 * Week bounds `offsetWeeks` away from the current local week.
 * @returns {{ start: number, end: number, days: Date[] }} unix-second bounds
 *   (Mon 00:00 → next Mon 00:00, local) plus the seven local day starts.
 */
export const getLocalWeek = (offsetWeeks = 0, now = new Date()) => {
  const monday = startOfLocalWeek(now);
  monday.setDate(monday.getDate() + offsetWeeks * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return {
    start: Math.floor(monday.getTime() / 1000),
    end: Math.floor(nextMonday.getTime() / 1000),
    days,
  };
};

/** Index 0–6 of the local day `airingAt` falls in, or -1 when outside. */
export const dayIndexOf = (airingAt, days) => {
  const t = airingAt * 1000;
  for (let i = days.length - 1; i >= 0; i--) {
    if (t >= days[i].getTime()) {
      // Guard the tail: the last day ends at next Monday 00:00 local.
      if (i === days.length - 1) {
        const end = new Date(days[i]);
        end.setDate(end.getDate() + 1);
        return t < end.getTime() ? i : -1;
      }
      return i;
    }
  }
  return -1;
};

/** Group items into seven per-day buckets, each kept in airing order. */
export const groupByLocalDay = (items, days) => {
  const buckets = days.map(() => []);
  for (const it of items || []) {
    const idx = dayIndexOf(it.airingAt, days);
    if (idx >= 0) buckets[idx].push(it);
  }
  return buckets;
};

export const isSameLocalDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ── Air-status helpers ──────────────────────────────────────────────────────

export const LIVE_WINDOW_S = 60 * 60; // "LIVE" for one hour after airingAt

/** 'upcoming' | 'live' | 'aired' relative to `nowS` (unix seconds). */
export const airStatus = (airingAt, nowS) => {
  if (airingAt > nowS) return "upcoming";
  if (nowS - airingAt < LIVE_WINDOW_S) return "live";
  return "aired";
};

/** "in 5h 12m" / "in 3d 4h" / "in 1m" — human countdown, never negative. */
export const formatCountdown = (airingAt, nowS) => {
  const diff = Math.max(0, airingAt - nowS);
  const d = Math.floor(diff / DAY_S);
  const h = Math.floor((diff % DAY_S) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${Math.max(1, m)}m`;
};

let timeFmt = null;
/** Localised "Fri 9:30 PM" in the visitor's own timezone. */
export const formatAirTime = (airingAt) => {
  if (!timeFmt) {
    timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", weekday: "short" });
  }
  return timeFmt.format(new Date(airingAt * 1000));
};

export const displayTitle = (media) =>
  media?.title?.english || media?.title?.romaji || "Untitled";
