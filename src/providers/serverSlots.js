import { FUMIO_SOURCES, TG_VID_SOURCE } from "./sources.js";

// Public labels follow the streaming registry used by the current player.
// Stable source ids remain separate from these labels so deep links and saved
// preferences survive copy changes.
const NORMAL_LABELS = {
  tgvid: "Server 1 (Hindi•English•Multi Language Ad Free)",
  vidstuck: "Server 2 (Hindi•English•Multi-language AD Supported)",
  bingr: "Server 3 (Hindi • Multi • Highest Bitrate)",
  roxy: "Server 4 (Original Language • Fast Streams)",
  vidfast: "Server 5 (Original Audio • 4K • Ads)",
  nxsha: "Server 6 (Hindi • Dual Audio)",
};

const ANIME_LABELS = {
  tgvid: "Server 1 (Hindi•English•Multi Ad Free)",
  sub: "HD-1 Sub",
  dub: "HD-1 Dub",
  sub2: "HD-2 Sub",
  dub2: "HD-2 Dub",
  sub3: "HD-3 Sub",
  dub3: "HD-3 Dub",
  roxy: "Roxy (Sub Backup)",
  vidfast: "VidFast (Original Audio • 4K • Ads)",
  vidstuck: "VidStuck (Hindi•English•Multi)",
  bingr: "Bingr (Hindi • Multi • Highest Bitrate)",
  nxsha: "NXSHA (Hindi • Dual Audio)",
};

const withLabel = (source, labels) => ({
  ...source,
  name: labels[source.id] || source.name,
});

const byId = new Map(FUMIO_SOURCES.map((source) => [source.id, source]));

/**
 * Build the current normal/anime picker order without duplicating source keys.
 * The actual URLs still come from the existing Fumio source definitions.
 */
export function buildPlayerServerSlots({ animeSources = [] } = {}) {
  const resolvedAnime = [];
  const seen = new Set();
  for (const source of animeSources || []) {
    if (!source?.id || seen.has(source.id)) continue;
    seen.add(source.id);
    resolvedAnime.push(withLabel(source, ANIME_LABELS));
  }

  const isAnime = resolvedAnime.length > 0;
  const normalOrder = ["vidstuck", "bingr", "roxy", "vidfast", "nxsha"];
  const normalSources = normalOrder
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((source) => withLabel(source, NORMAL_LABELS));
  if (!isAnime) {
    return {
      isAnime: false,
      fallbackSources: normalSources,
      pickerSources: [withLabel(TG_VID_SOURCE, NORMAL_LABELS), ...normalSources],
    };
  }

  // Anime keeps all three HD Sub/Dub pairs prominent, then keeps Fumio's
  // original normal fallback providers available instead of removing them.
  const animeExtras = ["roxy", "vidfast", "vidstuck", "bingr", "nxsha"]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((source) => withLabel(source, ANIME_LABELS));
  const animeFallbacks = [...resolvedAnime, ...animeExtras];
  const animePicker = [withLabel(TG_VID_SOURCE, ANIME_LABELS), ...animeFallbacks];

  return {
    isAnime: true,
    fallbackSources: animeFallbacks,
    pickerSources: animePicker,
  };
}
