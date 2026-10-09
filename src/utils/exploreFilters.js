// ─── exploreFilters.js ──────────────────────────────────────────────────────
// The decisions behind /explore's filter bar, kept pure so they can be tested
// without a browser or a TMDB key.
//
// /explore used to be a URL-only page: Home's pills and the anime hub deep-
// linked into it with ?genre= / ?lang= / ?sort_by=, but a visitor who landed
// there had no way to change anything. This module is what lets the page grow
// real controls (genre, year, country, language, type, sort) WITHOUT breaking
// any of those existing links — every legacy param still parses.
//
// Two TMDB facts drive most of the shape here:
//
//  1. Genre ids are media-type-specific. 28 is "Action" for a movie and does
//     not exist for TV, which uses 10759 "Action & Adventure"; 878 "Sci-Fi"
//     becomes 10765 "Sci-Fi & Fantasy". A mixed movie+TV catalogue therefore
//     cannot send one id to both endpoints — it needs a PAIR per genre, and
//     has to skip the endpoint that has no equivalent (TV has no Horror
//     genre at all, so "Horror" is a movies-only browse).
//  2. The date field is named differently per type: movies filter on
//     primary_release_date, TV on first_air_date.
//
// Everything below is data + pure functions; Explore.jsx only renders it.

import { genreName } from "./genres.js";

/** Sort keys TMDB accepts, per media type (they are NOT the same list). */
export const DEFAULT_SORT = "popularity.desc";

const SORT_MOVIE_ALLOWED = new Set([
  "popularity.desc", "popularity.asc",
  "vote_average.desc", "vote_average.asc",
  "release_date.desc", "release_date.asc",
  "original_title.asc", "original_title.desc",
]);
const SORT_TV_ALLOWED = new Set([
  "popularity.desc", "popularity.asc",
  "vote_average.desc", "vote_average.asc",
  "first_air_date.desc", "first_air_date.asc",
]);

/** The sorts offered in the UI, in menu order. */
export const SORT_OPTIONS = [
  { value: "popularity.desc", label: "Most popular" },
  { value: "vote_average.desc", label: "Highest rated" },
  { value: "release_date.desc", label: "Newest first" },
  { value: "release_date.asc", label: "Oldest first" },
];

/**
 * Translate a requested sort into one THIS media type actually accepts.
 * TV has no `release_date`, movies have no `first_air_date`, so "Newest
 * first" has to be rewritten rather than rejected — otherwise picking it
 * would silently drop every show out of a mixed catalogue.
 */
export function sortFor(requested, mediaType) {
  if (!requested) return DEFAULT_SORT;
  if (mediaType === "tv") {
    const key = String(requested).startsWith("release_date.")
      ? String(requested).replace("release_date.", "first_air_date.")
      : String(requested);
    return SORT_TV_ALLOWED.has(key) ? key : DEFAULT_SORT;
  }
  const key = String(requested).startsWith("first_air_date.")
    ? String(requested).replace("first_air_date.", "release_date.")
    : String(requested);
  return SORT_MOVIE_ALLOWED.has(key) ? key : DEFAULT_SORT;
}

/** Client-side merge order for the mixed movie+TV list. */
export function comparatorFor(sortKey) {
  const [field, dir] = String(sortKey).split(".");
  const sign = dir === "asc" ? 1 : -1;
  if (field === "vote_average") {
    return (a, b) => sign * ((a.vote_average || 0) - (b.vote_average || 0));
  }
  if (field === "release_date" || field === "first_air_date") {
    const dateOf = (i) => i.release_date || i.first_air_date || "";
    return (a, b) => sign * dateOf(a).localeCompare(dateOf(b));
  }
  return (a, b) => sign * ((a.popularity || 0) - (b.popularity || 0));
}

/**
 * Browse genres: one row per human-meaningful genre, carrying the id each
 * media type uses for it. `null` means that type has no equivalent and must
 * be left out of the request entirely.
 *
 * This table owns ONLY the pairing — the display NAMES come from
 * utils/genres.js, which is the single source of truth every browse hub and
 * details-page chip already reads. A second hard-coded list of genre labels
 * here is exactly the drift that map was created to prevent.
 */
const GENRE_PAIRS = [
  { slug: "action", movie: 28, tv: 10759 },
  { slug: "adventure", movie: 12, tv: 10759 },
  { slug: "animation", movie: 16, tv: 16 },
  { slug: "comedy", movie: 35, tv: 35 },
  { slug: "crime", movie: 80, tv: 80 },
  { slug: "documentary", movie: 99, tv: 99 },
  { slug: "drama", movie: 18, tv: 18 },
  { slug: "family", movie: 10751, tv: 10751 },
  { slug: "fantasy", movie: 14, tv: 10765 },
  { slug: "history", movie: 36, tv: null },
  { slug: "horror", movie: 27, tv: null },
  { slug: "kids", movie: null, tv: 10762 },
  { slug: "music", movie: 10402, tv: null },
  { slug: "mystery", movie: 9648, tv: 9648 },
  { slug: "reality", movie: null, tv: 10764 },
  { slug: "romance", movie: 10749, tv: null },
  { slug: "sci-fi", movie: 878, tv: 10765 },
  { slug: "thriller", movie: 53, tv: null },
  { slug: "war", movie: 10752, tv: 10768 },
  { slug: "western", movie: 37, tv: 37 },
];

/** Genres as the UI needs them: pairing + a label resolved from genres.js.
    The movie name wins where both exist, because it is the shorter, more
    recognisable half of each pair ("Action", not "Action & Adventure"). */
export const BROWSE_GENRES = GENRE_PAIRS.map((g) => ({
  ...g,
  label:
    (g.movie !== null ? genreName(g.movie, "movie") : null) ||
    (g.tv !== null ? genreName(g.tv, "tv") : null) ||
    g.slug,
}));

/** Origin countries (ISO 3166-1), for TMDB's with_origin_country. */
export const COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "IN", label: "India" },
  { code: "KR", label: "South Korea" },
  { code: "JP", label: "Japan" },
  { code: "CN", label: "China" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
  { code: "TR", label: "Turkey" },
  { code: "TH", label: "Thailand" },
  { code: "SE", label: "Sweden" },
  { code: "NG", label: "Nigeria" },
];

/** Original languages (ISO 639-1), for TMDB's with_original_language. Kept as
    its own control because the site's existing deep links use it — and because
    it is not the same question as country (a Hindi film can be a UK
    production). */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "ml", label: "Malayalam" },
  { code: "kn", label: "Kannada" },
  { code: "bn", label: "Bengali" },
  { code: "mr", label: "Marathi" },
  { code: "pa", label: "Punjabi" },
  { code: "ko", label: "Korean" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "th", label: "Thai" },
];

export const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "Series" },
];

/**
 * Year menu: every year of the CURRENT decade individually, then whole
 * decades going back. Cutting over at the decade boundary is what keeps the
 * two halves from overlapping — a flat "last 8 years, then decades" list
 * would offer both "2019" and "2010s", which select the same titles by two
 * different names.
 */
export function yearOptions(now = new Date()) {
  const current = now.getFullYear();
  const decadeStart = Math.floor(current / 10) * 10;
  const singles = [];
  for (let y = current; y >= decadeStart; y -= 1) {
    singles.push({ value: String(y), label: String(y) });
  }
  const decades = [];
  for (let d = decadeStart - 10; d >= 1950; d -= 10) {
    decades.push({ value: `${d}s`, label: `${d}s` });
  }
  return [...singles, ...decades];
}

/** A year token ("2024" or "1990s") to an inclusive date range, or null. */
export function yearRange(token) {
  const raw = String(token || "").trim();
  if (/^\d{4}$/.test(raw)) {
    const y = Number(raw);
    if (y < 1900 || y > 2100) return null;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: raw };
  }
  if (/^\d{4}s$/.test(raw)) {
    const start = Number(raw.slice(0, 4));
    if (start % 10 !== 0 || start < 1900 || start > 2100) return null;
    return { from: `${start}-01-01`, to: `${start + 9}-12-31`, label: raw };
  }
  return null;
}

const genreBySlug = (slug) =>
  BROWSE_GENRES.find((g) => g.slug === String(slug).toLowerCase()) || null;

/**
 * Resolve a `genre` param to a browse genre. Accepts a slug ("sci-fi") OR a
 * raw TMDB id, because every existing link in the app uses the id form
 * (/explore?genre=28, ?genre=16&lang=ja, the details-page chips).
 */
export function resolveGenre(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const bySlug = genreBySlug(raw);
  if (bySlug) return bySlug;
  if (/^\d+$/.test(String(raw))) {
    const id = Number(raw);
    return (
      BROWSE_GENRES.find((g) => g.movie === id) ||
      BROWSE_GENRES.find((g) => g.tv === id) ||
      null
    );
  }
  return null;
}

const codeIn = (list, raw, key) => {
  const v = String(raw || "").trim();
  if (!v) return null;
  const hit = list.find((e) => e[key].toLowerCase() === v.toLowerCase());
  return hit ? hit[key] : null;
};

/**
 * Normalise raw URL params into a filter state. Unknown or malformed values
 * are DROPPED rather than passed through — these end up interpolated into a
 * TMDB request, so an unvalidated param is an injection point as well as a
 * guaranteed 422.
 *
 * `get` is anything with a .get(name) method (URLSearchParams) or a plain
 * object, so this is callable from tests without a DOM.
 */
export function parseFilters(source) {
  const get = (k) =>
    source && typeof source.get === "function" ? source.get(k) : (source || {})[k];

  const genre = resolveGenre(get("genre"));
  const typeRaw = String(get("type") || "all").toLowerCase();
  const type = TYPE_OPTIONS.some((t) => t.value === typeRaw) ? typeRaw : "all";
  const year = yearRange(get("year")) ? String(get("year")).trim() : null;
  const sort = sortFor(get("sort_by"), "movie");

  return {
    genre: genre ? genre.slug : null,
    year,
    country: codeIn(COUNTRIES, get("country"), "code"),
    lang: codeIn(LANGUAGES, get("lang"), "code"),
    type,
    sort,
    // Provider links (Home's OTT row) are a preset, not a user-facing filter.
    provider: /^\d+$/.test(String(get("provider") || "")) ? String(get("provider")) : null,
    providerName: get("providerName") || null,
    region: /^[A-Za-z]{2}$/.test(String(get("region") || "")) ? String(get("region")).toUpperCase() : "US",
  };
}

/** Serialise a filter state back to a query string (stable key order). */
export function toQueryString(filters) {
  const f = filters || {};
  const params = [];
  if (f.genre) params.push(["genre", f.genre]);
  if (f.year) params.push(["year", f.year]);
  if (f.country) params.push(["country", f.country]);
  if (f.lang) params.push(["lang", f.lang]);
  if (f.type && f.type !== "all") params.push(["type", f.type]);
  if (f.sort && f.sort !== DEFAULT_SORT) params.push(["sort_by", f.sort]);
  if (f.provider) {
    params.push(["provider", f.provider]);
    if (f.providerName) params.push(["providerName", f.providerName]);
    if (f.region) params.push(["region", f.region]);
  }
  return params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

/** How many user-facing filters are active — drives the "Clear" affordance. */
export function activeFilterCount(filters) {
  const f = filters || {};
  return ["genre", "year", "country", "lang"].filter((k) => f[k]).length +
    (f.type && f.type !== "all" ? 1 : 0) +
    (f.sort && f.sort !== DEFAULT_SORT ? 1 : 0);
}

/**
 * Which endpoints to query. A genre with no equivalent on one side (Horror on
 * TV, Reality on film) must not be sent there — TMDB would happily return a
 * full page of unrelated titles for an unknown genre id.
 */
export function mediaTypesFor(filters) {
  const f = filters || {};
  const wanted = f.type === "movie" ? ["movie"] : f.type === "tv" ? ["tv"] : ["movie", "tv"];
  const g = f.genre ? genreBySlug(f.genre) : null;
  if (!g) return wanted;
  return wanted.filter((t) => g[t] !== null);
}

/** Minimum votes/rating so a browse page never fills with 9-vote obscurities. */
export const VOTE_FLOOR = 50;
export const RATING_FLOOR = 6.0;

/**
 * Build the /discover request for one media type. Returns null when this type
 * is excluded by the current filters, so callers can skip the request rather
 * than fire one they must then throw away.
 */
export function buildDiscoverUrl(mediaType, filters, page = 1) {
  const f = filters || {};
  if (!mediaTypesFor(f).includes(mediaType)) return null;

  const parts = [
    `page=${Math.max(1, Number(page) || 1)}`,
    `sort_by=${sortFor(f.sort, mediaType)}`,
    `vote_count.gte=${VOTE_FLOOR}`,
    `vote_average.gte=${RATING_FLOOR}`,
    "include_adult=false",
  ];

  if (f.provider) {
    parts.push(`with_watch_providers=${f.provider}`, `watch_region=${f.region || "US"}`);
  }

  const g = f.genre ? genreBySlug(f.genre) : null;
  if (g && g[mediaType] !== null) parts.push(`with_genres=${g[mediaType]}`);

  if (f.lang) parts.push(`with_original_language=${f.lang}`);
  if (f.country) parts.push(`with_origin_country=${f.country}`);

  const range = yearRange(f.year);
  if (range) {
    // Movies filter on primary_release_date, TV on first_air_date.
    const field = mediaType === "tv" ? "first_air_date" : "primary_release_date";
    parts.push(`${field}.gte=${range.from}`, `${field}.lte=${range.to}`);
  }

  return `/discover/${mediaType}?${parts.join("&")}`;
}

/** Human page title for the current filters. */
export function titleFor(filters) {
  const f = filters || {};
  if (f.provider) return f.providerName || "Featured Provider";

  const g = f.genre ? genreBySlug(f.genre) : null;
  const country = f.country ? COUNTRIES.find((c) => c.code === f.country) : null;
  const lang = f.lang ? LANGUAGES.find((l) => l.code === f.lang) : null;

  // The two presets the app already links to by name.
  if (g && g.slug === "animation" && f.lang === "ja") return "Anime";
  if (!g && !country && !f.year && lang) {
    if (f.lang === "ko") return "Korean Dramas";
    if (f.lang === "hi") return "Indian Cinema";
  }
  if (!g && !country && !lang && !f.year && f.sort === "vote_average.desc") {
    return "Top Rated";
  }

  const noun = f.type === "movie" ? "Movies" : f.type === "tv" ? "Series" : "Movies & TV";
  const bits = [];
  if (lang && !country) bits.push(lang.label);
  if (country) bits.push(country.label);
  if (g) bits.push(g.label);
  bits.push(noun);
  if (f.year) bits.push(`(${f.year})`);

  const out = bits.join(" ").trim();
  return out === noun ? "Explore" : out;
}
