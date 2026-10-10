import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import InfiniteScroll from "react-infinite-scroll-component";
import Topnav from "../components/partials/Topnav.jsx";
import TrendingSearches from "../components/partials/TrendingSearches.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import Cards from "../components/partials/Cards.jsx";
import Footer from "../components/Footer.jsx";
import axios from "../lib/irisAxios.js";
import { safeBack } from "../utils/goBack.js";
import { clampTotalPages, isTitle, searchPageUrl, walkPages } from "../utils/searchPaging.js";
import { searchPublicProfiles } from "../utils/profiles.js";

// ─── /search — Hotstar-style dedicated search page ───
// Ported from Iris's components/Search.jsx: All/Movies/Series/Users tabs,
// recent-search chips, debounced live results and the Trending Searches empty
// state. Users is the public-profile directory (/api/db/profiles).

const RECENT_SEARCHES_KEY = "recentSearches";
const MAX_RECENTS = 6;
const MIN_TERM_LENGTH = 3;

const SEARCH_CATEGORIES = [
  { id: "all", label: "All", icon: "ri-apps-2-line" },
  { id: "movie", label: "Movies", icon: "ri-movie-2-line" },
  { id: "tv", label: "Series", icon: "ri-tv-2-line" },
  { id: "users", label: "Users", icon: "ri-user-3-line" },
];

export const MemberCard = ({ member }) => {
  const initial = (member.displayName || member.handle || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <Link
      to={`/u/${member.handle}`}
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[var(--gtv-surface-2)] p-2.5 transition hover:border-white/25 hover:bg-white/10"
    >
      {member.avatar ? (
        <img
          src={member.avatar}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
        />
      ) : (
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-base font-black text-black/80"
          style={{ backgroundImage: member.accent ? undefined : "linear-gradient(135deg,#fbbf24,#f59e0b)" }}
        >
          {initial}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-white">
          {member.displayName || member.handle}
        </span>
        <span className="block truncate text-[11px] text-zinc-500">@{member.handle}</span>
        {member.bio && <span className="mt-0.5 block truncate text-[10px] text-zinc-600">{member.bio}</span>}
      </span>
    </Link>
  );
};
const normalizeCategory = (raw) => (SEARCH_CATEGORIES.some((c) => c.id === raw) ? raw : "all");
const searchUrl = (q, category) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category && category !== "all") params.set("type", category);
  const qs = params.toString();
  return `/search${qs ? `?${qs}` : ""}`;
};

const readRecents = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
};

const pushRecent = (term) => {
  const t = (term || "").trim();
  if (t.length < MIN_TERM_LENGTH) return;
  const next = [t, ...readRecents().filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
};

const Search = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [text, setText] = useState((searchParams.get("q") || "").trim());
  const [query, setQuery] = useState(text);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const pageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const [recents, setRecents] = useState(readRecents);
  const [users, setUsers] = useState([]);
  const [category, setCategory] = useState(() => normalizeCategory(searchParams.get("type")));
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const lastSyncedRef = useRef(text.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = text.trim();
      setQuery(q);
      if (q !== lastSyncedRef.current) {
        lastSyncedRef.current = q;
        navigate(searchUrl(q, categoryRef.current), { replace: true });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [text, navigate]);

  useEffect(() => {
    if (!query) {
      setResults(null);
      setUsers([]);
      setLoading(false);
      setHasMore(false);
      setTotalResults(0);
      pageRef.current = 1;
      totalPagesRef.current = 1;
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setHasMore(false);
    setLoadingMore(false);
    pageRef.current = 1;
    totalPagesRef.current = 1;
    (async () => {
      const people = searchPublicProfiles(query, 12).catch(() => []);
      try {
        const res = await axios.get(searchPageUrl(query, 1));
        const data = res.data || {};
        const first = (data.results || []).filter(isTitle);
        totalPagesRef.current = clampTotalPages(data.total_pages);
        pageRef.current = 2;
        if (!cancelled) {
          setResults(first);
          setTotalResults(data.total_results || first.length);
          setHasMore(totalPagesRef.current > 1);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setTotalResults(0);
          setHasMore(false);
        }
      }
      const found = await people;
      if (!cancelled) {
        setUsers(found);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !query || !hasMore) return;
    setLoadingMore(true);
    try {
      const outcome = await walkPages({
        base: [],
        startPage: pageRef.current,
        totalPages: totalPagesRef.current,
        fetchPage: async (n) => (await axios.get(searchPageUrl(query, n))).data || {},
      });
      pageRef.current = outcome.nextPage;
      totalPagesRef.current = outcome.totalPages;
      if (outcome.gained > 0) {
        setResults((prev) => {
          const base = prev || [];
          const seen = new Set(base.map((i) => `${i.media_type}-${i.id}`));
          const fresh = outcome.items.filter((i) => !seen.has(`${i.media_type}-${i.id}`));
          return fresh.length ? [...base, ...fresh] : base;
        });
      }
      setHasMore(outcome.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, query, hasMore]);

  useEffect(() => {
    document.title = query ? `Search: ${query} | TheOGPirateBot` : "Search | TheOGPirateBot";
  }, [query]);

  const onSubmit = (e) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setQuery(q);
    if (q !== lastSyncedRef.current) {
      lastSyncedRef.current = q;
      navigate(searchUrl(q, categoryRef.current), { replace: true });
    }
  };

  const items = (results || []).filter((s) => s && s.id && (s.media_type === "movie" || s.media_type === "tv"));
  const movies = items.filter((s) => s.media_type === "movie");
  const shows = items.filter((s) => s.media_type === "tv");
  const hasResults = items.length > 0 || users.length > 0;
  const counts = { all: items.length + users.length, movie: movies.length, tv: shows.length, users: users.length };

  const pickCategory = (id) => {
    setCategory(id);
    navigate(searchUrl(query, id), { replace: true });
  };

  return (
    <div className="w-full min-h-screen bg-[var(--gtv-bg)] flex flex-col select-none animate-fade-in pb-28 sm:pb-24">
      <Topnav />

      <div className="flex-grow flex flex-col gap-2 px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 py-6">
        <form onSubmit={onSubmit} className="w-full flex items-center gap-2 sm:gap-3 border-b border-white/5 pb-5">
          <button
            type="button"
            onClick={() => safeBack(navigate, "/")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/5 hover:bg-white/10 text-xl text-zinc-400 transition"
            aria-label="Go Back"
          >
            <i className="ri-arrow-left-line" />
          </button>

          <div className="relative flex-grow">
            <div className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 text-zinc-500 sm:block">
              <i className="ri-search-2-line text-lg" />
            </div>
            <input
              ref={inputRef}
              type="text"
              aria-label="Search movies, series and members"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Movies, series, users..."
              autoComplete="off"
              className="w-full rounded-full border border-white/10 bg-[var(--gtv-surface-2)] py-3 pl-4 pr-11 sm:pl-11 text-sm sm:text-base text-white outline-none transition-all placeholder:text-zinc-500 focus:border-[var(--gtv-accent)] focus:bg-[var(--gtv-surface)] focus:ring-2 focus:ring-[var(--gtv-accent-ring)]"
            />
            {text.length > 0 && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setText("");
                  inputRef.current?.focus();
                }}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 transition-colors hover:text-white"
              >
                <i className="ri-close-fill text-xl" aria-hidden="true" />
              </button>
            )}
          </div>

          <Link
            to="/explore"
            aria-label="Explore by genre, year or country"
            title="Explore by genre, year or country"
            className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-[var(--gtv-surface-2)] px-3 sm:px-5 text-xs sm:text-sm font-bold text-zinc-200 transition hover:bg-white/10 hover:text-white active:scale-95"
          >
            <i className="ri-equalizer-line text-base" aria-hidden="true" />
            <span className="hidden sm:inline">Explore</span>
          </Link>

          <button
            type="submit"
            aria-label="Search"
            className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white text-black px-5 sm:px-6 text-xs sm:text-sm font-bold transition hover:bg-zinc-200 active:scale-95 cursor-pointer"
          >
            <i className="ri-search-line text-base" />
            <span className="hidden sm:inline">Search</span>
          </button>
        </form>

        {query && (
          <div role="tablist" aria-label="Search categories" className="flex gap-2 overflow-x-auto pt-4 pb-1 no-scrollbar">
            {SEARCH_CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => pickCategory(c.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs sm:text-sm font-semibold transition ${
                    active ? "border-white bg-white text-black" : "border-white/10 bg-[var(--gtv-surface-2)] text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <i className={`${c.icon} text-base`} />
                  {c.label}
                  {!loading && <span className={active ? "text-black/50" : "text-zinc-500"}>{counts[c.id]}</span>}
                </button>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 py-8 text-zinc-500">
            <div className="h-8 w-8 border-4 border-t-[var(--gtv-accent)] border-zinc-800 rounded-full animate-spin" />
            <span className="text-xs font-bold uppercase tracking-widest animate-pulse">Searching everything...</span>
          </div>
        )}

        {!loading && !query && recents.length > 0 && (
          <div className="pt-4">
            <div className="flex items-center justify-between pb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Recent Searches</span>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(RECENT_SEARCHES_KEY);
                  setRecents([]);
                }}
                className="min-h-11 px-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recents.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setText(r)}
                  className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 bg-[var(--gtv-surface-2)] hover:bg-white/10 px-4 py-2 text-xs font-semibold text-zinc-300 hover:text-white transition"
                >
                  <i className="ri-history-line text-zinc-500" />
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && query && category === "all" && hasResults && (
          <div
            onClick={(e) => {
              if (e.target.closest("a")) {
                pushRecent(query);
                setRecents(readRecents());
              }
            }}
          >
            {items.length > 0 && (
              <div className="pt-6">
                <h2 className="section-rule mb-3 font-editorial text-lg sm:text-xl font-bold text-white">
                  Top Results <span className="text-zinc-600 text-sm font-semibold">({items.length})</span>
                </h2>
                <HorizontalCards data={items} onEndReached={loadMore} hasMore={hasMore} loadingMore={loadingMore} />
              </div>
            )}
            {movies.length > 0 && (
              <div className="pt-6">
                <h2 className="section-rule mb-3 font-editorial text-lg sm:text-xl font-bold text-white">
                  Movies <span className="text-zinc-600 text-sm font-semibold">({movies.length})</span>
                </h2>
                <HorizontalCards data={movies} onEndReached={loadMore} hasMore={hasMore} loadingMore={loadingMore} />
              </div>
            )}
            {shows.length > 0 && (
              <div className="pt-6">
                <h2 className="section-rule mb-3 font-editorial text-lg sm:text-xl font-bold text-white">
                  Series <span className="text-zinc-600 text-sm font-semibold">({shows.length})</span>
                </h2>
                <HorizontalCards data={shows} onEndReached={loadMore} hasMore={hasMore} loadingMore={loadingMore} />
              </div>
            )}
            {items.length > 0 && totalResults > items.length && (
              <p className="pt-6 text-center text-[11px] text-zinc-600">
                {loadingMore ? "Loading more..." : `Showing ${items.length} of ${totalResults} matches — keep scrolling a row for more`}
              </p>
            )}
            {users.length > 0 && (
              <div className="pt-6">
                <h2 className="section-rule mb-3 font-editorial text-lg sm:text-xl font-bold text-white">
                  Users <span className="text-zinc-600 text-sm font-semibold">({users.length})</span>
                </h2>
                <p className="mb-3 text-[11px] text-zinc-500">
                  Members with a public page — tap one to see what they are watching.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {users.map((member) => (
                    <MemberCard key={member.handle} member={member} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && query && category !== "all" && (
          <div
            className="pt-6"
            onClick={(e) => {
              if (e.target.closest("a")) {
                pushRecent(query);
                setRecents(readRecents());
              }
            }}
          >
            {category === "users" ? (
              users.length > 0 ? (
                <>
                  <p className="mb-3 text-[11px] text-zinc-500">
                    Members with a public page — tap one to see what they are watching.
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {users.map((member) => (
                      <MemberCard key={member.handle} member={member} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <i className="ri-user-search-line text-4xl text-zinc-600" />
                  <p className="text-sm font-semibold text-zinc-300">No users found for &ldquo;{query}&rdquo;</p>
                  <p className="max-w-sm text-xs text-zinc-500">
                    {query.replace(/^@+/, "").length < 2
                      ? "Type at least 2 letters of a username."
                      : "Only members who made their page public show up here. Search by username or display name."}
                  </p>
                </div>
              )
            ) : (category === "movie" ? movies : shows).length > 0 ? (
              <InfiniteScroll
                dataLength={(category === "movie" ? movies : shows).length}
                next={loadMore}
                hasMore={hasMore}
                loader={
                  <div className="w-full flex justify-center py-8 text-zinc-500 text-xs font-bold uppercase tracking-widest animate-pulse">
                    Loading more results...
                  </div>
                }
                endMessage={
                  <p className="w-full py-8 text-center text-xs font-semibold text-zinc-600">
                    That is every {category === "movie" ? "movie" : "series"} matching &ldquo;{query}&rdquo;.
                  </p>
                }
                className="w-full !overflow-visible"
                style={{ overflow: "visible" }}
              >
                <Cards data={category === "movie" ? movies : shows} title={category} />
              </InfiniteScroll>
            ) : (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <i className={`${category === "movie" ? "ri-movie-2-line" : "ri-tv-2-line"} text-4xl text-zinc-600`} />
                <p className="text-sm font-semibold text-zinc-300">
                  No {category === "movie" ? "movies" : "series"} found for &ldquo;{query}&rdquo;
                </p>
              </div>
            )}
          </div>
        )}

        {!loading && (!query || (category === "all" && !hasResults)) && (
          <div className="pt-2">
            {query && !hasResults && (
              <>
                <p className="text-sm text-zinc-500 font-medium py-2">
                  Nothing found for &ldquo;{query}&rdquo;. Try a different spelling, the Users tab above to find a member by username — or browse by genre instead:
                </p>
                <Link
                  to="/explore"
                  className="group my-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-white/10 active:scale-95"
                >
                  <i className="ri-equalizer-line text-base" aria-hidden="true" />
                  Explore by genre, year or country
                  <i className="ri-arrow-right-s-line text-base text-zinc-500 transition group-hover:text-white" aria-hidden="true" />
                </Link>
              </>
            )}
            {!query && (
              <p className="text-sm text-zinc-500 font-medium py-2">
                What everyone is watching right now — tap to jump straight in:
              </p>
            )}
            <TrendingSearches variant="grid" />
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default Search;
