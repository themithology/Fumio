// ─── watchProgress.js — real "time left" for Continue Watching ───────────────
//
// Owner, 2026-09-27: "In continue watching why don't we show the time? If we
// know where the user left off it's possible … make sure continue watching
// timing is also stored in cloud save".
//
// Playback happens inside third-party iframes we cannot read. But several of
// the hosts TELL the embedding page where playback is, via window.postMessage:
//
//   MegaPlay (Sub/Dub)      { event: "time", time, duration, percent }
//                           { type: "watching-log", currentTime, duration }
//   ZokoAnime (Sub2/Dub2)   progress events (same player family)
//   VidFast                 { type: "PLAYER_EVENT", data: { event, currentTime, duration } }
//   vidstuck (Videasy API)  '{"type":"movie","progress":42,"timestamp":1234,"duration":2900}'
//
// Formats differ and are not always documented, so this module reads ANY of
// the common shapes and refuses anything that does not look like a sane
// position. Servers that never post simply keep no time — the card then shows
// no time rather than a made-up one.
//
// Identity is the second half of the contract. Several provider families put
// the season/episode they are ACTUALLY playing in the same payload:
//
//   VidLink family   { type: "PLAYER_EVENT", data: { event, currentTime,
//                      duration, mtmdbId, mediaType, season, episode } }
//   VidAPI family    { type: "PLAYER_EVENT", data: { player_info: { season,
//                      episode, mediaType }, player_progress, player_duration } }
//   VidPop family    { type: "videoProgress", data: { season, episode,
//                      timestamp, duration } }
//
// When a player switches episode with ITS OWN controls (its episode selector,
// its own autoplay), the page's URL would otherwise keep pointing at the old
// episode — the episode grid, the Continue Watching entry and the resume
// position all went stale (owner-reported, 2026-10-05). `parseReportedEpisode`
// reads that identity and `resolveReportedEpisode` decides whether the page
// should follow it; the caller then moves the URL, which updates everything.
//
// Pure: no DOM, no storage, so tests/watch-progress.test.mjs drives it directly.

/** Below this, a resume is pointless (the intro is still playing). */
export const MIN_RESUME_SECONDS = 30;
/** At or past this share of the runtime a title counts as watched. */
export const FINISHED_RATIO = 0.95;
/** Nothing we play is longer than this; a bigger "duration" is junk. */
export const MAX_DURATION_SECONDS = 6 * 60 * 60;

const num = (value) => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
};

const firstNumber = (obj, keys) => {
  for (const key of keys) {
    const n = num(obj?.[key]);
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
};

const ENDED_WORDS = new Set(["ended", "complete", "completed", "finish", "finished"]);

/**
 * Read a postMessage payload. Returns `{ currentTime, duration, ended }` in
 * seconds, or null when the message is not a playback position.
 */
export const parseProgressMessage = (raw) => {
  let data = raw;
  if (typeof data === "string") {
    if (data.length > 20000 || !/^\s*[[{]/.test(data)) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;

  // Wrapped shapes put the numbers one level down ({ type, data: {...} }).
  const inner = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : null;
  const candidates = inner ? [inner, data] : [data];

  for (const obj of candidates) {
    const duration = firstNumber(obj, ["duration", "player_duration", "totalTime", "total"]);
    if (!(duration > 0) || duration > MAX_DURATION_SECONDS) continue;

    let current = firstNumber(obj, ["currentTime", "current_time", "time", "position", "player_progress", "watched"]);
    // Videasy-style: `timestamp` is the position in seconds (an epoch value in
    // milliseconds is far bigger than any duration and fails the range check).
    if (Number.isNaN(current)) {
      const stamp = num(obj.timestamp);
      if (!Number.isNaN(stamp) && stamp >= 0 && stamp <= duration * 1.02) current = stamp;
    }
    // Last resort: a percentage.
    if (Number.isNaN(current)) {
      const percent = firstNumber(obj, ["percent", "percentage", "progress"]);
      if (percent >= 0 && percent <= 100) current = (percent / 100) * duration;
    }
    if (Number.isNaN(current) || current < 0 || current > duration * 1.02) continue;

    const word = String(obj.event || obj.player_status || obj.status || data.event || "").toLowerCase();
    const ended = ENDED_WORDS.has(word);
    return {
      currentTime: ended ? duration : Math.min(current, duration),
      duration,
      ended,
    };
  }
  return null;
};

/** Nothing we play has more episodes in a season than this. */
const MAX_REPORTED_EPISODE = 1000;

const intInRange = (value, minimum) => {
  const n = num(value);
  return Number.isInteger(n) && n >= minimum && n <= MAX_REPORTED_EPISODE ? n : null;
};

/**
 * The season/episode a player says it is playing, from any documented payload
 * shape, or null when the message does not identify an episode.
 * Returns `{ season, episode, mediaType }` — `mediaType` is "tv" / "movie"
 * when the provider states it, else null.
 */
export const parseReportedEpisode = (raw) => {
  let data = raw;
  if (typeof data === "string") {
    if (data.length > 20000 || !/^\s*[[{]/.test(data)) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const inner = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : null;
  const info = inner?.player_info && typeof inner.player_info === "object" ? inner.player_info : null;

  for (const obj of [info, inner, data].filter(Boolean)) {
    const season = intInRange(obj.season ?? obj.season_number ?? obj.seasonNumber, 0);
    const episode = intInRange(obj.episode ?? obj.episode_number ?? obj.episodeNumber, 1);
    if (season === null || episode === null) continue;
    const media = String(obj.mediaType || obj.media_type || obj.type || "").toLowerCase();
    return { season, episode, mediaType: media === "movie" || media === "tv" ? media : null };
  }
  return null;
};

const samePair = (a, b) => a.season === b.season && a.episode === b.episode;

/**
 * Decide whether a player-reported identity means the PAGE should move to a
 * different episode — and to which one. Pure: the component supplies the
 * context, this returns `{ season, episode }` or null.
 *
 * `context`:
 *   urlSeason / urlEpisode   the numbers in our address bar (display numbers)
 *   bridged                  true when the iframe was handed DIFFERENT numbers
 *                            than the URL shows (the anime season map)
 *   seasons                  TMDB `details.seasons`, when the title has them
 *   candidates               [{ season, episode, playerSeason, playerEpisode }]
 *                            for the current / next / previous episode, where
 *                            `player*` is the pair that iframe actually got.
 *
 * Trust rules, deliberately conservative:
 *   * Movies are never "changed".
 *   * Unbridged lanes (every movie / non-anime title, and anime whose map is
 *     identity): the numbers the player reports ARE our numbers, so any sane
 *     in-range pair is followed — that is the arbitrary jump case.
 *   * Bridged (mapped anime): a reported TMDB pair can only be translated back
 *     when it is one we handed out (current / next / previous). A bigger jump
 *     has no reverse mapping — leave the URL alone rather than guess.
 *   * Metadata guard: never move to a season the title does not have, or past
 *     the end of the season.
 */
export const resolveReportedEpisode = (reported, context) => {
  if (!reported || !context || reported.mediaType === "movie") return null;
  const current = { season: context.urlSeason, episode: context.urlEpisode };
  if (!Number.isInteger(current.season) || !Number.isInteger(current.episode)) return null;

  const candidates = Array.isArray(context.candidates) ? context.candidates.filter(Boolean) : [];
  const hit = context.bridged
    ? candidates.find((c) => c.playerSeason === reported.season && c.playerEpisode === reported.episode)
    : { season: reported.season, episode: reported.episode };
  if (!hit) return null;
  if (samePair(hit, current)) return null;

  const seasons = Array.isArray(context.seasons) ? context.seasons : null;
  if (seasons && seasons.length) {
    const meta = seasons.find((s) => s && s.season_number === hit.season);
    if (!meta) return null;
    const count = num(meta.episode_count);
    if (Number.isFinite(count) && count > 0 && hit.episode > count) return null;
  }
  return { season: hit.season, episode: hit.episode };
};

/** 83 → "1:23", 3723 → "1:02:03". */
export const formatClock = (seconds) => {
  const s = Math.max(0, Math.floor(num(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** Does this Continue Watching entry carry a REAL position (not an estimate)? */
export const hasRealProgress = (entry) => {
  const p = num(entry?.progress);
  const d = num(entry?.duration);
  return d > 0 && d <= MAX_DURATION_SECONDS && p >= 0 && p <= d * 1.02;
};

/** 0..1 share watched, or 0 when unknown. */
export const progressRatio = (entry) =>
  hasRealProgress(entry) ? Math.min(1, num(entry.progress) / num(entry.duration)) : 0;

/** True once the entry is watched to the end (credits don't count). */
export const isFinished = (entry) => progressRatio(entry) >= FINISHED_RATIO;

/**
 * The short line a card shows: "23m left", "1h 5m left", "Watched", or ""
 * when the position is unknown — never a guess.
 */
export const timeLeftLabel = (entry) => {
  if (!hasRealProgress(entry)) return "";
  if (isFinished(entry)) return "Watched";
  const left = Math.max(60, num(entry.duration) - num(entry.progress));
  const mins = Math.round(left / 60);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
  return `${mins}m left`;
};

/** Where to resume from, in whole seconds, or 0 for "from the start". */
export const resumeSeconds = (entry) => {
  if (!hasRealProgress(entry) || isFinished(entry)) return 0;
  const p = Math.floor(num(entry.progress));
  return p >= MIN_RESUME_SECONDS ? Math.max(0, p - 5) : 0; // 5 s of context
};

/**
 * Verified start-time parameters. Hosts not listed get the URL untouched —
 * an unknown parameter is never guessed at. TG Vid's t= comes from a link
 * produced by the player itself, not its incomplete public embed docs.
 *   vidfast  → startAt   (vidfast.vc docs)
 *   sub2/dub2 (ZokoAnime) → time (zokoanime.video/docs)
 *   vidstuck → progress  (Videasy-compatible parameter set)
 *   tgvid    → t         (TG Vid's own Settings → Playback → Copy Link at
 *                        Current Time produces /embed/...?...&t=1380,
 *                        verified with a real link from the owner, 2026-10-09)
 */
export const RESUME_PARAM_BY_SERVER = {
  vidfast: "startAt",
  sub2: "time",
  dub2: "time",
  vidstuck: "progress",
  tgvid: "t",
};

export const withResumeParam = (url, serverKey, seconds) => {
  const param = RESUME_PARAM_BY_SERVER[serverKey];
  const s = Math.floor(num(seconds) || 0);
  if (!url || !param || s < MIN_RESUME_SECONDS) return url;
  try {
    const u = new URL(url);
    u.searchParams.set(param, String(s));
    return u.toString();
  } catch {
    return url;
  }
};
