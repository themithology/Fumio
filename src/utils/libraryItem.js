/** Fold website / SQLite copies into the shape Home and the player already use. */
export const coerceLibraryItem = (item) => {
  if (!item || typeof item !== "object") return null;
  const id = Number(item.id ?? item.tmdbId ?? item.tmdb_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const rawType = String(item.type || item.media_type || item.mediaType || "").toLowerCase();
  const type =
    rawType === "tv" || rawType === "anime" || rawType === "series"
      ? "tv"
      : rawType === "movie"
        ? "movie"
        : item.name && !item.title
          ? "tv"
          : "movie";
  return {
    ...item,
    id,
    type,
    media_type: item.media_type || type,
    poster_path: item.poster_path || item.posterPath || null,
    backdrop_path: item.backdrop_path || item.backdropPath || null,
  };
};

export const coerceLibraryList = (list) =>
  (Array.isArray(list) ? list : []).map(coerceLibraryItem).filter(Boolean);
