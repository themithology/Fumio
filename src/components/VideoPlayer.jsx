import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";

// ─── VideoPlayer ────────────────────────────────────────────────────────────
// A plain <video> + hls.js player with exactly two controls beyond the
// native scrubber: Quality and Audio. No server picker, no iframe, no ads —
// this is the whole "simplified UI" the skeleton asked for. Both dropdowns
// are driven directly by what hls.js reads out of the manifest (`hls.levels`
// / `hls.audioTracks`), so any real provider that returns a proper
// multivariant HLS stream gets this UI for free.

const qualityLabel = (level) => {
  if (!level) return "Auto";
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
  return "Unknown";
};

export default function VideoPlayer({ src, type = "hls", poster, autoPlay = true, className = "" }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  const [levels, setLevels] = useState([]); // [{ index, label }]
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = Auto
  const [activeLevel, setActiveLevel] = useState(null); // the level auto-selected right now

  const [audioTracks, setAudioTracks] = useState([]); // [{ index, label }]
  const [currentAudio, setCurrentAudio] = useState(-1);

  const [error, setError] = useState(null);
  const [usingNativeHls, setUsingNativeHls] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;

    setError(null);
    setLevels([]);
    setAudioTracks([]);
    setCurrentLevel(-1);
    setCurrentAudio(-1);
    setActiveLevel(null);

    if (type !== "hls") {
      // Plain progressive file (mp4/webm) — no ABR, nothing to pick.
      setUsingNativeHls(false);
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    if (Hls.isSupported()) {
      setUsingNativeHls(false);
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        setLevels(
          (data.levels || []).map((lvl, index) => ({ index, label: qualityLabel(lvl) }))
        );
        if (autoPlay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        setActiveLevel(data.level);
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_evt, data) => {
        setAudioTracks(
          (data.audioTracks || []).map((t, index) => ({
            index,
            label: t.name || t.lang || `Track ${index + 1}`,
          }))
        );
        setCurrentAudio(hls.audioTrack ?? -1);
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setError(`Playback error: ${data.details || data.type}`);
        }
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari fallback: native HLS has no JS-level quality/audio API, so the
      // dropdowns simply won't render (ABR runs invisibly, like a native app).
      setUsingNativeHls(true);
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    setError("This browser can't play HLS streams.");
    return undefined;
  }, [src, type, autoPlay]);

  const selectQuality = useCallback((index) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index; // -1 = back to Auto (ABR decides)
    setCurrentLevel(index);
  }, []);

  const selectAudio = useCallback((index) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.audioTrack = index;
    setCurrentAudio(index);
  }, []);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
        <video
          ref={videoRef}
          poster={poster}
          controls
          playsInline
          className="h-full w-full"
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 px-6 text-center text-sm text-zinc-300">
            {error}
          </div>
        )}
      </div>

      {(levels.length > 0 || audioTracks.length > 0) && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {levels.length > 0 && (
            <label className="flex items-center gap-2 text-zinc-300">
              <span className="font-semibold uppercase tracking-wide text-xs text-zinc-500">Quality</span>
              <select
                value={currentLevel}
                onChange={(e) => selectQuality(Number(e.target.value))}
                className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-white outline-none"
              >
                <option value={-1}>
                  Auto{activeLevel != null && levels[activeLevel] ? ` (${levels[activeLevel].label})` : ""}
                </option>
                {levels.map((lvl) => (
                  <option key={lvl.index} value={lvl.index}>
                    {lvl.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {audioTracks.length > 1 && (
            <label className="flex items-center gap-2 text-zinc-300">
              <span className="font-semibold uppercase tracking-wide text-xs text-zinc-500">Audio</span>
              <select
                value={currentAudio}
                onChange={(e) => selectAudio(Number(e.target.value))}
                className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-white outline-none"
              >
                {audioTracks.map((t) => (
                  <option key={t.index} value={t.index}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {usingNativeHls && (
            <span className="text-xs text-zinc-500">
              Native HLS playback — quality/audio handled by the browser.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
