// Ported from Iris src/utils/animeMapping.js — the titles whose VISIBLE
// season/episode grid must follow TMDB, not the AniList sequel chain.
// AniList still loads for embed IDs; only the on-screen grouping changes.
//
//   46260 / 31910 — Naruto + Shippuden: AniList is one giant entry.
//   85937 — Demon Slayer: AniList can skip/fuse Mugen Train (movie vs TV
//     recut) and show four seasons instead of TMDB's correct five arcs.

export const TMDB_SEASON_DISPLAY_IDS = new Set([46260, 31910, 85937]);
export const GLOBAL_EPISODE_IDS = new Set([46260, 31910]);
export const TMDB_EPISODE_DISPLAY_IDS = new Set([94664]);

export const isTmdbSeasonDisplay = (id) => TMDB_SEASON_DISPLAY_IDS.has(Number(id));
export const isGlobalEpisodeNumbering = (id) => GLOBAL_EPISODE_IDS.has(Number(id));
export const isTmdbEpisodeDisplay = (id) => TMDB_EPISODE_DISPLAY_IDS.has(Number(id));
