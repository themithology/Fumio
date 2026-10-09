// ─── Provider registry ──────────────────────────────────────────────────────
// This is Fumio's "Extensions" hook (see the project README): a provider is
// any async function that turns (tmdbId, type, season, episode) into a RAW
// stream — a direct video URL the <video> element / hls.js can play, not an
// iframe embed. That's the whole point of the skeleton: the player shows a
// real "Quality" and "Audio" picker because the source itself exposes real
// quality levels / audio renditions, instead of a list of branded iframe
// servers like Iris's picker.
//
// Add a real provider by dropping a file in this folder that exports
// `resolve({ tmdbId, type, season, episode, title })` returning:
//   {
//     url: string,                 // master .m3u8 (or a plain .mp4)
//     type: "hls" | "mp4",
//     label: string,               // shown in the UI as the source name
//     audioTracks?: [{ id, label, language }], // only if NOT already in the
//                                               // HLS manifest (hls.js reads
//                                               // multi-audio renditions
//                                               // automatically otherwise)
//   }
// then register it below. VideoPlayer.jsx needs nothing provider-specific —
// hls.js exposes levels (quality) and audioTracks straight from the manifest.
//
// This sandbox can only reach github/npm/pypi, so no real third-party
// extractor could be built or tested here. DEMO_PROVIDER below plays a
// public multi-bitrate, multi-audio-track test stream (Apple's bipbop
// "advanced" reference asset) so the Quality + Audio UI is fully wired and
// provable end-to-end. Swap it for a real extractor whenever you have one.

import { resolve as demoResolve } from "./demoProvider.js";

export const PROVIDERS = [
  { id: "demo", name: "Demo stream (replace with a real provider)", resolve: demoResolve },
];

export async function resolveStream(request) {
  const errors = [];
  for (const provider of PROVIDERS) {
    try {
      const result = await provider.resolve(request);
      if (result && result.url) return { ...result, provider: provider.id, providerName: provider.name };
    } catch (err) {
      errors.push(`${provider.id}: ${err?.message || err}`);
    }
  }
  throw new Error(`No provider resolved a stream. ${errors.join(" | ")}`);
}
