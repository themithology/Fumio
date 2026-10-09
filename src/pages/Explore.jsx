import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import InfiniteScroll from "react-infinite-scroll-component";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import axios from "../lib/irisAxios.js";
import Cards from "../components/partials/Cards.jsx";
import Loading from "../components/Loading.jsx";
import FetchError from "../components/FetchError.jsx";
import { safeBack } from "../utils/goBack.js";
import {
  BROWSE_GENRES,
  COUNTRIES,
  DEFAULT_SORT,
  LANGUAGES,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  activeFilterCount,
  buildDiscoverUrl,
  comparatorFor,
  mediaTypesFor,
  parseFilters,
  sortFor,
  titleFor,
  toQueryString,
  yearOptions,
} from "../utils/exploreFilters.js";

// /explore — the browse catalogue. Ported close to verbatim from Iris's
// components/Explore.jsx (the AdultBottomStack ad slot is dropped — no ads
// in this build, see README). This single page is also what FloatingNav's
// Movies/TV Shows tabs and Home's "View all" links point at
// (?type=movie / ?type=tv), instead of two separate bespoke pages.

const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-white/10 bg-[var(--gtv-surface-2)] px-3 py-2 pr-8 text-[13px] font-semibold text-white outline-none transition-colors hover:border-white/25 focus:border-[var(--gtv-accent)]";

const FilterSelect = ({ label, value, onChange, children }) => (
  <label className="flex min-w-0 flex-col gap-1.5">
    <span className="px-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</span>
    <span className="relative block">
      <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {children}
      </select>
      <i className="ri-arrow-down-s-line pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-zinc-500" aria-hidden="true" />
    </span>
  </label>
);

const Explore = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const filterKey = toQueryString(filters);
  const pageTitle = titleFor(filters);

  useEffect(() => {
    document.title = `TheOGPirateBot | ${pageTitle}`;
  }, [pageTitle]);

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("loading");

  const patch = useCallback(
    (next) => {
      const merged = { ...filters, ...next };
      setSearchParams(new URLSearchParams(toQueryString(merged)), { replace: false });
    },
    [filters, setSearchParams]
  );

  const clearAll = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: false });
  }, [setSearchParams]);

  const load = useCallback(
    async (nextPage, reset) => {
      try {
        setError(false);
        const urls = mediaTypesFor(filters)
          .map((t) => [t, buildDiscoverUrl(t, filters, nextPage)])
          .filter(([, url]) => url);

        const responses = await Promise.all(
          urls.map(([type, url]) =>
            axios
              .get(url)
              .then((res) => (res.data.results || []).map((item) => ({ ...item, media_type: type })))
              .catch(() => [])
          )
        );

        const merged = responses.flat().sort(comparatorFor(sortFor(filters.sort, "movie")));

        setItems((prev) => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map((i) => `${i.media_type}-${i.id}`));
          return [...base, ...merged.filter((i) => !seen.has(`${i.media_type}-${i.id}`))];
        });
        setPage(nextPage + 1);
        setHasMore(merged.length > 0);
        setStatus("ready");
      } catch (err) {
        console.error("Failed to load explore data:", err);
        setHasMore(false);
        setError(true);
        setStatus("ready");
      }
    },
    [filters]
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    setStatus("loading");
    load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const activeCount = activeFilterCount(filters);
  const yearMenu = useMemo(() => yearOptions(), []);

  if (status === "loading" && items.length === 0 && !error) return <Loading />;
  if (error && items.length === 0) return <FetchError onRetry={() => load(1, true)} />;

  return (
    <div className="w-full min-h-screen bg-[var(--gtv-bg)] flex flex-col select-none animate-fade-in">
      <Topnav />

      <div className="flex-grow flex flex-col gap-5 px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 pt-6 pb-28 sm:pb-24">
        <div className="w-full flex items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => safeBack(navigate, "/")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/5 hover:bg-white/10 text-xl text-zinc-400 transition"
              aria-label="Go Back"
            >
              <i className="ri-arrow-left-line" />
            </button>
            <h1 className="section-rule font-editorial truncate text-2xl font-bold text-white">{pageTitle}</h1>
          </div>
          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-300 transition hover:bg-white/10 hover:text-white active:scale-95"
            >
              <i className="ri-close-line text-sm" aria-hidden="true" />
              Clear {activeCount}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          <FilterSelect label="Type" value={filters.type} onChange={(v) => patch({ type: v })}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Genre" value={filters.genre || ""} onChange={(v) => patch({ genre: v || null })}>
            <option value="">Any genre</option>
            {BROWSE_GENRES.map((g) => (
              <option key={g.slug} value={g.slug}>{g.label}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Year" value={filters.year || ""} onChange={(v) => patch({ year: v || null })}>
            <option value="">Any year</option>
            {yearMenu.map((y) => (
              <option key={y.value} value={y.value}>{y.label}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Country" value={filters.country || ""} onChange={(v) => patch({ country: v || null })}>
            <option value="">Any country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Language" value={filters.lang || ""} onChange={(v) => patch({ lang: v || null })}>
            <option value="">Any language</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Sort" value={filters.sort || DEFAULT_SORT} onChange={(v) => patch({ sort: v })}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </FilterSelect>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
              <i className="ri-filter-off-line text-3xl text-zinc-400" />
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-lg font-bold text-white sm:text-xl">Nothing matches those filters</h2>
              <p className="max-w-sm text-xs leading-relaxed text-zinc-500 sm:text-sm">
                That combination is a little too narrow. Try widening the year or dropping one of the filters.
              </p>
            </div>
            {activeCount > 0 && (
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black transition hover:bg-zinc-200 active:scale-95 sm:text-sm"
              >
                <i className="ri-refresh-line" /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <InfiniteScroll
            dataLength={items.length}
            next={() => load(page, false)}
            hasMore={hasMore}
            loader={
              <div className="w-full flex justify-center py-8 text-zinc-500 text-xs font-bold uppercase tracking-widest animate-pulse">
                Loading more content...
              </div>
            }
            className="w-full"
          >
            <Cards data={items} title="explore" />
          </InfiniteScroll>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default Explore;
