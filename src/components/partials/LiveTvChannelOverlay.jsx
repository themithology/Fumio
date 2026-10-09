import React, { useEffect, useMemo, useRef, useState } from "react";
import { LIVE_TV_SECTIONS } from "../../data/liveTvSnapshot";
import { FAVS_RAIL, channelPosition } from "../../utils/liveTvNav";
import { LiveDot } from "./LiveTvRail";

// ─── In-player channel changer (built into the theater) ─────────────────────
// Owner, 2026-10-05: "add in build change channel button in player". Until now
// the zap controls lived OUTSIDE the video — the header buttons (hidden on
// phones) and a strip under the player — so changing channel meant leaving the
// picture. This overlay puts the controls ON the player, for both playback
// paths (the provider iframe AND the direct HLS player), without fighting
// either host's own UI: it hugs the RIGHT edge and the TOP-CENTRE, never the
// bottom, because that is where the provider's control bar and the native
// <video> controls appear.
//
//   • ▲ / ▼ zapping, always reachable (the veil while tuning does not cover
//     it, so a channel that refuses to tune can be abandoned immediately);
//   • a TV-style on-screen display — channel logo, name, "12 / 34" — that
//     fades in on every channel change and on open;
//   • a channel picker with two tabs: the section you are zapping through, and
//     My List (the viewer's favourites, with an in-row heart so the list can be
//     edited from inside the player).
//
// It is a pure presentation layer: every action is a callback into
// LiveTvWatch, which owns navigation and the favourites store.

const sectionLabel = (key) => LIVE_TV_SECTIONS.find((s) => s.key === key)?.label || "Live TV";

const RowLogo = ({ channel }) => {
  const [failed, setFailed] = useState(false);
  const initial = (channel?.name || "?").trim().charAt(0).toUpperCase() || "?";
  if (failed || !channel?.logo) {
    return (
      <span className="flex h-full w-full items-center justify-center font-display text-sm font-black text-white/70">
        {initial}
      </span>
    );
  }
  return (
    <img
      src={channel.logo}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
    />
  );
};

const OverlayButton = ({ label, icon, onClick, disabled = false, tone = "normal" }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg transition active:scale-90 disabled:opacity-30 sm:h-9 sm:w-9 ${
      tone === "active"
        ? "border-white bg-white text-black"
        : "border-white/10 bg-black/70 text-zinc-100 hover:bg-white hover:text-black"
    }`}
  >
    <i className={icon} />
  </button>
);

const LiveTvChannelOverlay = ({
  channel = null,
  channels = [],
  favorites = [],
  favs = null,
  open = false,
  onOpenChange = () => {},
  onPick = () => {},
  onPrev = null,
  onNext = null,
  onToggleFav = null,
}) => {
  // Opens on the section you are watching — the changer's job is "next
  // channel" — with My List one tap away (it carries the count, so it is
  // visible without being the default). A My List rail collapses the tabs and
  // lists the favourites directly (sameList below).
  const [tab, setTab] = useState("section");
  const [osd, setOsd] = useState(true);
  const currentRow = useRef(null);

  // The on-screen display: shown on arrival and on every channel change, then
  // faded out so it never sits on the picture.
  useEffect(() => {
    setOsd(true);
    const t = setTimeout(() => setOsd(false), 2600);
    return () => clearTimeout(t);
  }, [channel?.id]);

  const position = channelPosition(channels, channel?.id);
  // No favourites yet means the My List tab would be a dead end (an empty list
  // with no way back), so the section list wins until something is saved.
  const activeTab = favorites.length ? tab : "section";
  const list = activeTab === FAVS_RAIL ? favorites : channels;
  // Tabs are only worth showing when the two lists actually differ — opening
  // the changer from a My List rail would otherwise show the same channels
  // twice under two different labels.
  const sameList =
    channels.length === favorites.length &&
    channels.every((c, i) => String(c?.id) === String(favorites[i]?.id));
  const showTabs = favorites.length > 0 && !sameList;

  // Keep the tuned channel visible when the panel opens.
  useEffect(() => {
    if (open) currentRow.current?.scrollIntoView({ block: "nearest" });
  }, [open, activeTab]);

  const visible = useMemo(() => (Array.isArray(list) ? list : []), [list]);

  return (
    <>
      {/* TV-style OSD — top centre, clear of the provider's corner branding. */}
      <div
        className={`pointer-events-none absolute left-1/2 top-2 z-20 flex max-w-[86%] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 backdrop-blur transition-all duration-500 sm:top-3 ${
          osd || open ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
        aria-hidden={!(osd || open)}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/60 p-0.5">
          <RowLogo channel={channel} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-black text-white sm:text-xs">{channel?.name || "Live TV"}</span>
          <span className="block truncate text-[9px] font-bold uppercase tracking-widest text-zinc-500">
            {sectionLabel(channel?.section)}
            {position.index > 0 ? ` · ${position.index}/${position.total}` : ""}
          </span>
        </span>
        <LiveDot className="shrink-0" />
      </div>

      {/* Zap rail — right edge, vertically centred (nothing of the host's UI
          lives there). Always visible on purpose: this IS the button the
          viewer reaches for without leaving the picture. */}
      <div className="absolute right-1.5 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1.5 rounded-full border border-white/10 bg-black/45 p-1 backdrop-blur sm:right-2">
        <OverlayButton
          label="Previous channel"
          icon="ri-arrow-up-line"
          onClick={() => onPrev?.()}
          disabled={!onPrev || channels.length < 2}
        />
        <OverlayButton
          label={open ? "Close channel list" : "Change channel"}
          icon="ri-list-check-2"
          tone={open ? "active" : "normal"}
          onClick={() => onOpenChange(!open)}
        />
        <OverlayButton
          label="Next channel"
          icon="ri-arrow-down-line"
          onClick={() => onNext?.()}
          disabled={!onNext || channels.length < 2}
        />
      </div>

      {/* Channel picker — covers the right half of the picture on phones, a
          fixed panel beside the zap rail on desktop. */}
      {open && (
        <div className="absolute inset-y-2 right-12 left-2 z-30 overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-md sm:left-auto sm:w-[21rem] sm:right-14">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Change channel</span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close channel list"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white hover:text-black active:scale-90"
            >
              <i className="ri-close-line" />
            </button>
          </div>

          {showTabs && (
            <div className="flex gap-1.5 px-3 pt-2">
              <button
                type="button"
                onClick={() => setTab("section")}
                className={`flex-1 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition ${
                  activeTab !== FAVS_RAIL ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-zinc-400 hover:text-white"
                }`}
              >
                {sectionLabel(channel?.section)}
              </button>
              <button
                type="button"
                onClick={() => setTab(FAVS_RAIL)}
                className={`flex-1 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition ${
                  activeTab === FAVS_RAIL ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-zinc-400 hover:text-white"
                }`}
              >
                <i className="ri-heart-3-fill mr-1 text-[10px]" />
                My List {favorites.length ? `(${favorites.length})` : ""}
              </button>
            </div>
          )}

          <div className="gtv-no-scrollbar h-[calc(100%-6.5rem)] overflow-y-auto px-2 py-2">
            {visible.length === 0 && (
              <p className="px-3 py-8 text-center text-[11px] font-semibold leading-relaxed text-zinc-500">
                {activeTab === FAVS_RAIL
                  ? "Your list is empty — tap the heart on any channel to pin it here."
                  : "Nothing in this section right now."}
              </p>
            )}
            {visible.map((c) => {
              const current = String(c.id) === String(channel?.id);
              const isFav = Boolean(favs?.has?.(String(c.id)));
              return (
                <div
                  key={c.id}
                  ref={current ? currentRow : null}
                  className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition ${
                    current ? "bg-white/15" : "hover:bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    aria-label={`Watch ${c.name}${current ? " (now playing)" : ""}`}
                    aria-current={current ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/60 p-0.5">
                      <RowLogo channel={c} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] font-bold ${current ? "text-white" : "text-zinc-300"}`}>
                        {c.name}
                      </span>
                      <span className="block truncate text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                        {current ? "Now playing" : sectionLabel(c.section)}
                      </span>
                    </span>
                  </button>
                  {onToggleFav && (
                    <button
                      type="button"
                      onClick={() => onToggleFav(c.id)}
                      aria-label={isFav ? `Remove ${c.name} from favorites` : `Add ${c.name} to favorites`}
                      title={isFav ? "Remove from My List" : "Add to My List"}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm transition active:scale-90 ${
                        isFav ? "border-white/20 bg-white text-black" : "border-white/10 bg-black/40 text-zinc-400 hover:text-white"
                      }`}
                    >
                      <i className={isFav ? "ri-heart-3-fill" : "ri-heart-3-line"} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default LiveTvChannelOverlay;
