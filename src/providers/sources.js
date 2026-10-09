// Stream sources used by TheOGPirateBot's fullscreen player.
//
// TG Vid is the preferred source. The existing TheOGPirateBot provider list
// is deliberately kept intact behind it, so a failed TG Vid probe, iframe
// error, or loading timeout silently advances to the next source.

function buildSource({ id, name, quality, audioOptions, movieUrl, tvUrl, primary = false }) {
  return {
    id,
    name,
    quality,
    primary,
    audioOptions: audioOptions || null,
    url: (tmdbId, mediaType, season, episode, audio) =>
      mediaType === "movie" ? movieUrl(tmdbId, audio) : tvUrl(tmdbId, season, episode, audio),
  };
}

// The new first attempt. These options match TG Vid's documented language
// values; the current UI uses Hindi by default and still keeps the host's own
// language fallback when a title has no Hindi track.
export const TG_VID_SOURCE = buildSource({
  id: "tgvid",
  name: "TG Vid",
  quality: "HD • Ad-Free",
  primary: true,
  audioOptions: [
    { value: "hi", label: "Hindi" },
    { value: "eng", label: "English" },
    { value: "jap", label: "Japanese" },
    { value: "tam", label: "Tamil" },
    { value: "tel", label: "Telugu" },
  ],
  movieUrl: (id, audio) =>
    `https://tgvid.lovable.app/embed/movie/${id}?color=ffffff&back=true&lang=${audio}`,
  tvUrl: (id, season, episode, audio) =>
    `https://tgvid.lovable.app/embed/tv/${id}/${season}/${episode}?color=ffffff&back=true&lang=${audio}&episodeSelector=false&autoplayNextEp=false`,
});

// The previous/current TheOGPirateBot player sources. Their order is the
// fallback order and should not be changed casually: each source is a
// different host with a different catalog and audio coverage.
export const THE_OG_PLAYER_SOURCES = [
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
    tvUrl: (id, season, episode, audio) =>
      `https://vidstuck.xyz/embed/tv/${id}/${season}/${episode}?branding=TheOGPirateBot&server=centaurus&overlay=true&color=ffffff&dubLang=${audio}&subtitle=english&loading=2`,
  }),
  buildSource({
    id: "vidfast",
    name: "VidFast",
    quality: "4K • Original Audio",
    movieUrl: (id) => `https://vidfast.vc/movie/${id}?autoPlay=true`,
    tvUrl: (id, season, episode) => `https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true`,
  }),
  buildSource({
    id: "bingr",
    name: "Bingr",
    quality: "HD • Multi-language",
    movieUrl: (id) => `https://bingr.one/watch/movie/${id}`,
    tvUrl: (id, season, episode) => `https://bingr.one/watch/tv/${id}/${season}/${episode}`,
  }),
  buildSource({
    id: "roxy",
    name: "Roxy",
    quality: "HD",
    movieUrl: (id) => `https://zxcstream.xyz/player/movie/${id}?dubLang=en&server=0`,
    tvUrl: (id, season, episode) =>
      `https://zxcstream.xyz/player/tv/${id}/${season}/${episode}?dubLang=en&server=0`,
  }),
  buildSource({
    id: "nxsha",
    name: "NXSHA",
    quality: "HD • Hindi Dual Audio",
    movieUrl: (id) => `https://nxsha.space/embed/movie/${id}?lang=hi&disable_app_ad=true`,
    tvUrl: (id, season, episode) =>
      `https://nxsha.space/embed/tv/${id}/${season}/${episode}?lang=hi&disable_app_ad=true`,
  }),
];

// Public list consumed by PlayerStage. Keeping this as a derived array makes
// the primary/fallback contract obvious and prevents TG Vid from being
// accidentally duplicated in the fallback list.
export const SOURCES = [TG_VID_SOURCE, ...THE_OG_PLAYER_SOURCES];

export function defaultAudio(source) {
  return source.audioOptions ? source.audioOptions[0].value : null;
}

export function buildStreamUrl(source, tmdbId, mediaType, season, episode, audio) {
  return source.url(tmdbId, mediaType, season, episode, audio ?? defaultAudio(source));
}
