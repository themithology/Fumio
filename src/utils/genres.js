// ─── genres.js ──────────────────────────────────────────────────────────────
// TMDB genre ids are MEDIA-TYPE-SPECIFIC: 878 is "Sci-Fi" for a movie but does
// not exist for TV (which uses 10765 "Sci-Fi & Fantasy"), 10751 is "Family" for
// both, 10762 "Kids" is TV-only, 10770 "TV Movie" is movie-only. A single flat
// map therefore cannot label a genre chip correctly — sending a TV title's
// Family chip to the movie catalogue, or rendering 10765 as "Featured", are
// both failures waiting to happen.
//
// So: one source of truth per media type, shared by the browse hubs (page
// titles for ?genre= URLs) and the details pages (the clickable chips in the
// hero meta line). Adding a genre means editing exactly one map here.

/** TMDB movie genres (https://api.themoviedb.org/3/genre/movie/list). */
export const MOVIE_GENRES = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

/** TMDB TV genres (https://api.themoviedb.org/3/genre/tv/list). Shares some
    ids with movies but adds TV-only ones — look up by the title's media type,
    never by id alone. */
export const TV_GENRES = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western",
};

const mapFor = (type) => (type === "tv" ? TV_GENRES : MOVIE_GENRES);

/** Display name for a genre id of a given media type ("movie" | "tv"). */
export function genreName(id, type) {
  const name = mapFor(type)[id];
  return name || null;
}

/** Display name for an id of EITHER media type — for mixed catalogues
    (/explore shows movies and shows side by side) where the title has no
    single media type. Movie labels win on the ids the two maps share. */
export function genreNameAny(id) {
  return MOVIE_GENRES[id] || TV_GENRES[id] || null;
}

/** The browse URL a genre chip on a title page should lead to: the catalogue
    for THAT media type, filtered to the genre. /movie and /tv are the two hubs
    that read ?genre= and render the filtered grid. */
export function genrePath(id, type) {
  return `${type === "tv" ? "/tv" : "/movie"}?genre=${id}`;
}

/** The hub a media type belongs to — where the "Movie" / "Series" chip goes. */
export function mediaTypePath(type) {
  return type === "tv" ? "/tv" : "/movie";
}

/** The IMDb page of a title, or null when TMDB has no IMDb id for it. Callers
    use the null to render the rating as plain text instead of a dead link. */
export function imdbTitleUrl(imdbId) {
  const id = String(imdbId || "").trim();
  return /^tt\d+$/.test(id) ? `https://www.imdb.com/title/${id}/` : null;
}
