// ─── Live TV — curated data layer (pure, no DOM) ────────────────────────────
// Source: the public TG TV channel API (https://livetgtv.lovable.app).
// The site is sports-first: Sports, TV Serials, Kids and major Infotainment.
// News, devotional, music, movies and junk (TEST/DD-relay) channels are NEVER
// listed — see isBannedLiveName + the per-section filters below.
//
// Two-tier data, so the guide is instant AND fresh:
//   1. SNAPSHOT — ~90 hand-verified channels baked into the bundle. The hub
//      renders this synchronously: zero loading flash, works even when the
//      API is unreachable or the browser blocks the cross-origin fetch.
//   2. LIVE overlay (utils/liveTv.js) — the same ?category= endpoints are
//      re-fetched at runtime (6 h cache); live entries refresh names/logos,
//      unknown-but-clean newcomers are appended, banned names are dropped.
//
// Entry format is a compact tuple [id, name, logo] — the section is implied
// by the array it lives in. ids are STRINGS (the API keys everything by its
// own numeric id, e.g. "1108"). Playback never needs the list: embedUrl(id)
// builds the iframe src for any id, so deep links keep working.

export const LIVE_TV_API_BASE = "https://livetgtv.lovable.app";
export const LIVE_TV_API = `${LIVE_TV_API_BASE}/api/public/channels`;

export const liveTvEmbedUrl = (id) => `${LIVE_TV_API_BASE}/embed/${id}`;
export const liveTvWatchUrl = (id) => `${LIVE_TV_API_BASE}/watch/${id}`;
export const liveTvCategoryUrl = (category) =>
  `${LIVE_TV_API}?category=${encodeURIComponent(category)}`;

// ── Direct IPTV streams (open-source hls.js playback, no provider embed) ────
// livetgtv doesn't carry F1/NBA, so these ride public IPTV playlists. Each id
// maps to an ordered failover list — the player tries them top-down and only
// shows an error when ALL are exhausted. Public restreams rotate often: when
// one dies, replace its URL here (one line) — no player changes needed.
// https only: browsers block http streams on an https page (mixed content).
// Store INNER feeds, never aggregator wrappers: an M3U wrapper with a single
// #EXTINF line (iptvcat my_list links) is not HLS — hls.js fatals on it.
// (The player also unwraps at runtime as a safety net for pasted links.)
export const LIVE_TV_STREAMS = {
  // Re-probed 2026-09-30 from a GitHub runner (scripts/probe-live-streams.mjs:
  // playlist → media sequence advancing → segment 200 → CORS open).
  // Dropped as DEAD: xemzi.short.gy/2000005, z02.ubtvfans.com (F1);
  // ft.fbcdntv247.cfd, rezofoot.tv (NBA). Pluto (jmp2.uk) is live but its
  // CORS only allows pluto.tv — unplayable in our player.
  // NOTE: iptv-org marks the amagi/akamai feeds US-geo-blocked — outside the
  // US they can answer 403 and the player fails over down the list.
  f1tv: [
    // "F1 Channel" FAST (Formula 1's own free channel: highlights, classic
    // races, docs — not live Grands Prix). LIVE, CORS *.
    "https://amg12058-c15studio-amg12058c1-lg-us-5787.playouts.now.amagi.tv/playlist.m3u8",
  ],
  nbatv: [
    // "The NBA Channel" via Akamai — adaptive 360p→1080p. LIVE, CORS *.
    "https://pb-5pdyic0cu7tri.akamaized.net/NBA.m3u8",
    // NBA TV (FireTV FAST feed). LIVE, CORS *.
    "https://amg00556-amg00556c3-firetv-us-6060.playouts.now.amagi.tv/playlist.m3u8",
    // NBA FAST Channel (Tubi). LIVE, CORS *.
    "https://live-manifest.production-public.tubi.io/live/553b8d5e-fd2a-4a61-bdfa-73b34c299d75/playlist.m3u8",
  ],
};

/** Ordered failover list for direct-play channels, or null (embed path). */
// Direct feeds first (US viewers never touch our server), then the same feeds
// through the Iris server's US relay (/live-relay, server/liveRelay.js) for
// viewers the feed geo-blocks. The player auto-advances on failure. On hosts
// without the Node server (static/Vercel) the relay 404s and is just skipped.
export const liveTvRelayUrl = (url) => `/live-relay?u=${encodeURIComponent(url)}`;
export const liveTvStreamsFor = (id) => {
  const list = LIVE_TV_STREAMS[String(id || "")];
  return list ? [...list, ...list.map(liveTvRelayUrl)] : null;
};

// ── Sections ────────────────────────────────────────────────────────────────
// `api` is the upstream category probed at runtime (null = runtime-enriched
// from the full list only — regional GEC majors don't have their own facet).
export const LIVE_TV_SECTIONS = [
  { key: "sports", label: "Sports", icon: "ri-trophy-line", api: "Sports", blurb: "Star Sports, Sony Sports & more" },
  { key: "moviesHi", label: "Hindi Movies", icon: "ri-film-line", api: "Movies", blurb: "Star Gold, Zee Cinema, Sony Max" },
  { key: "moviesEn", label: "English Movies", icon: "ri-clapperboard-line", api: null, blurb: "Star Movies, Movies Now, Sony Pix" },
  { key: "serials", label: "Serials", icon: "ri-tv-2-line", api: "Entertainment", blurb: "Star Plus, Colors, Zee TV, Sony" },
  { key: "kids", label: "Kids", icon: "ri-bear-smile-line", api: "Kids", blurb: "Nick, Pogo, Cartoon Network & Disney" },
  { key: "info", label: "Infotainment", icon: "ri-earth-line", api: "Infotainment", blurb: "Discovery, Animal Planet, History" },
  { key: "regional", label: "Regional", icon: "ri-map-pin-line", api: null, blurb: "Sun TV, Vijay, Asianet, Zee Marathi…" },
];

const JIO = "https://jiotv.catchup.cdn.jio.com/dare_images/images/";
const JIO_IMG = "https://img.media.jio.com/tvpimages/";

// Inline badge art for the IPTV-only channels (no provider logo to hotlink).
const F1_BADGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' rx='26' fill='%23E10600'/%3E%3Ctext x='66' y='86' font-family='Arial Black,Arial,sans-serif' font-size='56' font-style='italic' font-weight='900' fill='white' text-anchor='middle'%3EF1%3C/text%3E%3C/svg%3E";
const NBA_BADGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' rx='26' fill='%231D428A'/%3E%3Ctext x='64' y='64' font-family='Arial Black,Arial,sans-serif' font-size='32' font-weight='900' fill='white' text-anchor='middle'%3ENBA%3C/text%3E%3Ctext x='64' y='98' font-family='Arial Black,Arial,sans-serif' font-size='26' font-weight='900' fill='%23C8102E' text-anchor='middle'%3ETV%3C/text%3E%3C/svg%3E";

// ── Snapshot ────────────────────────────────────────────────────────────────
// Order inside each array IS the display order (majors first). Live refresh
// keeps this order and appends unknown-but-clean newcomers alphabetically.

const SPORTS = [
  ["460", "Star Sports Select 1 HD", `${JIO_IMG}96/65/302113_1749664252703_l_medium.jpg`],
  ["1108", "Star Sports 1 Hindi HD", `${JIO_IMG}5/6/301982_1749665314605_l_medium.jpg`],
  ["461", "Star Sports Select 2 HD", `${JIO_IMG}98/79/302114_1749665414817_l_medium.jpg`],
  ["f1tv", "F1 TV", F1_BADGE],
  ["nbatv", "NBA TV", NBA_BADGE],
  ["1106", "Star Sports 1 HD", `${JIO_IMG}76/32/301981_1749665664018_l_medium.jpg`],
  ["362", "Star Sports 1 Hindi", `${JIO_IMG}13/81/302112_1749665154709_l_medium.jpg`],
  ["1142", "Star Sports 1", `${JIO_IMG}56/92/302115_1749665579801_l_medium.jpg`],
  ["1109", "Star Sports 2 HD", `${JIO_IMG}41/51/301983_1749666169105_l_medium.jpg`],
  ["1141", "Star Sports 2", `${JIO_IMG}11/30/302116_1749666029079_l_medium.jpg`],
  ["1984", "Star Sports 2 Hindi HD", `${JIO_IMG}56/36/301229_1742214332015_l_medium.jpg`],
  ["1985", "Star Sports 2 Hindi", `${JIO_IMG}57/17/302124_1749130246443_l_medium.jpg`],
  ["1389", "Star Sports 3", `${JIO_IMG}78/2/302117_1749666092192_l_medium.jpg`],
  ["1123", "Star Sports Select 1", `${JIO_IMG}13/82/301994_1749664069587_l_medium.jpg`],
  ["1114", "Star Sports Select 2", `${JIO_IMG}98/48/301989_1749664475828_l_medium.jpg`],
  ["204", "DD Sports", `${JIO}DD_Sports.png`],
  ["875", "Eurosport HD", `${JIO}Dsports_HD.png`],
  ["1294", "Eurosport", `${JIO}Dsports.png`],
  ["889", "Jio Sports HD", `${JIO}Jio_Sports.png`],
  ["3372", "Sony LIV Sports 1", `${JIO}SonyLIV_Sports_1.png`],
  ["3373", "Sony LIV Sports 2", `${JIO}SonyLIV_Sports_2.png`],
  ["3374", "Sony LIV Sports 3", `${JIO}SonyLIV_Sports_3.png`],
  ["3399", "Sony LIV Sports 5", `${JIO}SonyLIV_Sports_5.png`],
  ["3397", "Sony LIV Sports 4 Tamil", `${JIO}SonyLIV_Sports_4_Tamil.png`],
  ["3398", "Sony LIV Sports 4 Telugu", `${JIO}SonyLIV_Sports_4_Telugu.png`],
  ["3528", "Sony Liv Sports 4 Kannada", `${JIO}SonyLivSports4Kan.png`],
  ["3277", "Star Sports 1 Tamil HD", `${JIO_IMG}19/19/302122_1749662923298_l_medium.jpg`],
  ["1124", "Star Sports 1 Tamil", `${JIO_IMG}69/73/301995_1749664384503_l_medium.jpg`],
  ["3278", "Star Sports 1 Telugu HD", `${JIO_IMG}19/57/302123_1749663029798_l_medium.jpg`],
  ["1651", "Star Sports 1 Telugu", `${JIO_IMG}26/67/302119_1749662981095_l_medium.jpg`],
  ["1650", "Star Sports 1 Kannada", `${JIO_IMG}13/91/302118_1749663894692_l_medium.jpg`],
  ["1122", "Star Sports 2 Kannada", `${JIO_IMG}11/37/301993_1749664589518_l_medium.jpg`],
  ["3273", "Star Sports 2 Tamil HD", `${JIO_IMG}50/43/302120_1749664850899_l_medium.jpg`],
  ["2853", "Star Sports 2 Tamil", `${JIO_IMG}74/92/301561_1749664725619_l_medium.jpg`],
  ["3274", "Star Sports 2 Telugu HD", `${JIO_IMG}84/67/302121_1749664974599_l_medium.jpg`],
  ["2852", "Star Sports 2 Telugu", `${JIO_IMG}41/94/301562_1749665043898_l_medium.jpg`],
  ["2779", "Red Bull TV", `${JIO}Red_Bull_TV.png`],
  ["2766", "BRAVE TV", `${JIO}Brave_TV.png`],
  ["3011", "Lancs TV HD", `${JIO}Lancs_TV_HD.png`],
  ["3146", "All Women's Sports Network", `${JIO}AWSN.png`],
  ["1529", "MI TV", `${JIO}MI_TV.png`],
  ["1163", "JioGames HD", `${JIO}Jio_Esports_HD.png`],
  ["3204", "Penta TV", `${JIO}Penta_TV.png`],
  ["3243", "Pickleball Now", `${JIO}Pickleball_Now.png`],
  ["3530", "UIPM Pentathlon World Cup", `${JIO}UIPMPentathlonWC.png`],
];

const SERIALS = [
  ["1132", "Star Plus HD", `${JIO}Star_Plus_HD.png`],
  ["144", "Colors HD", `${JIO}ColorsHD.png`],
  ["167", "Zee TV HD", `${JIO}ZeeTVHD.png`],
  ["291", "SET HD", `${JIO}Sony_HD.png`],
  ["471", "Sony SAB HD", `${JIO}SonySAB.png`],
  ["472", "And TV HD", `${JIO}AndTVHD.png`],
  ["931", "Star Bharat HD", `${JIO}Star_Bharat_HD.png`],
  ["202", "DD National", `${JIO}DD_National.png`],
  ["1351", "Zee TV", `${JIO}ZeeTV.png`],
  ["1368", "Colors SD", `${JIO}Colors_SD.png`],
  ["154", "Sony SAB SD", "https://jiotvimages.cdn.jio.com/dare_images/images/Sony_SAB.png"],
  ["1143", "Star Utsav", `${JIO}Star_Utsav.png`],
  ["279", "Colors Rishtey", `${JIO}ColorsRishtey.png`],
  ["474", "Sony Pal", `${JIO}SonyPAL.png`],
  ["1359", "Big Magic", `${JIO}BigMagic.png`],
  ["473", "Anmol TV", `${JIO}ZeeAnmol.png`],
  ["1961", "Shemaroo TV", `${JIO}Shemaroo_TV.png`],
  ["2078", "Shemaroo Umang", `${JIO}Shemaroo_Umang.png`],
  ["1393", "Sony Wah", `${JIO}SonyWAH.png`],
];

// Kids, ordered by popularity (high → low, curated 2026-09-24): Nick leads
// the genre in India, then Pogo + the CN family, Sonic and Hungama. Animax
// (the anime flagship, owner request) rides upper-mid for this audience;
// preschool (Nick Jr, Disney Junior), the niche Disney Intl HD and the long
// tail (Gubbare, Power Kids TV) close the rail.
const KIDS = [
  ["545", "Nick Hindi", `${JIO}Nick_Hindi.png`],
  ["559", "Pogo Hindi", `${JIO}Pogo_Hindi.png`],
  ["3436", "Cartoon Network HD+ Hindi", `${JIO}CNHDHindi.png`],
  ["816", "Cartoon Network Hindi", `${JIO}CNHindi.png`],
  ["815", "Sonic Hindi", `${JIO}sonic_Hindi.png`],
  ["1391", "Hungama", `${JIO}Hungama.png`],
  ["2258", "Animax", `${JIO}Animax.png`],
  ["1373", "Disney Channel", `${JIO}Disney_Channel.png`],
  ["1392", "Super Hungama", `${JIO}Super_Hungama.png`],
  ["554", "Discovery Kids Hindi", `${JIO}DiscoveryKidsHin.png`],
  ["872", "Sony Yay Hindi", `${JIO}SonyYAYHin.png`],
  ["548", "Nickelodeon Jr.", `${JIO}Nickelodeon_Jr.png`],
  ["1374", "Disney Junior", `${JIO}Disney_Junior.png`],
  ["1375", "Disney International HD", `${JIO}Disney_International_HD.png`],
  ["3385", "Gubbare", `${JIO}Gubbare.png`],
  ["2774", "Power Kids TV", `${JIO}Power_Kids_TV.png`],
];

const INFO = [
  ["575", "Discovery Hindi", `${JIO}Discovery_Channel_Hindi.png`],
  ["3444", "Discovery HD Hindi", `${JIO}DiscoveryHDHin.png`],
  ["566", "Animal Planet Hindi", `${JIO}AnimalPlanetHin.png`],
  ["578", "History TV18 HD Hindi", `${JIO}History_18_Hindi.png`],
  ["821", "Sony BBC Earth HD", `${JIO}SonyBBCEarthHin.png`],
  ["3453", "Discovery Science Hindi", `${JIO}DiscoveryScienceHin.png`],
  ["3434", "Investigation Discovery HD Hindi", `${JIO}IDHDHindi.png`],
  ["3435", "Investigation Discovery HD English", `${JIO}IDHDEnglish.png`],
  ["242", "Discovery English", `${JIO}Discovery_Channel_Eng.png`],
  ["286", "Animal Planet HD English", `${JIO}AnimalPlanetHDEng.png`],
  ["146", "History TV18 HD", `${JIO}History_HD.png`],
  ["164", "Travelxp HD", `${JIO}Travel_XP_HD.png`],
  ["580", "DD Bharati", `${JIO}DD_bharati.png`],
  ["583", "DD Kisan", `${JIO}DD_Kisan.png`],
  ["871", "Jio Events HD", `${JIO}Jio_Events.png`],
];

// Hindi movie brands, ordered by popularity (high → low) — flagship pay
// majors first, FTA giants (Anmol) next, niche/long-tail last. All 27
// verified 2026-09-24 against the upstream "Movies" facet.
const MOVIES_HI = [
  ["156", "Star Gold HD", `${JIO}Star_Gold_HD.png`],
  ["165", "Zee Cinema HD", `${JIO}ZeeCinemaHD.png`],
  ["476", "Sony Max HD", `${JIO}SonyMAX.png`],
  ["3096", "Star Gold 2 HD", `${JIO}Star_Gold_2_HD.png`],
  ["1477", "Colors Cineplex HD", `${JIO}ColorsCineplexHD.png`],
  ["185", "And Pictures HD", `${JIO}AndPicturesHD.png`],
  ["415", "Zee Anmol Cinema", `${JIO}ZeeAnmolCinema.png`],
  ["1113", "Star Gold Select HD", `${JIO}Star_Gold_Select_HD.png`],
  ["484", "Zee Cinema", `${JIO}ZeeCinema.png`],
  ["483", "Sony MAX2", `${JIO}SonyMAX2.png`],
  ["487", "Zee Bollywood", `${JIO}ZeeBollywood.png`],
  ["482", "Colors Cineplex", `${JIO}Colors_Cineplex.png`],
  ["1839", "And Pictures", `${JIO}AndPictures.png`],
  ["2761", "Zee Anmol Cinema 2", `${JIO}ZeeAnmolCinema2.png`],
  ["1119", "Star Gold Select", `${JIO}Star_Gold_Select.png`],
  ["182", "B4U Movies", `${JIO}b4u_movies.png`],
  ["1691", "Zee Classic", `${JIO}ZeeClassicSD.png`],
  ["488", "Zee Action", `${JIO}ZeeAction.png`],
  ["1450", "Colors Cineplex Superhit", `${JIO}ColorsCineplexSuperhit.png`],
  ["1295", "B4U Kadak", `${JIO}B4U_Kadak.png`],
  ["1763", "Colors Cineplex Bollywood", `${JIO}ColorsCineplexBollywood.png`],
  ["1668", "And Xplor HD", `${JIO}AndXploreHD.png`],
  ["3418", "Sony MAX1", `${JIO}SonyMAX1.png`],
  ["3097", "Star Gold Romance", `${JIO}Star_Gold_Romance.png`],
  ["3098", "Star Gold Thrills", `${JIO}Star_Gold_Thrills.png`],
  ["809", "Maha Movies", `${JIO}Maha_Movies.png`],
  ["3060", "Hiff Movies", `${JIO}Hiff_Movies.png`],
];

// English movie brands, ordered by popularity (high → low) — cherry-picked
// from the 206-channel "English" facet (no dedicated upstream facet exists;
// HBO/Zee Studio absent from the index as of 2026-09-24, so the enrichment
// matcher stays future-proof). Star Gold Thrills + Animax are NOT
// English-facet picks — cross-listed from Hindi Movies and Kids
// (owner requests 2026-09-24).
const MOVIES_EN = [
  ["1104", "Star Movies HD", `${JIO}Star_Movies_HD.png`],
  ["151", "Movies Now HD", `${JIO}Movies_Now_HD.png`],
  ["762", "Sony Pix HD", `${JIO}SonyPIX.png`],
  ["877", "MNX HD", `${JIO}Movies_Now2_HD.png`],
  ["1115", "Star Movies", `${JIO}Star_Movies.png`],
  ["1401", "Romedy Now", `${JIO}Romedy_Now_HD.png`],
  ["477", "MN+ HD", `${JIO}MNPLUS.png`],
  ["1110", "Star Movies Select HD", `${JIO}Star_Movies_Select_HD.png`],
  ["1322", "And Flix HD", `${JIO}AndFlixHD.png`],
  ["3276", "Star Movies Select", `${JIO}Star_Movies_Select.png`],
  // Cross-listed channels (owner requests) — appended LAST, never sorted
  // in, so the popularity order above stays exactly as curated: Star Gold
  // Thrills (a Hindi Movies channel) + Animax (a Kids channel).
  ["3098", "Star Gold Thrills", `${JIO}Star_Gold_Thrills.png`],
  ["2258", "Animax", `${JIO}Animax.png`],
];

export const LIVE_TV_SNAPSHOT = { sports: SPORTS, moviesHi: MOVIES_HI, moviesEn: MOVIES_EN, serials: SERIALS, kids: KIDS, info: INFO };

// Deliberately cross-listed ids: present in MORE than one snapshot section
// (TV-guide style — the same channel rides two rails). Listed here so the
// snapshot integrity test can tell an intentional cross-listing from a
// copy-paste duplicate. Star Gold Thrills' PRIMARY home stays Hindi Movies.
export const LIVE_TV_CROSS_LISTED = new Set(["3098", "2258"]); // Star Gold Thrills: moviesHi (primary) + moviesEn; Animax: moviesEn (primary — first listing wins) + kids

// id → section, so a live entry that arrives under a sloppy upstream facet
// (Investigation Discovery rides the Entertainment feed) still lands right.
// FIRST listing wins: a cross-listed id keeps its primary section, so the
// upstream facet live-refreshes the right copy (the Movies facet refreshes
// the Hindi Star Gold Thrills; the English rail shows the snapshot copy).
export const LIVE_TV_SECTION_BY_ID = (() => {
  const map = {};
  for (const [section, rows] of Object.entries(LIVE_TV_SNAPSHOT)) {
    for (const [id] of rows) {
      if (map[id] === undefined) map[id] = section;
    }
  }
  return map;
})();

export const snapshotChannelCount = () =>
  Object.values(LIVE_TV_SNAPSHOT).reduce((n, rows) => n + rows.length, 0);

export const snapshotToChannels = () => {
  const out = {};
  for (const [section, rows] of Object.entries(LIVE_TV_SNAPSHOT)) {
    out[section] = rows.map(([id, name, logo]) => ({ id, name, logo, section }));
  }
  return out;
};

// ── Curation ────────────────────────────────────────────────────────────────
// Everything below is deliberately conservative: unknown-but-clean names PASS
// (a future Dangal/Goldmines must appear), only proven junk is dropped.

const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

// TEST feeds, relay placeholders and the like.
const TEST_RE = /\btest\d*\b|^test\d+\s+hd$/i;

// DD relays: keep the 4 national majors, drop every regional relay.
export const DD_KEEP = new Set(["dd national", "dd sports", "dd bharati", "dd kisan"]);

// Proven-junk Entertainment one-offs (placeholder /event feeds, not serials).
const SERIALS_JUNK = new Set([
  "unique tv", "bh ott india fest", "bollywood masala", "gangaur",
  "raj pariwar", "green chillies", "arre hd",
]);

// Hard bans that apply to EVERYTHING (defence in depth — the curated facets
// should never serve these, but the full-list enrichment scans all 1100+).
// NOTE what is deliberately NOT here: "now" (Pickleball Now, Movies Now),
// "bbc" (Sony BBC Earth), "star" — substring bans cause friendly fire.
const BANNED_RE = [
  /\bnews\b/i, /news\s*\d+/i, /\d+\s*news/i, // News, News18, News 24, 24 News…
  /\btak\b/i, /\baaj\b/i, /\babp\b/i, // Aaj Tak, ABP…
  /\bndtv\b/i, /\brepublic\b/i, /\bwion\b/i, /\bcnn\b/i, /\bindia tv\b/i,
  /\bsamachar\b/i, /\bkhabar/i, /\bvaartha/i, /\bvarthe/i,
  /sansad/i, /rajya sabha/i, /lok sabha/i, // parliament feeds read as news
];

export const isBannedLiveName = (name) => {
  const n = norm(name);
  if (!n) return true;
  if (TEST_RE.test(name)) return true;
  if (n.startsWith("dd ") && !DD_KEEP.has(n)) return true;
  if (SERIALS_JUNK.has(n)) return true;
  return BANNED_RE.some((re) => re.test(name));
};

// Serials facet extras: drop junk, keep everything else (incl. newcomers).
export const isCleanSerial = (name) => !isBannedLiveName(name);

// ── Full-list enrichment matchers ───────────────────────────────────────────
// Regional GEC majors, matched EXACTLY (after lowercasing + HD/SD strip) so
// "Sun News"/"Sun Music"/"Maa Movies" can never sneak in via substring.
const stripQuality = (n) => n.replace(/\s+(hd|sd|4k|uhd)$/, "").trim();

const REGIONAL_MAJORS = new Set(
  [
    // Tamil
    "sun tv", "star vijay", "vijay super", "sun life", "zee tamil",
    "colors tamil", "raj tv", "kalaignar tv", "jaya tv", "mega tv",
    // Telugu
    "zee telugu", "star maa", "gemini tv", "etv telugu",
    // Malayalam
    "asianet", "surya tv", "mazhavil manorama", "kairali tv", "amrita tv",
    "flowers tv", "zee keralam",
    // Kannada
    "zee kannada", "colors kannada", "star suvarna", "udaya tv",
    // Marathi
    "star pravah", "zee marathi", "colors marathi", "zee yuva", "sony marathi",
    // Bengali
    "star jalsha", "zee bangla", "colors bangla", "aakash aath",
    // Gujarati / Punjabi / Odia / Bhojpuri
    "colors gujarati", "zee punjabi", "zee sarthak", "tarang", "colors odia",
    "big ganga",
  ].map(norm)
);

export const isRegionalMajor = (name) => {
  const n = stripQuality(norm(name));
  if (!n || isBannedLiveName(name)) return false;
  return REGIONAL_MAJORS.has(n);
};

// English infotainment majors missing from the snapshot (Nat Geo & co. ride
// the anything-goes "English" facet next to news — never list that facet raw).
const INFO_EN_RE = [
  /nat(ional)?\s*geo/i,
  /bbc\s*earth/i,
  /travel\s*xp/i,
  /\bfyi\b.*tv18|tv18.*\bfyi\b/i,
  /food\s*food/i,
  /living\s*foodz/i,
  /fox\s*life/i,
];

export const isInfoEnglishMajor = (name) => {
  if (!name || isBannedLiveName(name)) return false;
  return INFO_EN_RE.some((re) => re.test(name));
};

// Hindi movie brands riding OTHER facets (UTV Movies, Star Utsav Movies… on
// Entertainment) — matched for enrichment AND to keep them out of Serials.
const MOVIE_HI_RE = [
  /star gold/i, /zee cinema/i, /zee anmol cinema/i, /sony max/i,
  /colors cineplex/i, /and pictures/i, /and xplo?r/i, /zee bollywood/i,
  /zee classic/i, /zee action/i, /b4u movies/i, /b4u kadak/i,
  /maha movies/i, /utv movies/i, /star utsav movies/i, /box cinema/i,
  /manoranjan/i, /filamchi/i, /hiff movies/i,
];

export const isMovieHindiMajor = (name) => {
  if (!name || isBannedLiveName(name)) return false;
  return MOVIE_HI_RE.some((re) => re.test(name));
};

// English movie brands for full-list enrichment (incl. not-yet-indexed HBO /
// Zee Studio). The "English" facet itself is never listed raw — 200+ news,
// edu and devotional channels ride it.
const MOVIE_EN_RE = [
  /star movies/i, /movies now/i, /\bmnx\b/i, /mn\+/i, /sony pix/i,
  /zee studio/i, /and flix/i, /&flix/i, /romedy now/i, /\bhbo\b/i,
];

export const isMovieEnglishMajor = (name) => {
  if (!name || isBannedLiveName(name)) return false;
  return MOVIE_EN_RE.some((re) => re.test(name));
};

// Merge one live facet over its snapshot: snapshot order wins, live refreshes
// names/logos, unknown-but-clean newcomers append alphabetically.
export const mergeSection = (section, liveItems) => {
  const snapRows = LIVE_TV_SNAPSHOT[section] || [];
  const liveById = new Map();
  for (const item of liveItems || []) {
    const id = String(item?.id || "");
    if (!id || !item?.name || isBannedLiveName(item.name)) continue;
    // Serials ≠ movies: movie brands riding the Entertainment facet belong
    // to Hindi Movies (via full-list enrichment), never to the Serials rail.
    if (section === "serials" && isMovieHindiMajor(item.name)) continue;
    // A snapshot entry keeps its curated section even when the upstream
    // facet disagrees (Investigation Discovery arrives via Entertainment).
    if (LIVE_TV_SECTION_BY_ID[id] && LIVE_TV_SECTION_BY_ID[id] !== section) continue;
    if (!liveById.has(id)) {
      liveById.set(id, {
        id,
        name: String(item.name),
        logo: String(item.logo || ""),
        section,
      });
    }
  }
  const merged = snapRows.map(([id, name, logo]) => {
    const live = liveById.get(id);
    liveById.delete(id);
    return live && live.logo ? live : { id, name, logo, section };
  });
  const newcomers = [...liveById.values()].sort((a, b) => a.name.localeCompare(b.name));
  return [...merged, ...newcomers];
};
