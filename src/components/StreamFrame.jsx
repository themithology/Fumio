import { useEffect, useMemo, useState } from "react";
import { SOURCES, buildStreamUrl, defaultAudio } from "../providers/sources.js";

// ─── StreamFrame ────────────────────────────────────────────────────────────
// The real player: an iframe pointed at one of TheOGPirateBot's actual
// working embed hosts (see providers/sources.js), with exactly two controls
// — Quality (which host/tier) and Audio (that host's language track, when it
// documents one). No server-switcher grid, no ads, no party mode.

export default function StreamFrame({ tmdbId, mediaType, season, episode }) {
  const [sourceId, setSourceId] = useState(SOURCES[0].id);
  const [audio, setAudio] = useState(defaultAudio(SOURCES[0]));
  const [loading, setLoading] = useState(true);

  const source = useMemo(() => SOURCES.find((s) => s.id === sourceId) || SOURCES[0], [sourceId]);

  useEffect(() => {
    setAudio(defaultAudio(source));
  }, [source]);

  useEffect(() => {
    setLoading(true);
  }, [sourceId, audio, tmdbId, mediaType, season, episode]);

  const src = buildStreamUrl(source, tmdbId, mediaType, season, episode, audio);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-white" />
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Loading {source.name}…
            </span>
          </div>
        )}
        <iframe
          key={src}
          src={src}
          onLoad={() => setLoading(false)}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          frameBorder="0"
          title="Player"
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 text-zinc-300">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Quality</span>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-white outline-none"
          >
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.quality}
              </option>
            ))}
          </select>
        </label>

        {source.audioOptions && (
          <label className="flex items-center gap-2 text-zinc-300">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Audio</span>
            <select
              value={audio}
              onChange={(e) => setAudio(e.target.value)}
              className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-white outline-none"
            >
              {source.audioOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
