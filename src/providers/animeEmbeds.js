// Anime streaming lanes shared by the player and the server selector.
//
// Iris resolves an AniList entry for the selected UI season and keeps the
// episode number local to that entry. The three hosts below use that same
// {source, id, episode} contract. Keeping URL construction here prevents the
// UI from showing Sub/Dub buttons that are not backed by a real reference.

const MEGAPLAY_BASE = "https://megaplay.buzz/stream";
const ZOKO_BASE = "https://zokoanime.video/stream";
const ANIMO_BASE = "https://cdn.4animo.xyz/embed/hd-3";

export const NARUTO_SHIPPUDEN_ANILIST_ID = "1735";
export const NARUTO_SHIPPUDEN_TMDB_ID = 31910;

// MegaPlay's MAL mapping is more reliable than its AniList mapping for the
// five Demon Slayer TV arcs. TMDB seasons align one-to-one with these MAL
// entries, so this carve-out preserves Sub and Dub across every arc.
export const DEMON_SLAYER_MAL_IDS = {
  1: 38000,
  2: 49926,
  3: 47778,
  4: 51019,
  5: 55701,
};
export const DEMON_SLAYER_TMDB_ID = 85937;

const numericId = (value) => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? String(Math.trunc(id)) : null;
};

/**
 * Build all Anime Sub/Dub lanes for one AniList/MAL-style reference.
 *
 * Server 1: MegaPlay (primary HD-1)
 * Server 2: ZokoAnime (HD-2 backup)
 * Server 3: 4animo (HD-3 backup)
 */
export function buildAnimeEmbeds({ source = "ani", id, episode } = {}) {
  const animeId = numericId(id);
  const ep = Number(episode);
  if (!["ani", "mal"].includes(source) || !animeId || !Number.isFinite(ep) || ep < 1) return null;

  const mega = `${MEGAPLAY_BASE}/${source}/${animeId}/${Math.trunc(ep)}`;
  const zoko = `${ZOKO_BASE}/${source}/${animeId}/${Math.trunc(ep)}`;
  const animo = `${ANIMO_BASE}/${source}/${animeId}/${Math.trunc(ep)}`;

  return {
    sub: `${mega}/sub?autoplay=true`,
    dub: `${mega}/dub?autoplay=true`,
    sub2: `${zoko}/sub`,
    dub2: `${zoko}/dub`,
    sub3: `${animo}/sub?k=1&autoplay=1`,
    dub3: `${animo}/dub?k=1&autoplay=1`,
  };
}

/** The verified TMDB → AniList carve-out used when AniList metadata is down. */
export function buildAnimeEmbedsFromTmdb({ tmdbId, episode } = {}) {
  if (Number(tmdbId) !== NARUTO_SHIPPUDEN_TMDB_ID) return null;
  return buildAnimeEmbeds({
    source: "ani",
    id: NARUTO_SHIPPUDEN_ANILIST_ID,
    episode,
  });
}

/**
 * Resolve the AniList entry for a UI season. `fetchIrisSeasonData` returns
 * seasonIds in the same shape as Iris's current player: { "1": id, ... }.
 * This intentionally does not guess an id from a title when the bridge is
 * unavailable; showing a dead lane is worse than leaving it out.
 */
export function resolveAnimeEmbeds({ metadata, uiSeason = 1, uiEpisode = 1, tmdbId } = {}) {
  const season = String(Number(uiSeason) || 1);
  const episode = Number(uiEpisode) || 1;
  if (Number(tmdbId) === DEMON_SLAYER_TMDB_ID) {
    const malId = DEMON_SLAYER_MAL_IDS[Number(season)];
    const embeds = buildAnimeEmbeds({ source: "mal", id: malId, episode });
    if (embeds) return { embeds, source: "mal", id: String(malId), episode };
  }
  const seasonIds = metadata?.seasonIds || metadata?.season_ids || {};
  const seasonRecord = metadata?.seasons?.find(
    (item) => Number(item?.season_number) === Number(season),
  );
  const segments = metadata?.segments?.[season] || metadata?.segments?.[Number(season)] || [];
  const segment = segments.find((item) => {
    const start = Number(item?.start) || 1;
    const count = Number(item?.count) || 0;
    return episode >= start && episode < start + count;
  });
  const anilistId =
    segment?.id ||
    seasonIds[season] ||
    seasonIds[Number(season)] ||
    seasonRecord?.anilist_id ||
    (Number(season) === 1 ? metadata?.anilistId : null);
  const mappedEpisode = segment
    ? episode - (Number(segment.start) || 1) + 1
    : episode;

  if (anilistId) {
    const embeds = buildAnimeEmbeds({ source: "ani", id: anilistId, episode: mappedEpisode });
    if (embeds) return { embeds, source: "ani", id: String(anilistId), episode: mappedEpisode };
  }

  const fallback = buildAnimeEmbedsFromTmdb({ tmdbId, episode });
  return fallback
    ? { embeds: fallback, source: "ani", id: NARUTO_SHIPPUDEN_ANILIST_ID, episode }
    : null;
}

const directSource = (id, name, quality, url) => ({
  id,
  name,
  quality,
  audioOptions: null,
  url: () => url,
});

/** Convert resolved embeds into the source shape consumed by FumioPlayerStage. */
export function buildAnimeSources({ embeds } = {}) {
  if (!embeds) return [];
  return [
    directSource("sub", "Anime Sub", "HD • Sub", embeds.sub),
    directSource("dub", "Anime Dub", "HD • Dub", embeds.dub),
    directSource("sub2", "Anime Sub 2", "HD-2 • Sub", embeds.sub2),
    directSource("dub2", "Anime Dub 2", "HD-2 • Dub", embeds.dub2),
    directSource("sub3", "Anime Sub 3", "HD-3 • Sub", embeds.sub3),
    directSource("dub3", "Anime Dub 3", "HD-3 • Dub", embeds.dub3),
  ].filter((source) => source.url());
}
