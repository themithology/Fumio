// ─── Real stream sources ────────────────────────────────────────────────────
// Ported straight from Iris/TheOGPirateBot's src/utils/players.js
// (getPlayerUrls) — the actual, currently-working embed hosts the production
// site streams from. No demo stream, no placeholder: these are the same
// hosts TheOGPirateBot serves today, for movies and TV (the anime-only
// Sub/Dub/ToonStream lane from Iris needs its AniList bridge + the
// /api/toon-stream resolver and isn't ported here — this is the plain
// movie/TV lane).
//
// Each source is a "Quality" option in the player UI. A source whose host
// documents a language/audio query param also gets an "Audio" dropdown that
// rebuilds its URL with the chosen value — real, host-documented behaviour,
// not a fake control.

function buildSource({ id, name, quality, audioOptions, movieUrl, tvUrl }) {
  return {
    id,
    name,
    quality,
    audioOptions: audioOptions || null,
    url: (tmdbId, mediaType, season, episode, audio) =>
      mediaType === "movie" ? movieUrl(tmdbId, audio) : tvUrl(tmdbId, season, episode, audio),
  };
}

export const SOURCES = [
  buildSource({
    id: "tgvid",
    name: "TGVID",
    quality: "HD • Ad-Free",
    audioOptions: [
      { value: "hi", label: "Hindi" },
      { value: "eng", label: "English" },
      { value: "jap", label: "Japanese" },
      { value: "tam", label: "Tamil" },
      { value: "tel", label: "Telugu" },
    ],
    movieUrl: (id, audio) => `https://tgvid.lovable.app/embed/movie/${id}?color=ffffff&back=true&lang=${audio}`,
    tvUrl: (id, s, e, audio) =>
      `https://tgvid.lovable.app/embed/tv/${id}/${s}/${e}?color=ffffff&back=true&lang=${audio}&episodeSelector=false&autoplayNextEp=false`,
  }),
  buildSource({
    id: "vidstuck",
    name: "VidStuck",
    quality: "HD • Multi-language",
    audioOptions: [
      { value: "hi", label: "Hindi" },
      { value: "en", label: "English" },
    ],
    movieUrl: (id, audio) =>
      `https://vidstuck.xyz/embed/movie/${id}?branding=TheOGPirateBot&server=centaurus&overlay=true&color=ffffff&dubLang=${audio}&subtitle=english&loading=2`,
    tvUrl: (id, s, e, audio) =>
      `https://vidstuck.xyz/embed/tv/${id}/${s}/${e}?branding=TheOGPirateBot&server=centaurus&overlay=true&color=ffffff&dubLang=${audio}&subtitle=english&loading=2`,
  }),
  buildSource({
    id: "vidfast",
    name: "VidFast",
    quality: "4K • Original Audio",
    movieUrl: (id) => `https://vidfast.vc/movie/${id}?autoPlay=true`,
    tvUrl: (id, s, e) => `https://vidfast.vc/tv/${id}/${s}/${e}?autoPlay=true`,
  }),
  buildSource({
    id: "bingr",
    name: "Bingr",
    quality: "HD • Multi-language",
    movieUrl: (id) => `https://bingr.one/watch/movie/${id}`,
    tvUrl: (id, s, e) => `https://bingr.one/watch/tv/${id}/${s}/${e}`,
  }),
  buildSource({
    id: "roxy",
    name: "Roxy",
    quality: "HD",
    movieUrl: (id) => `https://zxcstream.xyz/player/movie/${id}?dubLang=en&server=0`,
    tvUrl: (id, s, e) => `https://zxcstream.xyz/player/tv/${id}/${s}/${e}?dubLang=en&server=0`,
  }),
  buildSource({
    id: "nxsha",
    name: "NXSHA",
    quality: "HD • Hindi Dual Audio",
    movieUrl: (id) => `https://nxsha.space/embed/movie/${id}?lang=hi&disable_app_ad=true`,
    tvUrl: (id, s, e) => `https://nxsha.space/embed/tv/${id}/${s}/${e}?lang=hi&disable_app_ad=true`,
  }),
];

export function defaultAudio(source) {
  return source.audioOptions ? source.audioOptions[0].value : null;
}

export function buildStreamUrl(source, tmdbId, mediaType, season, episode, audio) {
  return source.url(tmdbId, mediaType, season, episode, audio ?? defaultAudio(source));
}
