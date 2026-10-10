// ─── profileLook.js — the member's own look ──────────────────────────────────
//
// Bio, accent colour, a profile PICTURE from the catalog, and a gradient COVER.
// (Until 2026-09-27 the picture and the banner were uploads to an image host;
// owner: "trash this custom photo Idea … no more problems just pick the peakest
// of the peak photo". A picture is now a catalog entry — a short URL the server
// already allows — and a cover is one of the catalog's gradient ids.)
//
// Stored the same way My List already is:
// in this browser's localStorage, and PUBLISHED with the profile when the page
// is public. That choice is deliberate:
//
//   • A private profile has no document anywhere, so its look cannot live in one
//     either — otherwise "private" would start meaning "half a row on the server".
//     The member can still set everything up and see the preview before choosing.
//   • Publishing already copies the list and the last-watched title up; the look
//     rides along in the same write, so a customisation costs no extra request,
//     no extra table and no extra byte of image data on the site's own server.
//
// The caps here mirror the SERVER's (server/store.js BIO_MAX / ACCENT_PATTERN /
// the cover ids) because both sides must agree: the browser trims to keep the UI
// honest, and the server re-checks because it is the only thing standing between
// a crafted request and the published page. tests/profile-catalog.test.mjs pins
// the pair.

export const LOOK_KEY = "iris-profile-look";
/** Announce a change so a published page republishes itself (profiles.js). */
export const LOOK_EVENT = "profile-look-updated";
/** Fired when the look came from the account's cloud copy (another device). */
export const LOOK_SYNCED_EVENT = "profile-look-synced";
/** When the look was last edited (ms), for newest-wins sync. */
export const LOOK_AT_KEY = "iris-profile-look-at";
export const readLookStamp = () => {
  try {
    const n = Number(localStorage.getItem(LOOK_AT_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
};

export const BIO_MAX = 160;
export const ACCENT_PATTERN = /^#[0-9a-f]{6}$/;
/** A cover id: lower-case words and dashes, matching the catalog's own ids. */
export const COVER_ID_PATTERN = /^[a-z0-9-]{2,24}$/;

/** The swatches on offer. Plain hex so the value is safe in inline styles. */
export const ACCENTS = [
  { value: "#f59e0b", name: "Amber" },
  { value: "#ef4444", name: "Red" },
  { value: "#22c55e", name: "Green" },
  { value: "#3b82f6", name: "Blue" },
  { value: "#a855f7", name: "Purple" },
  { value: "#ec4899", name: "Pink" },
];

export const emptyLook = () => ({ bio: "", accent: "", avatar: "", cover: "" });

/** Fold any draft into what may be stored: one line, capped, valid or dropped. */
export const normalizeLook = (raw) => {
  const bio = String(raw?.bio ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BIO_MAX);
  const accent = String(raw?.accent ?? "").trim().toLowerCase();
  // A picture is an https URL on a host the catalog uses. The exact host list is
  // the server's to enforce (it can see data/avatars.json); here the shape is
  // checked so a hand-edited localStorage value cannot inject anything else.
  const url = (value) => {
    const text = String(value ?? "").trim();
    if (text.length > 300 || !/^https:\/\/[^\s"']+$/.test(text)) return "";
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "https:") return "";
    } catch {
      return "";
    }
    return text;
  };
  const cover = String(raw?.cover ?? "").trim().toLowerCase();
  return {
    bio,
    accent: ACCENT_PATTERN.test(accent) ? accent : "",
    avatar: url(raw?.avatar),
    cover: COVER_ID_PATTERN.test(cover) ? cover : "",
  };
};

/** True when the member has customised anything at all. */
export const hasLook = (look) =>
  Boolean(look && (look.bio || look.accent || look.avatar || look.cover));

export const readLook = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) || "null");
    return raw ? normalizeLook(raw) : emptyLook();
  } catch {
    return emptyLook();
  }
};

/**
 * Write the look, then tell the page. Returns what was actually stored, so a
 * caller renders the trimmed truth rather than the draft it typed.
 */
export const writeLook = (look, { stamp = Date.now(), synced = false } = {}) => {
  const clean = normalizeLook(look);
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(clean));
    // When it was last changed — the cloud copy and this one are compared by it
    // (utils/accountSync.js), so the newest edit wins on every device.
    localStorage.setItem(LOOK_AT_KEY, String(stamp));
  } catch {
    /* private browsing with storage disabled — the page still renders */
  }
  try {
    window.dispatchEvent(new CustomEvent(LOOK_EVENT, { detail: clean }));
    // A look that arrived from another device: open editors re-read it.
    if (synced) window.dispatchEvent(new CustomEvent(LOOK_SYNCED_EVENT, { detail: clean }));
  } catch {
    /* no window (tests) — the caller already has the value it needs */
  }
  return clean;
};

/** One line for the account page, e.g. "picture, cover, bio". */
export const lookSummary = (look) => {
  const parts = [];
  if (look?.avatar) parts.push("picture");
  if (look?.cover) parts.push("cover");
  if (look?.bio) parts.push("bio");
  if (look?.accent) parts.push("colour");
  return parts.length ? parts.join(", ") : "nothing yet";
};
