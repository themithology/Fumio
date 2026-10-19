import { ANIME_CHARACTERS } from "./animeCharacters.js";

// ─── avatarCatalog.js — the profile pictures a member picks from ────────────
//
// Owner, 2026-09-27, twice: first "catalog of pfp like Netflix and hotstar … pick
// the peakest of the peak", then, when the drawn portraits arrived, "these are
// pure AI slop images add anime character series character manga character like
// Lloyd frontera and all that famous anime like natsuki subaru while keeping some
// genric ones".
//
// So there are two halves, and the picker shows both:
//
//   • ANIME CHARACTERS (the front of the grid) — real characters, resolved from
//     AniList by .github/fetch-characters.mjs and listed in animeCharacters.js.
//     The portraits are hotlinked from AniList's public image CDN, the same
//     source the site already uses for anime art; only the URL is stored, so a
//     profile keeps ~60 bytes and no image file is ever bundled here or in the
//     deployment zip.
//   • GENERIC (kept, as he asked) — drawn portraits and robots from DiceBear's
//     free generator (api.dicebear.com), which needs no account and no key, plus
//     the "Aa" initial tile.
//
// No uploads, no Cloudinary, no API key, no secret, no panel homework — and no
// byte of image data on his server, which was the rule from 2026-09-26.
//
// LICENCES, because this is somebody's artwork: the character portraits belong to
// their studios and are served by AniList's CDN (this site already shows anime
// art from AniList); DiceBear's styles are CC-BY 4.0 / CC0 and their credit line
// ships with the catalog and renders under the picker. Check a licence before
// swapping a source in.
//
// THE OWNER'S OWN ENTRIES come from `data/avatars.json` on the server (seeded
// automatically, editable in the panel's file manager from a phone, and able to
// name a character to look up as well as take a URL) and are merged in front of
// this list by GET /api/config — see server/avatarCatalog.js.

export const AVATAR_CATALOG_CREDIT =
  "Characters via AniList · drawn portraits by DiceBear (CC-BY 4.0)";

/** The host the drawn portraits come from (mirrored by the server). */
export const CATALOG_HOST = "api.dicebear.com";
/** The host the character portraits come from (mirrored by the server). */
export const CHARACTER_HOST = "s4.anilist.co";
/** Every host a shipped picture may come from. The server allows exactly these. */
export const CATALOG_HOSTS = [CHARACTER_HOST, CATALOG_HOST];

const dicebear = (style, seed, extra = "") =>
  `https://${CATALOG_HOST}/9.x/${style}/svg?seed=${encodeURIComponent(seed)}${extra}`;

/**
 * The characters, in the owner's order — the front of the grid. Generated from
 * .github/character-picks.json by the fetch-characters workflow, which resolves
 * each name on AniList and verifies the portrait loads before writing the file.
 * (`kind` is the filter chip the picker shows.)
 */
export const ANIME_AVATARS = ANIME_CHARACTERS.map((entry) => ({ ...entry, kind: "anime" }));

/**
 * The generic half, kept because he asked ("while keeping some genric ones"):
 * drawn portraits and robots, four seeds each, all checked to look good at 88 px.
 *
 *   adventurer      painted fantasy portraits — the closest thing here to an
 *                   anime lead, which is why it is first
 *   lorelei         soft, professional illustrations
 *   micah           flat, modern, graphic
 *   notionists      the tidy line-art faces everyone recognises
 *   bottts          robots, for people who would rather not be a person
 *   pixel-art       retro game sprite, 8-bit
 *   fun-emoji       loud and funny
 *   thumbs          a single hand-drawn thumb with an opinion
 */
export const GENERIC_AVATARS = [
  // adventurer — the front row, because this is an anime site
  { id: "adv-1", name: "Adventurer", url: dicebear("adventurer", "Iris") },
  { id: "adv-2", name: "Adventurer", url: dicebear("adventurer", "Pirate") },
  { id: "adv-3", name: "Adventurer", url: dicebear("adventurer", "Kaito") },
  { id: "adv-4", name: "Adventurer", url: dicebear("adventurer", "Mira") },
  // lorelei — soft portraits
  { id: "lor-1", name: "Lorelei", url: dicebear("lorelei", "Iris") },
  { id: "lor-2", name: "Lorelei", url: dicebear("lorelei", "Yuki") },
  { id: "lor-3", name: "Lorelei", url: dicebear("lorelei", "Nova") },
  { id: "lor-4", name: "Lorelei", url: dicebear("lorelei", "Ren") },
  // micah — flat and modern
  { id: "mic-1", name: "Micah", url: dicebear("micah", "Iris") },
  { id: "mic-2", name: "Micah", url: dicebear("micah", "Zoro") },
  { id: "mic-3", name: "Micah", url: dicebear("micah", "Aiko") },
  { id: "mic-4", name: "Micah", url: dicebear("micah", "Ghost") },
  // notionists — tidy line art
  { id: "not-1", name: "Notionists", url: dicebear("notionists", "Iris") },
  { id: "not-2", name: "Notionists", url: dicebear("notionists", "Sage") },
  { id: "not-3", name: "Notionists", url: dicebear("notionists", "Kira") },
  { id: "not-4", name: "Notionists", url: dicebear("notionists", "Bolt") },
  // bottts — robots
  { id: "bot-1", name: "Robot", url: dicebear("bottts", "Iris") },
  { id: "bot-2", name: "Robot", url: dicebear("bottts", "Unit-7") },
  { id: "bot-3", name: "Robot", url: dicebear("bottts", "Hazard") },
  { id: "bot-4", name: "Robot", url: dicebear("bottts", "Tin") },
  // pixel-art — 8-bit
  { id: "pix-1", name: "Pixel art", url: dicebear("pixel-art", "Iris") },
  { id: "pix-2", name: "Pixel art", url: dicebear("pixel-art", "Blade") },
  { id: "pix-3", name: "Pixel art", url: dicebear("pixel-art", "Mage") },
  { id: "pix-4", name: "Pixel art", url: dicebear("pixel-art", "Rogue") },
  // fun-emoji — loud
  { id: "emo-1", name: "Emoji", url: dicebear("fun-emoji", "Iris") },
  { id: "emo-2", name: "Emoji", url: dicebear("fun-emoji", "LOL") },
  { id: "emo-3", name: "Emoji", url: dicebear("fun-emoji", "Cool") },
  { id: "emo-4", name: "Emoji", url: dicebear("fun-emoji", "Shock") },
  // thumbs — an opinion, hand-drawn
  { id: "thu-1", name: "Thumbs", url: dicebear("thumbs", "Iris") },
  { id: "thu-2", name: "Thumbs", url: dicebear("thumbs", "Yeah") },
  { id: "thu-3", name: "Thumbs", url: dicebear("thumbs", "Nope") },
  { id: "thu-4", name: "Thumbs", url: dicebear("thumbs", "Maybe") },
];

/**
 * Everything a member can pick, in the order the picker shows it: the characters
 * first (the point of the catalog), then the generic tiles.
 */
export const AVATAR_CATALOG = [...ANIME_AVATARS, ...GENERIC_AVATARS];

/**
 * Covers for the top of a page. A cover is a CSS gradient rather than a
 * photograph, and that is deliberate: it costs zero requests, zero bytes on any
 * server, cannot 404, and cannot be somebody's stolen artwork. `css` is used
 * as a background-image value verbatim, so it must stay a plain gradient.
 */
export const COVER_CATALOG = [
  { id: "crimson", name: "Crimson", css: "linear-gradient(135deg,#7f1d1d,#ef4444 55%,#f59e0b)" },
  { id: "ocean", name: "Ocean", css: "linear-gradient(135deg,#082f49,#0369a1 55%,#22d3ee)" },
  { id: "forest", name: "Forest", css: "linear-gradient(135deg,#052e16,#15803d 55%,#a3e635)" },
  { id: "violet", name: "Violet", css: "linear-gradient(135deg,#2e1065,#7c3aed 55%,#f472b6)" },
  { id: "sunset", name: "Sunset", css: "linear-gradient(135deg,#7c2d12,#f97316 50%,#fde047)" },
  { id: "midnight", name: "Midnight", css: "linear-gradient(135deg,#020617,#1e293b 55%,#64748b)" },
  { id: "sakura", name: "Sakura", css: "linear-gradient(135deg,#831843,#f472b6 55%,#fbcfe8)" },
  { id: "neon", name: "Neon", css: "linear-gradient(135deg,#0f172a,#06b6d4 45%,#a3e635)" },
  { id: "ember", name: "Ember", css: "linear-gradient(135deg,#1c1917,#b45309 50%,#fca5a5)" },
  { id: "deep-sea", name: "Deep sea", css: "linear-gradient(135deg,#020617,#0f766e 55%,#67e8f9)" },
  { id: "grape", name: "Grape", css: "linear-gradient(135deg,#1e1b4b,#4f46e5 50%,#c084fc)" },
  { id: "steel", name: "Steel", css: "linear-gradient(135deg,#0b1120,#334155 50%,#94a3b8)" },
];

/** The ids the server accepts for a cover (kept in step by a test). */
export const COVER_IDS = COVER_CATALOG.map((cover) => cover.id);
