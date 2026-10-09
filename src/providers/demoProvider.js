// ─── Demo provider ──────────────────────────────────────────────────────────
// Returns Apple's public "bipbop advanced" HLS reference stream: a real
// multivariant playlist with several video-quality renditions AND several
// audio renditions (language tracks) + subtitles, so hls.js's `levels` and
// `audioTracks` are populated exactly like a real extractor's output would
// be. Nothing here is tied to the requested title — it exists purely to
// prove out the Quality/Audio UI without a working raw extractor on hand.
//
// Replace this file (and its entry in ./index.js) with a real provider that
// resolves `tmdbId`/`type`/`season`/`episode` to an actual stream.

const DEMO_HLS_URL =
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8";

export async function resolve({ title } = {}) {
  return {
    url: DEMO_HLS_URL,
    type: "hls",
    label: `Demo stream${title ? ` — standing in for "${title}"` : ""}`,
  };
}
