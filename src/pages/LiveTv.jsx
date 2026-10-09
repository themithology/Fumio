import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import WatchChoice from "../components/partials/WatchChoice.jsx";
import { LiveTvRail, LiveTvGrid, LiveTvEmpty, LiveDot } from "../components/partials/LiveTvRail.jsx";
import ScrollRow from "../components/partials/ScrollRow.jsx";
import { LIVE_TV_SECTIONS, snapshotToChannels } from "../data/liveTvSnapshot.js";
import {
  FAV_EVENT,
  RECENT_EVENT,
  loadLiveTv,
  loadLiveTvFull,
  readLiveTvFavorites,
  readLiveTvRecents,
  toggleLiveTvFavorite,
} from "../utils/liveTv.js";

// 30 shows the whole Hindi Movies rail (27 + enrichment newcomers) with no
// tap; only Sports (45) still paginates.
const PAGE_SIZE = 30;
const RAIL_LIMIT = 12;

const BASE_TABS = [
  { id: "all", label: "All" },
  { id: "recents", label: "Continue" },
  { id: "favs", label: "My List" },
  ...LIVE_TV_SECTIONS.map((s) => ({ id: s.key, label: s.label })),
];

const fmtStamp = (ts) => {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return sameDay ? time : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${time}`;
  } catch {
    return "";
  }
};

const ViewAll = ({ onClick, label = "View More" }) => (
  <button
    onClick={onClick}
    className="flex cursor-pointer items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300 backdrop-blur-sm transition hover:border-white/40 hover:bg-white hover:text-black"
  >
    {label} <i className="ri-arrow-right-line" />
  </button>
);

const ShowMore = ({ shown, total, onClick }) => (
  <div className="flex w-full justify-center pt-6">
    <button
      onClick={onClick}
      className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-xs font-bold text-zinc-200 transition hover:border-white/40 hover:bg-white hover:text-black"
    >
      Show more · {shown} of {total}
    </button>
  </div>
);

const LiveTv = () => {
  const navigate = useNavigate();
  // Snapshot-first: the guide paints synchronously, the network only ever
  // enriches (names/logos/newcomers). Nothing here can show a spinner.
  const [sections, setSections] = useState(snapshotToChannels);
  const [regional, setRegional] = useState([]);
  const [infoExtra, setInfoExtra] = useState([]);
  const [moviesEnExtra, setMoviesEnExtra] = useState([]);
  const [moviesHiExtra, setMoviesHiExtra] = useState([]);
  const [refreshing, setRefreshing] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isLive, setIsLive] = useState(true);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [favs, setFavs] = useState(() => new Set(readLiveTvFavorites()));
  const [recents, setRecents] = useState(() => readLiveTvRecents());
  const [pending, setPending] = useState(null);

  useEffect(() => {
    document.title = "TheOGPirateBot | Live TV";
  }, []);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [tab, query]);

  // Live overlay (facets, then full-list enrichment for regional + info).
  useEffect(() => {
    let mounted = true;
    setRefreshing(true);
    loadLiveTv()
      .then((res) => {
        if (!mounted) return null;
        setSections(res.sections);
        setUpdatedAt(res.updatedAt || null);
        setIsLive(res.live !== false);
        return loadLiveTvFull();
      })
      .then((full) => {
        if (!mounted || !full) return;
        setRegional(full.regional || []);
        setInfoExtra(full.infoEn || []);
        setMoviesEnExtra(full.moviesEn || []);
        setMoviesHiExtra(full.moviesHi || []);
      })
      .catch(() => {
        if (mounted) setIsLive(false);
      })
      .finally(() => {
        if (mounted) setRefreshing(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Favorites + recents stay in sync with the theater tab.
  useEffect(() => {
    const onFav = () => setFavs(new Set(readLiveTvFavorites()));
    const onRecent = () => setRecents(readLiveTvRecents());
    window.addEventListener("storage", onFav);
    window.addEventListener(FAV_EVENT, onFav);
    window.addEventListener(RECENT_EVENT, onRecent);
    return () => {
      window.removeEventListener("storage", onFav);
      window.removeEventListener(FAV_EVENT, onFav);
      window.removeEventListener(RECENT_EVENT, onRecent);
    };
  }, []);

  const pools = useMemo(() => {
    const infoIds = new Set((sections.info || []).map((c) => c.id));
    const info = [...(sections.info || []), ...infoExtra.filter((c) => !infoIds.has(c.id))];
    const moviesEnIds = new Set((sections.moviesEn || []).map((c) => c.id));
    const moviesEn = [...(sections.moviesEn || []), ...moviesEnExtra.filter((c) => !moviesEnIds.has(c.id))];
    const moviesHiIds = new Set((sections.moviesHi || []).map((c) => c.id));
    const moviesHi = [...(sections.moviesHi || []), ...moviesHiExtra.filter((c) => !moviesHiIds.has(c.id))];
    return { ...sections, info, moviesEn, moviesHi, regional };
  }, [sections, regional, infoExtra, moviesEnExtra, moviesHiExtra]);

  const byId = useMemo(() => {
    const map = new Map();
    for (const list of Object.values(pools)) {
      for (const c of list || []) {
        if (c && !map.has(String(c.id))) map.set(String(c.id), c);
      }
    }
    return map;
  }, [pools]);

  const total = useMemo(
    () => Object.values(pools).reduce((n, list) => n + (list?.length || 0), 0),
    [pools]
  );

  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return null;
    const out = [];
    const seen = new Set();
    for (const c of byId.values()) {
      if (seen.has(c.id)) continue;
      if (`${c?.name || ""}`.toLowerCase().includes(q)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }, [byId, q]);

  const toggleFav = (id) => {
    toggleLiveTvFavorite(id);
    setFavs(new Set(readLiveTvFavorites()));
  };

  const favChannels = useMemo(
    () => [...favs].map((id) => byId.get(String(id))).filter(Boolean),
    [favs, byId]
  );
  const recentChannels = useMemo(
    () => recents.map((r) => byId.get(String(r.id))).filter(Boolean),
    [recents, byId]
  );

  // WatchChoice opens the selected channel in the Live TV theater.
  const soloWatch = () => {
    if (!pending) return;
    setPending(null);
    navigate(`/live-tv/watch/${pending.id}`);
  };

  const retryLoad = () => {
    if (refreshing) return;
    setRefreshing(true);
    loadLiveTv({ force: true })
      .then((res) => {
        setSections(res.sections);
        setUpdatedAt(res.updatedAt || null);
        setIsLive(res.live !== false);
        return loadLiveTvFull({ force: true });
      })
      .then((full) => {
        if (!full) return;
        setRegional(full.regional || []);
        setInfoExtra(full.infoEn || []);
        setMoviesEnExtra(full.moviesEn || []);
        setMoviesHiExtra(full.moviesHi || []);
      })
      .catch(() => setIsLive(false))
      .finally(() => setRefreshing(false));
  };

  const poolFor = (id) =>
    id === "favs" ? favChannels : id === "recents" ? recentChannels : pools[id] || [];
  const labelFor = (id) => BASE_TABS.find((t) => t.id === id)?.label || "";

  const renderGridSection = (title, data, emptyHint) => {
    if (!data.length) {
      return (
        <LiveTvEmpty
          title={title === "My List" ? "Your list is empty" : title === "Continue" ? "Nothing to continue yet" : `No ${title.toLowerCase()} channels`}
          hint={emptyHint || (title === "My List" ? "Tap the heart on any channel to pin it here." : title === "Continue" ? "Channels you watch will wait for you here." : "The guide updates often — try another tab.")}
        />
      );
    }
    const shown = data.slice(0, visible);
    return (
      <>
        <LiveTvGrid channels={shown} favs={favs} onToggleFav={toggleFav} onSelect={setPending} />
        {visible < data.length && <ShowMore shown={shown.length} total={data.length} onClick={() => setVisible((v) => v + PAGE_SIZE)} />}
      </>
    );
  };

  const bodyPad = "px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20";

  return (
    <div className="page-enter min-h-screen w-full bg-black pb-28 text-white">
      <Topnav />

      {/* Page header — house SectionHeader rhythm, one notch up. */}
      <header className={`${bodyPad} pt-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-black tracking-tight sm:text-3xl">
              <span className="h-7 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
              Live TV
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-zinc-500">
              <LiveDot />
              <span className="text-zinc-400">{total} channels</span>
              <span aria-hidden="true">·</span>
              {refreshing ? (
                <span>Syncing latest…</span>
              ) : isLive ? (
                updatedAt && <span>Updated {fmtStamp(updatedAt)}</span>
              ) : (
                <button onClick={retryLoad} className="text-zinc-300 underline underline-offset-2 transition hover:text-white">
                  Saved guide — tap to retry
                </button>
              )}
            </p>
          </div>
          {recentChannels.length > 0 && (
            <button
              onClick={() => setPending(recentChannels[0])}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-zinc-200 active:scale-95"
            >
              <i className="ri-play-fill" />
              <span className="max-w-[160px] truncate sm:max-w-[240px]">Continue · {recentChannels[0].name}</span>
            </button>
          )}
        </div>
      </header>

        {/* Tabs + search — solid bar, no blur: it repaints on every scroll
            frame, so anything translucent here taxes low-end GPUs. */}
      <div className="sticky top-[calc(var(--domain-banner-h,0px)+53px)] z-30 mt-4 border-y border-white/10 bg-black">
        <div className={`${bodyPad} flex items-center gap-2 py-2.5`}>
          <ScrollRow
            label="live tv categories"
            wrapClassName="flex-1 min-w-0"
            className="gtv-no-scrollbar flex items-center gap-1.5 overflow-x-auto"
          >
            {BASE_TABS.map((t) => {
              const active = tab === t.id && !q;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition active:scale-95 ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-white/10 bg-transparent text-zinc-400 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {t.label}
                  {t.id !== "all" && <span className={active ? "text-zinc-600" : "text-zinc-600"}>{poolFor(t.id).length}</span>}
                </button>
              );
            })}
          </ScrollRow>
          <div className="relative hidden w-52 shrink-0 md:block">
            <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" />
            <input
              aria-label="Search channels"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels"
              className="min-h-11 w-full rounded-full border border-white/10 bg-white/5 py-1.5 pl-9 pr-12 text-xs text-white placeholder-zinc-600 outline-none transition focus:border-white/30"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:text-white" aria-label="Clear search">
                <i className="ri-close-line text-sm" />
              </button>
            )}
          </div>
        </div>
        <div className={`${bodyPad} pb-2.5 md:hidden`}>
          <div className="relative">
            <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" />
            <input
              aria-label="Search channels"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels"
              className="min-h-11 w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-12 text-xs text-white placeholder-zinc-600 outline-none transition focus:border-white/30"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:text-white" aria-label="Clear search">
                <i className="ri-close-line text-base" />
              </button>
            )}
          </div>
        </div>
      </div>

      {q ? (
        <div className={`${bodyPad} pt-6`}>
          <p className="pb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for “{query.trim()}”
          </p>
          {renderGridSection("Search", searchResults, "No channel by that name — check the spelling.")}
        </div>
      ) : tab === "all" ? (
        <>
          {recentChannels.length > 0 && (
            <LiveTvRail title="Continue Watching" channels={recentChannels} limit={RAIL_LIMIT} favs={favs} onToggleFav={toggleFav} onSelect={setPending}
              action={<ViewAll onClick={() => setTab("recents")} />} />
          )}
          {favChannels.length > 0 && (
            <LiveTvRail title="My List" channels={favChannels} limit={RAIL_LIMIT} favs={favs} onToggleFav={toggleFav} onSelect={setPending}
              action={<ViewAll onClick={() => setTab("favs")} />} />
          )}
          {LIVE_TV_SECTIONS.map((s) =>
            (pools[s.key]?.length || 0) > 0 ? (
              <LiveTvRail key={s.key} title={s.label} channels={pools[s.key]} limit={RAIL_LIMIT} favs={favs} onToggleFav={toggleFav} onSelect={setPending}
                action={<ViewAll onClick={() => setTab(s.key)} />} />
            ) : null
          )}
        </>
      ) : (
        <div className={`${bodyPad} pt-6`}>
          {renderGridSection(labelFor(tab), poolFor(tab))}
        </div>
      )}

      {/* Open the selected channel in the theater */}
      <WatchChoice
        channel={pending}
        onAlone={soloWatch}
        onClose={() => setPending(null)}
      />

      <div className="pt-10">
        <Footer />
      </div>
    </div>
  );
};

export default LiveTv;
