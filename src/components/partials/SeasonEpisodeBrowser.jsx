// ─── SeasonEpisodeBrowser — THE details-page selector, shared ────────────────
// This is the custom season + episode UI from TvDetails.jsx, extracted
// verbatim (same cards, same classes, same search/sort/range controls) so the
// watch party reuses the site's own selector instead of recreating it. All
// anime/TMDB mapping logic stays where it lives (TvDetails prepares
// `seasons`; the party passes plain TMDB lists) — this component is pure
// presentation: data in, picks out.
//
// Props:
//   seasons          [{ season_number, name, poster_path (full URL | null),
//                        episode_count }]
//   selectedSeason   number
//   onSeasonSelect   (season_number) => void
//   posterFallback   full URL for seasons without their own art (or null)
//   episodes         episode objects (TMDB-native or AniList-enriched)
//   episodesLoading  bool
//   selectedEpisode  number | null
//   onEpisodeClick   (ep) => void
//   stillFallback    full URL for episodes without a still (or null)
//   downloadHrefFor  (epNum) => href — null hides the download button
//                    (the party never shows it)

import React, { useEffect, useRef, useState } from "react";
import MediaImage from "./MediaImage.jsx";
import ScrollRow from "./ScrollRow";

export default function SeasonEpisodeBrowser({
  seasons,
  selectedSeason,
  onSeasonSelect,
  posterFallback = null,
  episodes,
  episodesLoading = false,
  selectedEpisode = null,
  onEpisodeClick,
  startsPlayback = false,
  stillFallback = null,
  downloadHrefFor = null,
  searchResetKey = null,
}) {
  const [episodeSearch, setEpisodeSearch] = useState("");
  const [episodeSort, setEpisodeSort] = useState("asc");
  const [episodeRange, setEpisodeRange] = useState("all");

  // Parity with the pre-extraction details page: switching seasons cleared
  // the episode search box (so a filtered list never hides the new season's
  // episodes). Callers pass the season as searchResetKey; skip the very first
  // mount so a deep link / pre-selected season keeps whatever we start with.
  const firstReset = useRef(true);
  useEffect(() => {
    if (searchResetKey === null) return;
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    setEpisodeSearch("");
  }, [searchResetKey]);

  const eps = Array.isArray(episodes) ? episodes : [];
  const episodeQuery = episodeSearch.trim().toLowerCase();
  const rangeStart = episodeRange === "all" ? 1 : Number(episodeRange);
  const visibleEpisodes = [...eps]
    .filter((ep) => !episodeQuery || String(ep.episode_number).includes(episodeQuery) || (ep.name && ep.name.toLowerCase().includes(episodeQuery)))
    .filter((ep) => episodeRange === "all" || (ep.episode_number >= rangeStart && ep.episode_number < rangeStart + 50))
    .sort((a, b) => episodeSort === "desc" ? b.episode_number - a.episode_number : a.episode_number - b.episode_number);

  return (
    <>
      {/* Season Selection Section */}
      {seasons && seasons.length > 0 && (
        <div id="seasons-section" className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 py-8 border-b border-white/5 bg-zinc-900/10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-rule font-display text-lg sm:text-xl font-bold text-white">
              Seasons
            </h3>
            <span className="text-xs text-zinc-500 font-semibold">
              {seasons.length} {seasons.length === 1 ? "Season" : "Seasons"}
            </span>
          </div>
          <ScrollRow label="seasons" className="gtv-no-scrollbar flex gap-4 overflow-x-auto pb-3">
            {seasons.map((season) => {
              const isSelected = selectedSeason === season.season_number;
              const seasonTitle = season.name || `Season ${season.season_number}`;
              return (
                <div
                  key={season.season_number}
                  onClick={() => onSeasonSelect(season.season_number)}
                  title={seasonTitle}
                  className={`group relative w-[135px] sm:w-[155px] md:w-[175px] shrink-0 cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 flex flex-col justify-between ${
                    isSelected
                      ? "border-white ring-2 ring-white/30 bg-zinc-900/90 shadow-[0_8px_25px_rgba(255,255,255,0.15)] scale-[1.02]"
                      : "border-white/10 hover:border-white/25 bg-[var(--gtv-surface)] hover:scale-[1.01]"
                  }`}
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-zinc-900">
                    <MediaImage
                      src={season.poster_path ? season.poster_path : posterFallback}
                      alt={seasonTitle}
                      title={seasonTitle}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                    {season.episode_count > 0 && (
                      <div className="absolute top-2 right-2 rounded-md bg-black/80 backdrop-blur-sm border border-white/10 px-2 py-0.5 text-[9px] font-extrabold text-zinc-300">
                        {season.episode_count} Eps
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <h4 className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-snug drop-shadow-md">
                        {seasonTitle}
                      </h4>
                    </div>
                  </div>
                </div>
              );
            })}
          </ScrollRow>
        </div>
      )}

      {/* Episodes Section */}
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 py-8 border-b border-white/5 bg-zinc-950/25">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="section-rule font-display text-lg sm:text-xl font-bold text-white">
            Episodes · Season {selectedSeason}
          </h3>

          {!episodesLoading && eps.length > 0 && <div className="flex flex-wrap items-center gap-2">
            {eps.length > 50 && <select value={episodeRange} onChange={(e) => setEpisodeRange(e.target.value)} aria-label="Episode range" className="min-h-11 rounded-lg border border-white/10 bg-zinc-900 px-2 text-xs text-white"><option value="all">All episodes</option>{Array.from({ length: Math.ceil(eps.length / 50) }, (_, i) => <option key={i} value={i * 50 + 1}>{i * 50 + 1}–{Math.min((i + 1) * 50, eps.length)}</option>)}</select>}
            <button type="button" onClick={() => setEpisodeSort((s) => s === "asc" ? "desc" : "asc")} className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-bold text-zinc-300" aria-label="Reverse episode order"><i className="ri-sort-asc mr-1" />{episodeSort === "asc" ? "Oldest first" : "Newest first"}</button>
          </div>}
          {/* Episode search — big anime/series list hundreds of episodes */}
          {!episodesLoading && eps.length > 0 && (
            <div className="relative w-full sm:max-w-xs">
              <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" />
              <input
                type="text"
                aria-label="Search episodes"
                value={episodeSearch}
                onChange={(e) => setEpisodeSearch(e.target.value)}
                placeholder={`Search ${eps.length} episodes…`}
                className="min-h-11 w-full rounded-lg border border-white/10 bg-[var(--gtv-surface)] py-2 pl-9 pr-12 text-xs text-white placeholder:text-zinc-500 outline-none transition focus:border-[var(--gtv-accent)]"
              />
              {episodeSearch && (
                <button
                  onClick={() => setEpisodeSearch("")}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:text-white"
                >
                  <i className="ri-close-line" />
                </button>
              )}
            </div>
          )}
        </div>

        {episodesLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
            <div className="h-10 w-10 border-4 border-t-[var(--gtv-accent)] border-zinc-800 rounded-full animate-spin" />
            <span className="text-xs font-bold tracking-widest uppercase">Fetching clean episodes metadata...</span>
          </div>
        ) : eps.length > 0 && visibleEpisodes.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {visibleEpisodes.map((ep) => (
              <div
                key={ep.id || ep.episode_number}
                data-smartlink={startsPlayback ? "cta" : undefined}
                onClick={() => onEpisodeClick(ep)}
                className={`group cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 flex flex-col justify-between ${
                  selectedEpisode === ep.episode_number
                    ? "border-[var(--gtv-accent)] ring-2 ring-[var(--gtv-accent)]/40 bg-[var(--gtv-surface-2)] scale-[1.02]"
                    : "border-white/5 hover:border-white/10 bg-[var(--gtv-surface)]"
                }`}
              >
                <div className="relative">
                  <img
                    src={
                      ep.still_path
                        ? // AniList thumbnails are ABSOLUTE urls; TMDB
                          // stills are relative paths needing the image base.
                          (ep.still_path.startsWith("http")
                            ? ep.still_path
                            : `https://image.tmdb.org/t/p/w500${ep.still_path}`)
                        : stillFallback
                    }
                    alt={ep.name}
                    className="aspect-video w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute bottom-2.5 right-2.5 rounded bg-black/90 px-2 py-0.5 text-[10px] font-bold text-white tracking-wider">EP {ep.episode_number}</div>
                </div>

                {/* Info and Hotstar-style Download Button */}
                <div className="p-3.5 flex items-start justify-between gap-3 flex-grow">
                  <div className="flex-1 min-w-0">
                    <h4 className={`line-clamp-1 text-sm font-bold transition ${
                      selectedEpisode === ep.episode_number
                        ? "text-[var(--gtv-accent-2)]"
                        : "text-white group-hover:text-[var(--gtv-accent)]"
                    }`}>
                      {ep.name || `Episode ${ep.episode_number}`}
                    </h4>
                    {ep.overview && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400 leading-relaxed font-medium">
                        {ep.overview}
                      </p>
                    )}
                  </div>

                  {/* Hotstar-style Direct Download Button on Right — details
                      page only (downloadHrefFor null in the party). */}
                  {downloadHrefFor && (
                    <a
                      href={downloadHrefFor(ep.episode_number)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-smartlink="cta" /* SMARTLINK HOT SPOT — Download CTA */
                      onClick={(e) => {
                        e.stopPropagation(); // Prevents launching player on card click!
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 hover:bg-[var(--gtv-accent-2)] hover:text-black text-[var(--gtv-accent-2)] border border-white/5 hover:border-transparent transition-all duration-300 shadow-md"
                      title={`Download Episode ${ep.episode_number}`}
                    >
                      <i className="ri-download-line text-sm" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : eps.length > 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-zinc-500">
            <i className="ri-emotion-sad-line text-3xl" />
            <span className="text-xs font-bold tracking-widest uppercase">
              No episodes match &ldquo;{episodeSearch}&rdquo;
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}
