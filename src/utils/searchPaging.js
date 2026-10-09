/**
 * Paging for the search page.
 *
 * TMDB serves search results 20 at a time. /search page used to request page 1
 * and nothing else, so for any term with more than 20 matches the rest simply
 * did not exist as far as the site was concerned.
 *
 * Owner, 2026-10-07: "suppose there are movie/series of same name more than 20
 * then it does even appears the limit is only 20 what people gonna do?"
 *
 * The awkward part is that /search/multi is ONE ranked list of movies, series
 * AND people. The search page throws the people away (they come from this
 * site's own member directory instead) and splits the rest into Movies and
 * Series tabs. So a given page of 20 can contribute three movies, or none at
 * all — which breaks a naive "fetch one more page per scroll" loop: an
 * infinite scroller that is handed zero new rows stops asking. `walkPages`
 * exists for that: one round keeps pulling pages until it actually gains
 * something, or runs out of allowance.
 *
 * This lives outside the component so the walk can be tested directly.
 */

/** TMDB rejects `page` above this outright. */
export const TMDB_MAX_PAGE = 500;

/** How many pages one "load more" may walk before giving the UI back. */
export const MAX_PAGES_PER_LOAD = 3;

/** A result the search page can actually render as a card. */
export const isTitle = (item) =>
  Boolean(item && item.id && (item.media_type === "movie" || item.media_type === "tv"));

/** Identity across pages — TMDB can repeat a title between pages. */
export const keyOf = (item) => `${item.media_type}-${item.id}`;

/** The multi-search URL for one page. */
export const searchPageUrl = (query, page) =>
  `/search/multi?query=${encodeURIComponent(query)}&include_adult=false&page=${page}`;

/** Clamp whatever TMDB reports to the page range it will actually serve. */
export const clampTotalPages = (reported, fallback = 1) => {
  const n = Number(reported);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.trunc(n), TMDB_MAX_PAGE);
};

/**
 * Append `batch` to `base`, dropping anything already present.
 * Returns the new array and how many rows were actually gained, because
 * "gained nothing" is the condition the walk loops on.
 */
export const mergeResults = (base, batch) => {
  const current = base || [];
  const seen = new Set(current.map(keyOf));
  const fresh = [];
  for (const item of batch || []) {
    if (!isTitle(item)) continue;
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  return { items: fresh.length ? [...current, ...fresh] : current, gained: fresh.length };
};

/**
 * Walk forward from `startPage` until the result set grows, the pages run
 * out, or the per-round allowance is spent.
 *
 * `fetchPage(n)` must resolve to TMDB's raw payload (`{ results, total_pages }`)
 * or reject. A rejection ends the round WITHOUT consuming the page, so the
 * same page is retried next time rather than silently skipped.
 *
 * Returns `{ items, gained, nextPage, totalPages, hasMore, failed }`.
 */
export const walkPages = async ({
  base = [],
  startPage,
  totalPages,
  fetchPage,
  maxPages = MAX_PAGES_PER_LOAD,
}) => {
  let items = base || [];
  let gained = 0;
  let page = startPage;
  let pages = totalPages;
  let failed = false;

  for (let walked = 0; walked < maxPages; walked += 1) {
    if (page > pages || page > TMDB_MAX_PAGE) break;

    let payload;
    try {
      payload = await fetchPage(page);
    } catch {
      // Leave `page` where it is: a flaky page should be retried, not skipped.
      failed = true;
      break;
    }

    pages = clampTotalPages(payload?.total_pages, pages);
    page += 1;

    const merged = mergeResults(items, payload?.results);
    items = merged.items;
    gained += merged.gained;

    if (gained > 0) break;
  }

  return {
    items,
    gained,
    nextPage: page,
    totalPages: pages,
    hasMore: page <= Math.min(pages, TMDB_MAX_PAGE),
    failed,
  };
};
