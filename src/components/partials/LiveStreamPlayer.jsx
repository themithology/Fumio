import React, { useEffect, useRef, useState } from "react";
import { LiveDot } from "./LiveTvRail";

// ─── LiveStreamPlayer — direct IPTV playback (open-source hls.js) ───────────
// For channels with no provider embed (F1 TV, NBA TV): plays their public
// HLS playlists through native HLS on Safari/iOS (zero extra bytes) and
// through hls.js everywhere else — dynamically imported, so the ~600 kB
// engine only downloads when an IPTV channel actually plays, never for the
// embed channels. `streams` is an ordered failover list: a dead feed
// auto-advances to the next URL; the error state only appears when ALL are
// exhausted. Public restreams rotate often, so the last line of defense is
// the Retry button (re-tries from the top of the list).
// Playlist-wrapper unwrap: aggregators (iptvcat my_list links) hand out M3U
// *wrappers* — one #EXTINF line pointing at the real HLS manifest. hls.js
// fatals on those (no EXT-X-STREAM-INF / TARGETDURATION), so peek at the
// response first and follow the inner URL when that's what we got. The
// `checkedby` tag iptvcat appends is stripped — origins never need it and
// signed hosts can reject it. Any fetch failure (CORS included) falls back
// to the raw URL, i.e. exactly today's behavior.
const customFeedKey = (k) => `livetv-custom-feed:${k || "default"}`;
const loadCustomFeed = (k) => {
  try {
    const v = localStorage.getItem(customFeedKey(k));
    return v && /^https?:\/\//.test(v) ? v : "";
  } catch {
    return "";
  }
};

const resolveFeedUrl = async (url, signal) => {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return url;
    const text = await res.text();
    if (!text.includes("#EXTINF")) return url;
    if (text.includes("#EXT-X-STREAM-INF") || text.includes("#EXT-X-TARGETDURATION")) return url;
    const inner = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^https?:\/\//.test(l));
    if (!inner) return url;
    return inner.replace(/[?&]checkedby[^&]*/g, "").replace(/[?&]$/, "");
  } catch {
    return url;
  }
};

const LiveStreamPlayer = ({ streams, title = "Live TV", logo = "", className = "", feedKey = "" }) => {
  const videoRef = useRef(null);
  const attemptRef = useRef(0);
  const playedRef = useRef(false);
  const errRef = useRef([]);
  const roughRef = useRef(0);
  const [idx, setIdx] = useState(0);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState("loading"); // loading | playing | error
  const [muted, setMuted] = useState(true);
  const [errInfo, setErrInfo] = useState("");

  const [custom, setCustom] = useState(() => (feedKey ? loadCustomFeed(feedKey) : ""));
  const [draft, setDraft] = useState(custom);
  const baseList = Array.isArray(streams) ? streams.filter(Boolean) : [];
  const list = custom ? [custom, ...baseList.filter((u) => u !== custom)] : baseList;
  const url = list[Math.min(idx, Math.max(list.length - 1, 0))] || null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) {
      setStatus("error");
      return undefined;
    }
    setStatus("loading");
    playedRef.current = false;
    let hls = null;
    let cancelled = false;

    const failover = (reason) => {
      if (cancelled) return;
      const failedIdx = attemptRef.current;
      errRef.current.push(`feed ${failedIdx + 1}: ${reason || "failed"}`);
      if (import.meta.env.DEV) console.warn("[LiveTV] feed failed:", list[failedIdx], reason);
      attemptRef.current += 1;
      if (attemptRef.current < list.length) {
        setIdx(attemptRef.current);
      } else {
        setErrInfo(errRef.current.join(" · "));
        setStatus("error");
      }
    };
    const onNativeError = () => failover("native playback failed");

    const onPlaying = () => {
      if (cancelled) return;
      playedRef.current = true;
      setStatus("playing");
    };
    video.addEventListener("playing", onPlaying);

    // Watchdog: a feed that can't produce a frame within 15 s is treated
    // as dead — fail over instead of sitting on the grey veil forever.
    const watchdog = setTimeout(() => {
      if (cancelled || playedRef.current) return;
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* already torn down */
        }
        hls = null;
      }
      failover("no frame within 15 s");
    }, 15000);

    // Aggregator wrappers (iptvcat my_list) resolve to the inner feed first;
    // genuine manifests pass through untouched.
    const ctrl = new AbortController();
    const resolveTimer = setTimeout(() => ctrl.abort(), 8000);
    const boot = (feedUrl) => {
      if (cancelled) return;
      // Engine pick: hls.js everywhere it runs — EXCEPT real Apple pipes.
      // canPlayType alone lies on some Chromium forks (Brave/Android claims
      // native HLS, then fails every feed), so native is trusted only on
      // Safari/iOS or when MediaSource doesn't exist at all.
      const ua = navigator.userAgent || "";
      const isiOS = /iPad|iPhone|iPod/.test(ua);
      const isAppleBrowser = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android/.test(ua);
      const hasMSE = typeof window.MediaSource !== "undefined";
      const canNative = video.canPlayType("application/vnd.apple.mpegurl");
      if (canNative && (isiOS || isAppleBrowser || !hasMSE)) {
        video.addEventListener("error", onNativeError);
        video.src = feedUrl;
        video.play?.().catch(() => {});
      } else if (!hasMSE) {
        failover("HLS unsupported here");
      } else {
        import("hls.js").then(
          ({ default: Hls }) => {
            if (cancelled) return;
            if (!Hls.isSupported()) {
              failover("hls.js unsupported here");
              return;
            }
            // Lean retries + lightest-first start: a dead feed must die in
            // seconds (the app failover is the recovery), and slow networks
            // tune instantly instead of stalling on 1080p.
            hls = new Hls({
              maxBufferLength: 30,
              liveSyncDurationCount: 3,
              startLevel: 0,
              manifestLoadingMaxRetry: 1,
              levelLoadingMaxRetry: 1,
              fragLoadingMaxRetry: 2,
            });
            hls.on(Hls.Events.ERROR, (_, data) => {
              if (cancelled) return;
              if (data?.fatal) {
                try {
                  hls.destroy();
                } catch {
                  /* already torn down */
                }
                hls = null;
                failover(`hls ${data.details}`);
                return;
              }
              // Non-fatal stall loop (frozen live edge, buffer starvation):
              // repeated media errors without progress also abandon the feed.
              // Cosmetic track errors never count — dead subtitles must not
              // kill an otherwise playing feed.
              const detail = String(data?.details || "");
              if (/SUBTITLE|AUDIO_TRACK/.test(detail)) return;
              roughRef.current += 1;
              if (roughRef.current >= 8) {
                roughRef.current = 0;
                try {
                  hls.destroy();
                } catch {
                  /* already torn down */
                }
                hls = null;
                failover(`stalled (${detail || "repeated errors"})`);
              }
            });
            // Delivered fragments = progress: the feed is alive, reset the
            // stall counter even before the first frame renders.
            hls.on(Hls.Events.FRAG_CHANGED, () => {
              roughRef.current = 0;
            });
            hls.loadSource(feedUrl);
            hls.attachMedia(video);
            video.play?.().catch(() => {});
          },
          () => {
            if (!cancelled) setStatus("error");
          }
        );
      }
    };
    resolveFeedUrl(url, ctrl.signal).then((feedUrl) => {
      clearTimeout(resolveTimer);
      boot(feedUrl);
    });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      clearTimeout(resolveTimer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onNativeError);
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* already torn down */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, retry]);

  const unmute = () => {
    const video = videoRef.current;
    if (video) video.muted = false;
    setMuted(false);
  };

  const playCustom = () => {
    const next = draft.trim();
    if (!/^https?:\/\//.test(next)) return;
    try {
      localStorage.setItem(customFeedKey(feedKey), next);
    } catch {
      /* private mode — plays for this session only */
    }
    attemptRef.current = 0;
    roughRef.current = 0;
    errRef.current = [];
    setErrInfo("");
    setCustom(next);
    setIdx(0);
    setRetry((r) => r + 1);
  };
  const clearCustom = () => {
    try {
      localStorage.removeItem(customFeedKey(feedKey));
    } catch {
      /* ignore */
    }
    setCustom("");
    setDraft("");
    attemptRef.current = 0;
    roughRef.current = 0;
    errRef.current = [];
    setErrInfo("");
    setIdx(0);
    setRetry((r) => r + 1);
  };
  const retryAll = () => {
    attemptRef.current = 0;
    roughRef.current = 0;
    errRef.current = [];
    setErrInfo("");
    setIdx(0);
    setRetry((r) => r + 1);
  };

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        autoPlay
        muted={muted}
        playsInline
        controls={status === "playing"}
        aria-label={`${title} live stream`}
      />

      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(110%_130%_at_50%_0%,#17171a_0%,#000_70%)]">
          <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-2.5 sm:h-20 sm:w-20">
            {logo ? (
              <img src={logo} alt="" className="h-full w-full object-contain" />
            ) : (
              <i className="ri-tv-line text-3xl text-zinc-600" />
            )}
          </span>
          <span className="flex items-center gap-2">
            <LiveDot />
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Tuning in…{idx > 0 ? ` · feed ${idx + 1}` : ""}
            </span>
          </span>
          <span className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full w-1/2 animate-[tuningSlide_1.1s_ease-in-out_infinite] rounded-full bg-white/80" />
          </span>
        </div>
      )}

      {status === "playing" && muted && (
        <button
          onClick={unmute}
          className="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-black shadow-2xl transition hover:bg-zinc-200 active:scale-95"
        >
          <i className="ri-volume-up-line text-base" /> Tap for sound
        </button>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black px-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-500">
            <i className="ri-signal-wifi-error-line text-xl" />
          </span>
          <p className="text-sm font-black text-white">{title} is unavailable</p>
          <p className="max-w-xs text-[11px] leading-relaxed text-zinc-500">
            Every public feed for this channel is down right now — these
            restreams rotate often. Try again in a bit.
          </p>
          {errInfo && (
            <p className="max-w-xs break-words font-mono text-[10px] leading-relaxed text-zinc-600">
              {errInfo}
            </p>
          )}
          <button
            onClick={retryAll}
            className="mt-1 flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-black text-black transition hover:bg-zinc-200 active:scale-95"
          >
            <i className="ri-refresh-line" /> Retry feeds
          </button>
          <div className="mt-3 w-full max-w-xs">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Have a feed? Paste it
            </p>
            <div className="flex gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") playCustom();
                }}
                placeholder="https://…m3u8"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 font-mono text-[11px] text-white placeholder-zinc-600 outline-none transition focus:border-white/40"
              />
              <button
                onClick={playCustom}
                className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-black text-black transition hover:bg-zinc-200 active:scale-95"
              >
                Play
              </button>
            </div>
            {custom ? (
              <button
                onClick={clearCustom}
                className="mt-1.5 text-[10px] font-bold text-zinc-500 underline underline-offset-2 transition hover:text-zinc-300"
              >
                Clear saved feed (tries first)
              </button>
            ) : (
              <p className="mt-1.5 text-[10px] font-semibold text-zinc-600">
                Saved on this device · tries before built-ins
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveStreamPlayer;
