import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LiveDot, LiveTvCard } from "../components/partials/LiveTvRail.jsx";
import WatchChoice from "../components/partials/WatchChoice.jsx";
import Topnav from "../components/partials/Topnav.jsx";
import LiveStreamPlayer from "../components/partials/LiveStreamPlayer.jsx";
import LiveTvChannelOverlay from "../components/partials/LiveTvChannelOverlay.jsx";
import { LIVE_TV_SECTIONS, liveTvEmbedUrl, liveTvStreamsFor, snapshotToChannels } from "../data/liveTvSnapshot.js";
import {
  FAV_EVENT,
  isLiveTvFavorite,
  loadLiveTv,
  loadLiveTvFull,
  pushLiveTvRecent,
  readLiveTvFavorites,
  toggleLiveTvFavorite,
} from "../utils/liveTv.js";
import ScrollRow from "../components/partials/ScrollRow.jsx";
import { FAVS_RAIL, railChannelsFor, zapTarget } from "../utils/liveTvNav.js";

const LiveTvWatch = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [sections, setSections] = useState(snapshotToChannels);
  const [regional, setRegional] = useState([]);
  const [infoExtra, setInfoExtra] = useState([]);
  const [moviesEnExtra, setMoviesEnExtra] = useState([]);
  const [moviesHiExtra, setMoviesHiExtra] = useState([]);
  const [fav, setFav] = useState(() => isLiveTvFavorite(id));
  const [favs, setFavs] = useState(() => new Set(readLiveTvFavorites()));
  const [frameKey, setFrameKey] = useState(0);
  const [pending, setPending] = useState(null);
  const [tuned, setTuned] = useState(false);
  const [railSection, setRailSection] = useState(null);
  // The in-player channel changer (LiveTvChannelOverlay) owns its own panel
  // visibility, but the page holds the flag so Escape can close the panel
  // BEFORE it means "leave the theater".
  const [pickerOpen, setPickerOpen] = useState(false);
  const veilTimer = useRef(null);

  // Live overlay (names/logos/regional) — the snapshot already resolved the
  // channel below, so this only ever enriches, never blocks.
  useEffect(() => {
    let mounted = true;
    loadLiveTv()
      .then((res) => {
        if (!mounted) return;
        setSections(res.sections);
        return loadLiveTvFull();
      })
      .then((full) => {
        if (!mounted || !full) return;
        setRegional(full.regional || []);
        setInfoExtra(full.infoEn || []);
        setMoviesEnExtra(full.moviesEn || []);
        setMoviesHiExtra(full.moviesHi || []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
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

  // Unknown ids still play: the embed URL is id-addressed, so a deep-linked
  // id that isn't in the guide tunes in anyway (name fills in when found).
  const channel = byId.get(String(id)) || {
    id: String(id),
    name: `Channel ${id}`,
    logo: "",
    section: "sports",
    unknown: true,
  };

  useEffect(() => {
    document.title = `${channel.name} — Live | TheOGPirateBot`;
    pushLiveTvRecent(id);
    setFav(isLiveTvFavorite(id));
    setTuned(false);
    setFrameKey((k) => k + 1);
    if (veilTimer.current) clearTimeout(veilTimer.current);
    // The veil can never trap the visitor: it lifts on iframe load, and in
    // the worst case auto-lifts after 18 s (blocked frame / dead id).
    veilTimer.current = setTimeout(() => setTuned(true), 18000);
    return () => {
      if (veilTimer.current) clearTimeout(veilTimer.current);
    };
  }, [id, channel.name]);

  useEffect(() => {
    const onFav = () => {
      setFav(isLiveTvFavorite(id));
      setFavs(new Set(readLiveTvFavorites()));
    };
    window.addEventListener("storage", onFav);
    window.addEventListener(FAV_EVENT, onFav);
    return () => {
      window.removeEventListener("storage", onFav);
      window.removeEventListener(FAV_EVENT, onFav);
    };
  }, [id]);

  // My List in the theater: the viewer's favourites, resolved against the same
  // guide map the rails use, so a channel that left the guide simply drops out.
  const favChannels = useMemo(
    () => [...favs].map((fid) => byId.get(String(fid))).filter(Boolean),
    [favs, byId]
  );

  const activeRail = railSection || channel.section || "sports";
  const railPool = useMemo(
    () => railChannelsFor(activeRail, pools, favChannels),
    [pools, activeRail, favChannels]
  );

  // One zapping rule for the header buttons, the strip under the player, the
  // arrow keys and the in-player changer (utils/liveTvNav.js, unit-tested).
  const zap = useCallback(
    (dir) => {
      const next = zapTarget(railPool, id, dir);
      if (next) navigate(`/live-tv/watch/${next}`);
    },
    [railPool, id, navigate]
  );

  const goBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/live-tv", { replace: true });
  }, [navigate]);

  // Keyboard zapping: ←/→ channel, F favorite, Esc back. Never hijacks typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        zap(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        zap(-1);
      } else if (e.key === "f" || e.key === "F") {
        toggleLiveTvFavorite(id);
        setFav(isLiveTvFavorite(id));
      } else if (e.key === "Escape") {
        // The channel panel is the innermost surface: Escape closes it and a
        // second press leaves the theater.
        if (pickerOpen) setPickerOpen(false);
        else goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zap, id, goBack, pickerOpen]);

  const handleToggleFav = useCallback(() => {
    toggleLiveTvFavorite(id);
    setFav(isLiveTvFavorite(id));
  }, [id]);

  const sectionMeta = (key) => LIVE_TV_SECTIONS.find((s) => s.key === key) || {};
  const embedSrc = useMemo(() => liveTvEmbedUrl(id), [id]);
  const iptvStreams = liveTvStreamsFor(id);

  return (
    <div className="flex min-h-screen w-full animate-fade-in select-none flex-col bg-[var(--gtv-bg)] pb-16">
      <Topnav />
      {/* ── Channel controls below the shared site navigation ── */}
      <header className="sticky top-[calc(var(--domain-banner-h,0px)+53px)] z-50 mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-[1400px] items-center justify-between gap-2 rounded-full border border-white/10 bg-black px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.6)] sm:w-[calc(100%-2rem)] sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={goBack}
            aria-label="Back to guide"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/15 hover:text-white active:scale-90"
          >
            <i className="ri-arrow-left-line text-lg" />
          </button>
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(120%_120%_at_50%_0%,#26262b_0%,#0a0a0a_70%)] p-1.5 xs:flex sm:flex">
            {channel.logo ? (
              <img
                src={channel.logo}
                alt=""
                loading="eager"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
                className="h-full w-full object-contain"
              />
            ) : (
              <i className="ri-tv-line text-lg text-zinc-500" />
            )}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-display text-sm font-black text-white sm:text-base">
                {channel.name}
              </span>
              <LiveDot className="shrink-0" />
            </span>
            <Link
              to="/live-tv"
              className="block truncate text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
            >
              {sectionMeta(channel.section).label || "Live TV"} · Guide
            </Link>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => zap(-1)}
            disabled={railPool.length < 2}
            aria-label="Previous channel"
            title="Previous channel (←)"
            className="hidden h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/15 hover:text-white active:scale-90 disabled:opacity-30 sm:flex"
          >
            <i className="ri-skip-back-mini-fill text-lg" />
          </button>
          <button
            onClick={() => zap(1)}
            disabled={railPool.length < 2}
            aria-label="Next channel"
            title="Next channel (→)"
            className="hidden h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/15 hover:text-white active:scale-90 disabled:opacity-30 sm:flex"
          >
            <i className="ri-skip-forward-mini-fill text-lg" />
          </button>
          <button
            onClick={handleToggleFav}
            aria-label={fav ? "Remove from favorites" : "Add to favorites"}
            title="Favorite (F)"
            className={`flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-90 ${
              fav
                ? "border-white bg-white text-black"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/15 hover:text-white"
            }`}
          >
            <i className={`${fav ? "ri-heart-3-fill" : "ri-heart-3-line"} text-lg`} />
          </button>
          <button
            onClick={() => {
              setTuned(false);
              setFrameKey((k) => k + 1);
            }}
            aria-label="Reload player"
            title="Reload player"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/15 hover:text-white active:scale-90"
          >
            <i className="ri-refresh-line text-lg" />
          </button>
        </div>
      </header>

      {/* ── Player ── */}
      <main className="mx-auto w-full max-w-[1400px] px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl sm:rounded-3xl">
          {iptvStreams ? (
            <LiveStreamPlayer
              key={`${id}-${frameKey}`}
              streams={iptvStreams}
              title={channel.name}
              logo={channel.logo}
              feedKey={id}
              className="absolute inset-0"
            />
          ) : (
          <iframe
            key={`${id}-${frameKey}`}
            src={embedSrc}
            title={`${channel.name} live player`}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => {
              if (veilTimer.current) clearTimeout(veilTimer.current);
              veilTimer.current = setTimeout(() => setTuned(true), 450);
            }}
          />
          )}
          {/* Channel controls ON the player — zap buttons, the channel OSD and
              the changer panel. Rendered after the frame for every playback
              path (provider iframe and direct HLS alike), and above the tuning
              veil, so a channel that will not tune can be abandoned at once. */}
          <LiveTvChannelOverlay
            channel={channel}
            channels={railPool}
            favorites={favChannels}
            favs={favs}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onPrev={() => zap(-1)}
            onNext={() => zap(1)}
            onPick={(ch) => {
              if (!ch) return;
              setPickerOpen(false);
              if (String(ch.id) === String(id)) {
                setTuned(false);
                setFrameKey((k) => k + 1);
              } else {
                navigate(`/live-tv/watch/${ch.id}`);
              }
            }}
            onToggleFav={(cid) => {
              toggleLiveTvFavorite(cid);
              setFavs(new Set(readLiveTvFavorites()));
              if (String(cid) === String(id)) setFav(isLiveTvFavorite(id));
            }}
          />

          {/* Tuning veil — lifts the moment the frame answers (embed path only;
              the direct player veils itself). */}
          {!iptvStreams && (
          <div
            className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(110%_130%_at_50%_0%,#17171a_0%,#000_70%)] transition-opacity duration-500 ${
              tuned ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
            aria-hidden={tuned}
          >
            <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-2.5 sm:h-20 sm:w-20">
              {channel.logo ? (
                <img src={channel.logo} alt="" className="h-full w-full object-contain" />
              ) : (
                <i className="ri-tv-line text-3xl text-zinc-600" />
              )}
            </span>
            <span className="flex items-center gap-2">
              <LiveDot />
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
                Tuning in…
              </span>
            </span>
            <span className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full w-1/2 animate-[tuningSlide_1.1s_ease-in-out_infinite] rounded-full bg-white/80" />
            </span>
            <span className="px-6 text-center text-[10px] font-semibold text-zinc-600">
              If the picture stays black, tap <i className="ri-refresh-line" /> reload above.
            </span>
          </div>
          )}
        </div>

        {/* Display ads (owner, 2026-09-24): the stack directly below the
            player, above the zap bar — the theater's carve-out from the
            bottoms-only rule. Tight spacing (no gap, hugging boxes) so it
            reads as one intentional unit. Lazy: fetches on scroll-to. */}


        {/* Zap strip (phones get big thumbs; the rail below carries desktop) */}
        <div className="mt-3 flex items-center gap-2 sm:hidden">
          <button
            onClick={() => zap(-1)}
            disabled={railPool.length < 2}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-extrabold text-white transition active:scale-[0.98] disabled:opacity-30"
          >
            <i className="ri-skip-back-mini-fill text-base" /> Prev
          </button>
          <button
            onClick={() => zap(1)}
            disabled={railPool.length < 2}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-3 text-xs font-extrabold text-black transition active:scale-[0.98] disabled:opacity-30"
          >
            Next <i className="ri-skip-forward-mini-fill text-base" />
          </button>
        </div>

        {/* ── Rail section switcher + up-next ── */}
        <div className="mt-5 flex items-center gap-2">
          <ScrollRow
            label="channel sections"
            wrapClassName="flex-1 min-w-0"
            className="gtv-no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1"
          >
            {/* My List first: the theatre's own favourites rail. It stays
                visible when empty so the heart is discoverable — with a hint
                instead of a blank rail. */}
            <button
              onClick={() => setRailSection(railSection === FAVS_RAIL ? null : FAVS_RAIL)}
              aria-pressed={activeRail === FAVS_RAIL}
              title={favChannels.length ? "Your saved channels" : "Tap the heart on any channel to pin it here"}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[11px] font-bold transition-all duration-200 active:scale-95 sm:text-xs ${
                activeRail === FAVS_RAIL
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <i className="ri-heart-3-fill text-sm" />
              My List
              {favChannels.length > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[9px] font-black ${
                    activeRail === FAVS_RAIL ? "bg-black/15 text-black" : "bg-white/10 text-zinc-300"
                  }`}
                >
                  {favChannels.length}
                </span>
              )}
            </button>
            {LIVE_TV_SECTIONS.filter((s) => (pools[s.key] || []).length > 0).map((s) => {
              const active = activeRail === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setRailSection(s.key)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[11px] font-bold transition-all duration-200 active:scale-95 sm:text-xs ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <i className={`${s.icon} text-sm`} />
                  {s.label}
                </button>
              );
            })}
          </ScrollRow>
          <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-widest text-zinc-600 sm:block">
            ← → to zap · F to save · ▲ ▼ on the picture
          </span>
        </div>

        <ScrollRow label="channels" className="gtv-no-scrollbar pt-2">
          {railPool.map((c) => (
            <LiveTvCard
              key={c.id}
              channel={c}
              favs={favs}
              active={String(c.id) === String(id)}
              onSelect={(ch) => {
                // Tapping the channel that's already on just retunes it.
                if (String(ch.id) === String(id)) {
                  setTuned(false);
                  setFrameKey((k) => k + 1);
                } else {
                  setPending(ch);
                }
              }}
              onToggleFav={(cid) => {
                toggleLiveTvFavorite(cid);
                if (String(cid) === String(id)) setFav(isLiveTvFavorite(id));
                else setFavs(new Set(readLiveTvFavorites()));
              }}
            />
          ))}
          {railPool.length === 0 && (
            <p className="w-full py-8 text-center text-xs font-semibold text-zinc-600">
              {activeRail === FAVS_RAIL
                ? "Your list is empty — tap the heart on any channel to pin it here."
                : "Nothing in this section right now — try another."}
            </p>
          )}
        </ScrollRow>

        <p className="mx-auto max-w-2xl pt-8 text-center text-[10px] font-medium leading-relaxed text-zinc-600">
          Streams play from the channel provider inside the frame above — availability, quality
          and the in-player controls belong to them. TheOGPirateBot only keeps the guide.
        </p>
      </main>

      {/* Watch sheet for rail taps (zap buttons/keys stay direct). */}
      <WatchChoice
        channel={pending}
        onAlone={() => {
          if (!pending) return;
          const next = String(pending.id);
          setPending(null);
          if (next !== String(id)) navigate(`/live-tv/watch/${next}`);
        }}
        onClose={() => setPending(null)}
      />

      <style>{`@keyframes tuningSlide { 0% { transform: translateX(-100%);} 100% { transform: translateX(320%);} }`}</style>
    </div>
  );
};

export default LiveTvWatch;
