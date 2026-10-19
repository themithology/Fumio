// ─── profiles.js — OPTIONAL public profile pages (/u/handle) ────────────────
// A member can publish a public page at /u/their-handle showing what they are
// watching. It is the one feature on this site that publishes personal data, so
// it is built around three rules:
//
//   • OPT-IN, OFF BY DEFAULT. Nothing is written until a member claims a handle
//     and switches the profile on. My List stays private until they say so.
//
//   • A USERNAME IS NOT A PUBLICATION. Owner, 2026-09-25: members should be
//     asked to choose their username after signing up, with public/private as a
//     real choice — not the old "claim it and you are live". So the two are
//     separate writes against two tables on the site's own server:
//
//       reserveUsername()   → handle_owners   PRIVATE, owner-only. This is the
//                             username: it is yours, nobody can read it, and no
//                             page exists yet.
//       publishProfile()    → profiles        PUBLIC. This is the page.
//
//     Uniqueness is enforced server-side in one place (server/store.js): a
//     handle may only point at one account, and the FIRST member to take a name
//     keeps it. reserveUsername() refuses a name that already has a page, so the
//     disappointment is rare — but no promise of exclusivity is made for a name
//     nobody has published.
//
//   • PUBLISH THE MINIMUM. The stored page carries a display name, the titles on
//     their list, and the last thing they watched. Never the email, never
//     Continue Watching history beyond that one title, never the device — and
//     never the uid, which the server keeps in its own column and never puts
//     into a public answer.
//   • NEVER THROW AT THE USER. Server down, offline, or a rejected token all
//     degrade to "not published"; the rest of the site does not notice.
//
// ─── 2026-09-25: this used to be Firestore ──────────────────────────────────
// The whole data layer moved onto the owner's own server (docs/DATA-LAYER-PLAN.md):
// two SQLite tables behind /api/db/*, no quota, nothing to install, and the
// ownership rules that lived in firestore.rules are enforced in
// server/dataApi.js. What did NOT move is sign-in: members still authenticate
// with Firebase Auth (5,000 of them already have their passwords there), and the
// server verifies their ID token itself. Every authorized request in this file
// therefore carries a token, and the uid the server acts on always comes from
// that token — never from the body, never from the URL.
//
// A note on the old file's vocabulary: "permission-denied", "quota" and the
// Check button's Firestore probes are gone with Firestore. The codes this module
// speaks now come from src/utils/dbApi.js and are about OUR server.

// These two imports carry an explicit .js: profiles.js is imported directly
// by tests/profiles.test.mjs, and Node's ESM resolver (unlike Vite's) does not
// guess extensions. Same reason src/components/party/PartyLobby.jsx does it.
import { readMyList } from "./myList.js";
import { readLook, normalizeLook, LOOK_EVENT, readLookStamp, hasLook, writeLook } from "./profileLook.js";
import { BUILD_ID } from "./buildInfo.js";
import {
  withTimeout,
  dbHostReachable,
  DB_TIMEOUT_MS,
  DB_READ_TIMEOUT_MS,
  markQuotaExhausted,
  quotaMessage,
  explainDbSilence,
} from "./dbTimeout.js";
import { recordDbCall, usageSummary } from "./dbUsage.js";
// The ONE definition of "the server could not check your sign-in" — imported
// rather than spelled again here, so the two can never disagree.
import { AUTH_UNAVAILABLE_CODE as AUTH_UNAVAILABLE } from "./dbApi.js";

// Re-exported so the profile tests (and anything else wiring a database call)
// can reach the guard from the module that depends on it. (withTimeout is no
// longer used INSIDE this module — the API client owns its own abort timers —
// but it is still the guard the tests reach for, and it stays exported.)
export { withTimeout, DB_TIMEOUT_MS, DB_READ_TIMEOUT_MS, dbHostReachable };

export const PROFILE_COLLECTION = "profiles";
export const OWNER_POINTER_COLLECTION = "handle_owners";

/** My List caps at 100 locally (utils/myList.js); the public copy matches. */
export const PROFILE_LIST_CAP = 100;
/** A display name is a label, not a biography. */
export const DISPLAY_NAME_MAX = 40;

/** 3–20 characters, lowercase letters/digits with - or _ inside. The rules
 * enforce the same shape server-side (`handle.matches(...)` in
 * firestore.rules) — this copy exists to give a human a readable reason. */
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;

/** Names we never hand out: every real route, the honeypot/admin paths, and the
 * words that would let a handle impersonate the site or its staff. */
export const RESERVED_HANDLES = new Set([
  // routes + site chrome
  "u", "account", "admin", "roxy", "wp-admin", "administration", "support",
  "about", "faq", "dmca", "disclaimer", "contact", "privacy", "terms",
  "my-list", "watch-party", "party", "live-tv", "schedule", "explore",
  "search", "trending", "popular", "anime", "movie", "movies", "tv", "tvshows",
  "download", "player", "home", "index", "login", "signin", "signup", "logout",
  // identity words (impersonation + confusion)
  "iris", "theogpiratebot", "official", "staff", "moderator", "mod", "owner",
  // The document the "Check" diagnostic reads (utils/profiles.js CHECK_HANDLE) —
  // reserved so no member can ever take it and confuse the probe.
  "iris-check",
  "system", "api", "static", "assets", "public", "well-known", "null",
  "undefined", "anonymous", "guest", "me", "you", "everyone",
]);

/** Lowercase and trim; spaces become dashes so "Cool Name" is easy to type. */
export const normalizeHandle = (raw) =>
  String(raw || "").trim().toLowerCase().replace(/\s+/g, "-");

/** Human-readable validation. Returns { ok, reason, handle }. */
export const validateHandle = (raw) => {
  const handle = normalizeHandle(raw);
  if (!handle) return { ok: false, reason: "Pick a handle first.", handle };
  if (handle.length < HANDLE_MIN) {
    return { ok: false, reason: `At least ${HANDLE_MIN} characters.`, handle };
  }
  if (handle.length > HANDLE_MAX) {
    return { ok: false, reason: `At most ${HANDLE_MAX} characters.`, handle };
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return { ok: false, reason: "Letters, numbers, dashes and underscores only.", handle };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: `"${handle}" is reserved. Try another.`, handle };
  }
  return { ok: true, reason: "", handle };
};

/** Where the member's own handle is remembered on this device, for instant UI
 * before the pointer document comes back. The document is the source of truth. */
export const LOCAL_HANDLE_KEY = "iris-profile-handle";

const safeGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const readLocalHandle = () => normalizeHandle(safeGet(LOCAL_HANDLE_KEY));
// Which account the remembered username belongs to — a shared browser must
// never let account B re-claim account A's name (see restoreLostProfile).
const LOCAL_HANDLE_OWNER_KEY = "iris-profile-handle-owner";
export const rememberLocalHandle = (handle, uid = "") => {
  safeSet(LOCAL_HANDLE_KEY, normalizeHandle(handle));
  if (uid) safeSet(LOCAL_HANDLE_OWNER_KEY, uid);
};
const readLocalHandleOwner = () => safeGet(LOCAL_HANDLE_OWNER_KEY) || "";
// "This member's page is public" — remembered in the browser, per account, so a
// server that lost its database (a reinstall that dropped data/, owner
// 2026-09-27) gets the page back the next time the member signs in, instead of
// every member silently vanishing from search.
const LOCAL_PUBLIC_KEY = "iris-profile-public";
const rememberPublic = (uid, handle) => safeSet(LOCAL_PUBLIC_KEY, JSON.stringify({ uid, handle: normalizeHandle(handle) }));
const forgetPublic = () => {
  try {
    localStorage.removeItem(LOCAL_PUBLIC_KEY);
  } catch {
    /* storage blocked */
  }
};
export const readLocalPublic = () => {
  try {
    const raw = JSON.parse(safeGet(LOCAL_PUBLIC_KEY) || "null");
    return raw && typeof raw.uid === "string" && typeof raw.handle === "string" ? raw : null;
  } catch {
    return null;
  }
};

export const forgetLocalHandle = () => {
  try {
    localStorage.removeItem(LOCAL_HANDLE_OWNER_KEY);
    localStorage.removeItem(LOCAL_HANDLE_KEY);
  } catch {
    /* storage blocked — nothing to forget */
  }
};

// ── the API client (lazy: only fetched once a member actually opens the feature) ──
// One place knows the URLs (src/utils/dbApi.js). It is imported dynamically for
// the same reason the SDK was: the pure half of this module — handle validation,
// the payload builder — has to stay loadable outside a bundler, because that is
// what tests/profiles.test.mjs exercises.
const api = () => import("./dbApi.js");

/**
 * Count a database call so /account can show what this device is doing.
 *
 * Counted, NEVER rationed: the budget in utils/dbUsage.js exists for analytics
 * events only. Member data (a username, a published list) is the reason the
 * database is here — refusing it to stay under a number would be the bug, not
 * the fix.
 */
const counted = async (kind, work) => {
  try {
    const value = await work();
    recordDbCall(kind);
    return value;
  } catch (err) {
    recordDbCall(err?.code === "timeout" ? "refusal" : kind === "write" ? "write" : "refusal");
    throw err;
  }
};

/** The title fields a public page is allowed to carry. Anything else on a
 * My List entry (addedAt bookkeeping, extra TMDB fields, anything a future
 * writer adds) is dropped here rather than published by accident. */
const publicItem = (item) => {
  if (!item || !item.id) return null;
  const year = String(item.release_date || item.first_air_date || "").slice(0, 4);
  return {
    id: item.id,
    type: item.type || item.media_type || "movie",
    title: String(item.title || item.name || "Untitled").slice(0, 200),
    poster_path: item.poster_path || null,
    vote_average: typeof item.vote_average === "number" ? item.vote_average : null,
    year: /^\d{4}$/.test(year) ? Number(year) : null,
  };
};

/** The watched-title line, from the newest Continue Watching entry only. */
const publicWatching = (history) => {
  const first = Array.isArray(history) ? history.find((i) => i && i.id) : null;
  if (!first) return null;
  return {
    id: first.id,
    type: first.type || first.media_type || "movie",
    title: String(first.title || first.name || "Untitled").slice(0, 200),
    season: Number.isFinite(first.season) ? first.season : null,
    episode: Number.isFinite(first.episode) ? first.episode : null,
  };
};

/**
 * Build the exact document that gets published. Pure and exported so the tests
 * can prove what does and does not leave the browser — `uid` is added by the
 * writers (it is the ownership proof the rules check), never by this builder.
 */
export const buildPublicPayload = ({ handle, displayName, list, history, look }) => {
  // The look (bio, accent, picture, cover) is read from the same browser store
  // My List already comes from — see utils/profileLook.js for why it is not kept
  // on the server while a page is private. Passed explicitly by callers that
  // already have it; read here otherwise so no call site can forget it and
  // silently publish a page without the member's photo.
  const stored = look ? normalizeLook(look) : readLook();
  return {
    handle: normalizeHandle(handle),
    displayName: String(displayName || "").trim().slice(0, DISPLAY_NAME_MAX) || normalizeHandle(handle),
    // Only send what the member actually set: the server's allowlist keeps the
    // shape, but an empty string is more honest than a field full of nulls.
    ...(stored.bio ? { bio: stored.bio } : {}),
    ...(stored.accent ? { accent: stored.accent } : {}),
    ...(stored.avatar ? { avatar: stored.avatar } : {}),
    ...(stored.cover ? { cover: stored.cover } : {}),
    public: true,
    list: (Array.isArray(list) ? list : []).map(publicItem).filter(Boolean).slice(0, PROFILE_LIST_CAP),
    watching: publicWatching(history),
    // 3 = pictures come from the catalog, not from an upload (2026-09-27).
    schema: 3,
  };
};

/**
 * Turn a write failure into the actual reason.
 *
 * "permission-denied" has two completely different causes and a single vague
 * message used to cover both ("That handle is taken, or publishing isn't
 * enabled yet"), which told the owner nothing. The client can tell them apart:
 * READ the handle that was refused. A read that succeeds proves the rules ARE
 * published — so the refusal was about the write itself (someone else owns the
 * handle). A read that ALSO fails means nothing can be read or written, i.e.
 * the rules in firestore.rules were never published for this project.
 *
 * (async — it costs one extra read only on the failure path)
 */
/**
 * The sentence for "it never answered" — delegated to dbTimeout.js so this
 * module and accountSync.js can never drift into two different stories about
 * the same failure (they had drifted: one of them still blamed the rules after
 * the project's own probe had proven the rules were fine).
 */
const explainTimeout = () => explainDbSilence();

/**
 * The sentence for a failed write, built from the SERVER's own words.
 *
 * The codes are the ones src/utils/dbApi.js raises, not Firestore's: the server
 * names its own refusals ("@foo is taken", "3-20 characters…") and those words
 * are quoted back rather than reinterpreted here. Call sites pass the handle as
 * a second argument; it is not needed to write the sentence.
 */
const explainWriteFailure = async (err) => {
  const code = err?.code || "";
  // The server names its own refusals ("@foo is taken", "3-20 characters…"), so
  // those words are quoted rather than guessed at.
  if (code === "already-exists" || code === "invalid-argument") {
    return `${err.message || "That username is not available."} Try another username.`;
  }
  if (code === "permission-denied") {
    const said = err.message || "not yours";
    // The server has two very different refusals here, and quoting it is the
    // only way to stay accurate: "your handle is @x" means the page must live at
    // the member's own username, while "that handle belongs to someone else"
    // means the name is gone.
    if (/your handle is/i.test(said)) {
      return `${said[0].toUpperCase()}${said.slice(1)} — a page can only live at your own username. Change the username first if you want a different one.`;
    }
    if (/claim a username/i.test(said)) {
      return "Choose a username first — a page needs a name to live at.";
    }
    return `The server refused that change (${said}). That username belongs to another account — pick a different one.`;
  }
  if (code === "unauthenticated") {
    return "That session expired. Sign in again, then retry.";
  }
  if (code === AUTH_UNAVAILABLE) {
    return "The server could not check your sign-in just now — it briefly could not reach Google's sign-in keys. Nothing is lost: try again in a moment.";
  }
  if (code === "timeout") return explainTimeout();
  if (code === "unavailable") {
    return "Couldn't reach the site's own server — check your connection and try again.";
  }
  if (code === "resource-exhausted") {
    markQuotaExhausted();
    return quotaMessage();
  }
  return `Something went wrong (${code || "no error code"}). Try again.`;
};

/**
 * The handle the diagnostic asks about. Kept as a constant (and in
 * RESERVED_HANDLES) so a real member can never publish there and be told their
 * own page is the probe.
 */
export const CHECK_HANDLE = "iris-check";

/**
 * The probe behind the "Check" button on /account.
 *
 * It used to interrogate Firestore: a REST read, an SDK read, an SDK write and a
 * REST write, and a page of verdicts about rules, quotas and transports. There is
 * no Firestore any more, so it now asks the only thing that can still be wrong —
 * the site's OWN server (docs/DATA-LAYER-PLAN.md) — and it asks in the same
 * three steps the app itself takes, in the same order:
 *
 *   1. a PUBLIC read   (GET /api/db/health)   — is the API up, is its database open?
 *   2. an OWNER read   (GET /api/db/handle/:uid, with the ID token)
 *                                             — does the server accept this session?
 *   3. a REAL write    (POST /api/events)     — can this session actually store
 *                                               something? (One page-view-shaped
 *                                               event: the shape the app writes
 *                                               all day, so a success is proof.)
 *
 * Every step is a plain fetch with its own abort timer, so the check can never
 * hang the way the old SDK did. The message always names WHICH step failed and
 * the build the server is running, because "it says something went wrong" is what
 * cost the owner an hour on 2026-09-25.
 */
export const checkPublishing = async () => {
  const { getHealth, getVersion, getMe, currentIdToken, postEvent } = await api();

  // ── 1. public read ────────────────────────────────────────────────────────
  let health;
  try {
    health = await counted("read", () => getHealth());
  } catch (err) {
    const code = err?.code || "";
    if (code === "timeout") {
      return {
        ok: false,
        kind: "timeout",
        message: `The site's own server did not answer within ${Math.round(DB_READ_TIMEOUT_MS / 1000)} seconds — it is either restarting or overloaded. Nothing about your account or your list is wrong. Try again in a moment.`,
      };
    }
    if (code === "unavailable") {
      return {
        ok: false,
        kind: "blocked",
        message:
          "This browser could not reach the site's own API at all — the request never left. That is a content blocker, a DNS filter, or the network you are on.",
      };
    }
    return {
      ok: false,
      kind: "api-error",
      message: `The database API answered with an error (${err.message || code || "no status"}). Press Check again in a moment; if it persists, the server log will say why.`,
    };
  }
  if (health && health.ok === false) {
    return {
      ok: false,
      kind: "store-down",
      message:
        "The server is running, but its database is not attached — the site still works, member features are off. The server log names the reason (usually an old Node: SQLite needs Node 22.5 or newer).",
    };
  }

  // ── the builds, so a stale deploy is visible here too ────────────────────
  // Two stamps, because there are two halves: this browser bundle (BUILD_ID)
  // and the server zip (BUILD.json, reported by /api/version). A verdict that
  // disagrees with either is how a half-deployed update is recognised.
  let build = ` Browser build ${BUILD_ID}.`;
  try {
    const version = await getVersion();
    if (version?.commit) build += ` Server build ${String(version.commit).slice(0, 12)}.`;
  } catch {
    /* the version line is a nicety; never let it fail the check */
  }

  // ── 2. does the server accept this session? ───────────────────────────────
  // /api/db/me answers from the TOKEN, so this proves the whole chain (the
  // member's session -> the header -> the server's verification) without the
  // browser having to know or remember its own uid.
  // No session at all is a legitimate state, not a fault: say what was proved
  // and stop, rather than probing with a token that was never there.
  if (!(await currentIdToken())) {
    return {
      ok: true,
      kind: "ok-no-session",
      message: `The database answered and it is ready (${health?.store?.members ?? 0} members, ${health?.store?.profiles ?? 0} public pages).${build} Nobody is signed in and nothing needs to be — sign in when you want your own lists and page to follow you.`,
    };
  }
  let me;
  try {
    me = await counted("read", () => getMe());
  } catch (err) {
    const code = err?.code || "";
    if (code === "unauthenticated") {
      // A token WAS sent and the server refused it — that is a real problem with
      // this session, and the member is told to sign in again. (A server that
      // could not CHECK the token answers 503 instead, and says so.)
      return {
        ok: false,
        kind: "session",
        message: `The server refused this session's token (sign in again, then press Check).${build}`,
      };
    }
    if (code === AUTH_UNAVAILABLE) {
      return {
        ok: false,
        kind: "auth-unavailable",
        message: `The server answered, but it could not check your sign-in just now: it cannot reach Google's certificate service to verify tokens. That is a network problem between your server and Google, not your account.${build}`,
      };
    }
    return {
      ok: false,
      kind: "owner-read",
      message: `The server could not confirm this session (${err.message || code || "no status"}).${
        code === "timeout" ? " The request was never answered within the deadline." : ""
      }${build}`,
    };
  }
  if (me?.anonymous) {
    return {
      ok: true,
      kind: "ok-guest",
      message: `The server accepts this session, but it is a GUEST session (anonymous), which cannot hold a cloud list or a page.${build} Sign in with Google or email to keep your lists across devices.`,
    };
  }

  // ── 3. a real write, the way the app makes one ────────────────────────────
  try {
    await counted("write", () =>
      postEvent({
        kind: "page_view",
        page_location: "/account",
        at: Date.now(),
      }),
    );
  } catch (err) {
    const code = err?.code || "";
    return {
      ok: false,
      kind: "write-blocked",
      message: `Reads answered, but storing an event failed (${err.message || code || "no status"}).${
        code === "timeout"
          ? " That is this network dropping POST requests, not your account or your list."
          : " Press Check again; the server log will name the reason."
      }${build}`,
    };
  }

  const store = health?.store || {};
  return {
    ok: true,
    kind: "ok",
    message: `Everything is wired: the server answered, it accepted your sign-in, and it stored a test event.${build} Store now holds ${store.members ?? 0} member(s) and ${store.profiles ?? 0} public page(s). ${usageSummary()}`,
  };
};

// ── reads ───────────────────────────────────────────────────────────────────

/**
 * The public page, WITH the reason when there is nothing to show.
 *
 * fetchProfile() collapses "no such profile" and "the database refused to
 * answer" into the same null, and the page then blamed the link — telling a
 * visitor a member's profile does not exist when in fact nothing could be read
 * (owner, 2026-09-25: "public profile [doesn't] work"). The two are very
 * different: one is a dead link, the other is a broken deployment.
 */
export const loadProfile = async (handle) => {
  const clean = normalizeHandle(handle);
  if (!HANDLE_PATTERN.test(clean)) return { state: "invalid", profile: null };
  const { getProfile } = await api();
  try {
    const data = await counted("read", () => getProfile(clean));
    if (!data?.profile) return { state: "missing", profile: null };
    // The handle is echoed back rather than trusted from the stored JSON, so a
    // page and its URL can never disagree.
    return { state: "ready", profile: { ...data.profile, handle: clean } };
  } catch (err) {
    const code = err?.code || "";
    console.warn("Profile: read failed", code || err?.message);
    if (code === "not-found") return { state: "missing", profile: null };
    if (code === "timeout") return { state: "timeout", profile: null };
    if (code === "permission-denied") return { state: "blocked", profile: null };
    if (code === "unavailable") return { state: "offline", profile: null };
    if (code === "invalid-argument") return { state: "invalid", profile: null };
    return { state: "error", profile: null };
  }
};

/** The public page. Returns the payload, or null when nothing is published. */
export const fetchProfile = async (handle) => {
  const { profile } = await loadProfile(handle);
  return profile;
};

/**
 * The users directory — the search page's "Users" category.
 *
 * Public by construction: a page is in this list only because its member
 * switched it on, and unpublishing removes it. A failed lookup returns an empty
 * list rather than an error, because a search that cannot reach the directory
 * should still show movies and series.
 */
/** "@SpyAgent " → "spyagent": the @ is how usernames are SHOWN, so it is how people type them. */
export const normalizeSearchTerm = (term) => String(term ?? "").trim().replace(/^@+/, "").trim();

/** The public card for one page — the same fields the directory answers with. */
const memberCard = (page) => ({
  handle: page.handle,
  displayName: page.displayName || page.handle,
  ...(page.avatar ? { avatar: page.avatar } : {}),
  ...(page.bio ? { bio: page.bio } : {}),
  ...(page.accent ? { accent: page.accent } : {}),
});

export const searchPublicProfiles = async (term, limit = 12) => {
  const clean = normalizeSearchTerm(term);
  if (clean.length < 2) return [];
  let found = null;
  try {
    const { searchProfiles } = await api();
    const data = await counted("read", () => searchProfiles(clean, limit));
    found = Array.isArray(data?.profiles) ? data.profiles : [];
  } catch (err) {
    // An older server (installed before the directory existed) answers 404
    // here. The one-page read is much older, so an EXACT username still works.
    console.warn("Profile: directory search failed", err?.code || err?.message);
  }
  // A working directory already matches exact handles — only a MISSING one
  // (an older install) needs the one-page fallback, so no read is wasted.
  if (found) return found;

  const handle = normalizeHandle(clean);
  if (!HANDLE_PATTERN.test(handle)) return [];
  const { profile } = await loadProfile(handle);
  return profile ? [memberCard(profile)] : [];
};

/** Which handle belongs to this member — from the server's private pointer row. */
export const fetchMyHandle = async (uid) => {
  if (!uid) return "";
  const { getHandle } = await api();
  try {
    const data = await counted("read", () => getHandle(uid));
    const handle = normalizeHandle(data?.handle || "");
    if (handle) rememberLocalHandle(handle, uid);
    return handle;
  } catch {
    // Offline, signed out, or the server is down: the cached handle is what the
    // UI already has, and it is better than an empty box — but only when it is
    // THIS account's (a shared browser may hold another member's name).
    const owner = readLocalHandleOwner();
    return owner && owner !== uid ? "" : readLocalHandle();
  }
};

// ── writes ──────────────────────────────────────────────────────────────────

/** Has anyone taken this username as a PUBLIC page? (Public read, no auth.) */
export const isUsernameTaken = async (rawHandle) => {
  const clean = normalizeHandle(rawHandle);
  if (!HANDLE_PATTERN.test(clean)) return false;
  const { getProfile } = await api();
  try {
    await counted("read", () => getProfile(clean));
    return true;
  } catch {
    // A refused or unanswered read means we cannot tell — never block the member
    // on it. The server refuses the actual write if the name is taken, and that
    // refusal is what the member sees in words.
    return false;
  }
};

/**
 * Take a username. PRIVATE, and deliberately so: this writes only the private
 * pointer row, so the username exists on the member's account and nowhere else.
 * No page is created, nothing is readable by anyone, and My List stays exactly
 * as private as it was.
 *
 * The server is the referee (it can see every account, not just the published
 * ones): reserved names and names already pointed at somebody else come back as
 * a refusal with its own words, and nothing is written.
 */
export const reserveUsername = async (uid, rawHandle) => {
  const { ok, reason, handle } = validateHandle(rawHandle);
  if (!ok) return { ok: false, message: reason };
  if (!uid) return { ok: false, message: "Sign in first — a username belongs to an account." };

  const { putHandle } = await api();
  try {
    const saved = await counted("write", () => putHandle(uid, handle));
    rememberLocalHandle(handle, uid);
    return { ok: true, handle: saved?.handle || handle };
  } catch (err) {
    console.warn("Profile: reserve failed", err?.code || err?.message);
    return { ok: false, message: await explainWriteFailure(err, handle) };
  }
};

/**
 * Put the page online (or refresh it while it already is).
 *
 * This is the step that makes a username public. The server allows a page only
 * for the account the handle already points at, so a member who was onboarded
 * before the split — or who cleared their browser — is self-healed here: a
 * refusal that says "claim a username before publishing" makes this function
 * claim it and try once more, rather than sending the member to another screen.
 */
export const publishProfile = async (uid, rawHandle, displayName) => {
  const { ok, handle } = validateHandle(rawHandle);
  if (!ok) return { ok: false, message: "That username isn't valid." };
  if (!uid) return { ok: false, message: "Sign in first — a page belongs to an account." };

  const { putProfile, putHandle } = await api();
  const payload = buildPublicPayload({ handle, displayName, list: readMyList(), history: safeHistory() });

  const attempt = () => counted("write", () => putProfile(handle, payload));

  try {
    await attempt();
  } catch (err) {
    if (err?.status === 403 && /claim a username/i.test(err.message || "")) {
      try {
        await counted("write", () => putHandle(uid, handle));
        await attempt();
      } catch (retryErr) {
        console.warn("Profile: publish failed", retryErr?.code || retryErr?.message);
        return { ok: false, message: await explainWriteFailure(retryErr, handle) };
      }
    } else {
      console.warn("Profile: publish failed", err?.code || err?.message);
      return { ok: false, message: await explainWriteFailure(err, handle) };
    }
  }
  rememberLocalHandle(handle, uid);
  if (uid) rememberPublic(uid, handle);
  // ── read it back ────────────────────────────────────────────────────────
  // The server keeps the allowlist, and an older server does not know the
  // hosts this build's catalog uses — it stores the page with the picture
  // dropped, and the member sees a look that saved and a public page that
  // ignored it (owner, 2026-09-27: "this public page images doesn't update").
  // One read tells the truth, and the truth is actionable.
  const dropped = await droppedFields(handle, payload);
  return { ok: true, handle, dropped };
};

/**
 * Which of the fields we just sent the server did not keep.
 *
 * Only the three a member can SEE on their own page are compared, because those
 * are the ones whose loss looks like a broken site. An unreadable page is not a
 * drop — a read that fails must never turn a successful publish into a failure.
 */
const droppedFields = async (handle, payload) => {
  try {
    const { profile } = await loadProfile(handle);
    if (!profile) return [];
    const gone = [];
    if (payload.avatar && !profile.avatar) gone.push("picture");
    if (payload.cover && !profile.cover) gone.push("cover");
    if (payload.bio && !profile.bio) gone.push("bio");
    return gone;
  } catch {
    return [];
  }
};

/** Plain words for a profile the server would not store whole. */
export const droppedFieldsMessage = (dropped) =>
  `Your ${dropped.join(" and ")} couldn't be added to your public page right now. Everything else saved — ` +
  `please try again in a little while.`;

/** Fires when a republish comes back with a field the server dropped. */
export const PROFILE_WARNING_EVENT = "profile-publish-warning";

/**
 * Take the page offline. The username stays on the member's account (the pointer
 * row is untouched), so flipping back to public later restores the same address
 * — unless somebody else took that name in the meantime, in which case the next
 * publish says "taken" rather than failing silently.
 */
export const unpublishProfile = async (rawHandle) => {
  const clean = normalizeHandle(rawHandle);
  const { deleteProfile } = await api();
  try {
    await counted("write", () => deleteProfile(clean));
    forgetPublic();
    return { ok: true };
  } catch (err) {
    console.warn("Profile: unpublish failed", err?.code || err?.message);
    // Nothing published is not a failure — the member wanted it gone, and it is.
    if (err?.code === "not-found") {
      forgetPublic();
      return { ok: true };
    }
    return { ok: false, message: await explainWriteFailure(err, clean) };
  }
};

/** Give the username back entirely: page and private username both go. */
export const releaseHandle = async (uid, rawHandle) => {
  const { deleteHandle } = await api();
  try {
    // One call, one transaction server-side: the pointer row and the published
    // page go together (server/store.js releaseHandle), so a half-released name
    // cannot exist.
    await counted("write", () => deleteHandle(uid));
    forgetLocalHandle();
    forgetPublic();
    return { ok: true };
  } catch (err) {
    console.warn("Profile: release failed", err?.code || err?.message);
    return { ok: false, message: await explainWriteFailure(err, rawHandle) };
  }
};

/**
 * Put back what the SERVER lost, once per sign-in (called from useAccountSync).
 *
 *   • This browser published a page for this account and the server now has
 *     no such page → publish it again (the publish re-claims the username).
 *   • This browser knows the account's username but the server has no record
 *     of it → re-claim it privately, so nobody else can take the name.
 *
 * Only a definite "missing" answer triggers anything — a timeout or an error
 * never publishes. Costs one or two reads per sign-in, and a write only when
 * something really was lost.
 */
export const restoreLostProfile = async (uid, displayName = "") => {
  if (!uid) return { restored: "" };
  const flag = readLocalPublic();
  if (flag && flag.uid !== uid) return { restored: "" }; // another account's page
  if (flag && HANDLE_PATTERN.test(flag.handle)) {
    const { state } = await loadProfile(flag.handle);
    if (state !== "missing") return { restored: "" };
    const result = await publishProfile(uid, flag.handle, displayName);
    return { restored: result.ok ? "page" : "", handle: flag.handle };
  }
  const local = readLocalHandle();
  if (!HANDLE_PATTERN.test(local) || readLocalHandleOwner() !== uid) return { restored: "" };
  const { getHandle, putHandle } = await api();
  try {
    const data = await counted("read", () => getHandle(uid));
    if (data?.handle) return { restored: "" };
  } catch (err) {
    if (err?.code !== "not-found") return { restored: "" };
  }
  try {
    await counted("write", () => putHandle(uid, local));
    return { restored: "username", handle: local };
  } catch {
    return { restored: "" }; // taken meanwhile, or the server is down: nothing to force
  }
};

/** The public link, origin-relative so it works on whatever host is serving. */
export const profileUrl = (handle) => `/u/${normalizeHandle(handle)}`;

// ── keeping the published page current ──────────────────────────────────────
// A published profile that still lists last month's shows is worse than none,
// so while it is public the page follows the same events the cloud sync already
// listens to. Debounced, and a payload that did not change costs no write —
// exactly the discipline accountSync.js uses to respect the free tier.

export const PROFILE_PUBLISH_DEBOUNCE_MS = 2500;

let lastPublished = "";
let timer = null;

/** Fire-and-forget republish, at most once per debounce window. */
export const scheduleRepublish = (uid, handle, displayName) => {
  if (!uid || !handle) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const serialised = JSON.stringify(
      buildPublicPayload({ handle, displayName, list: readMyList(), history: safeHistory() }),
    );
    if (serialised === lastPublished) return; // nothing changed — no write
    lastPublished = serialised;
    publishProfile(uid, handle, displayName)
      .then((result) => {
        if (!result?.dropped?.length) return;
        try {
          window.dispatchEvent(
            new CustomEvent(PROFILE_WARNING_EVENT, { detail: droppedFieldsMessage(result.dropped) }),
          );
        } catch {
          /* no window (tests) */
        }
      })
      .catch(() => {});
  }, PROFILE_PUBLISH_DEBOUNCE_MS);
};

/** Subscribe to the two local list events. Returns an unsubscribe function. */
export const startProfileWatcher = (uid, handle, displayName) => {
  if (!uid || !handle) return () => {};
  const bump = () => scheduleRepublish(uid, handle, displayName);
  window.addEventListener("mylist-updated", bump);
  window.addEventListener("history-updated", bump);
  // A picture, cover, bio or colour change republishes the same way a list change
  // does (LOOK_EVENT comes from utils/profileLook.js writeLook()).
  window.addEventListener(LOOK_EVENT, bump);
  return () => {
    window.removeEventListener("mylist-updated", bump);
    window.removeEventListener("history-updated", bump);
    window.removeEventListener(LOOK_EVENT, bump);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
};

// Continue Watching, read from the same key the player writes — the same
// defensive parse accountSync.readHistory does (this module stays independent
// of the sync layer so publishing never depends on sync being switched on).
const safeHistory = () => {
  try {
    const raw = JSON.parse(localStorage.getItem("continueWatching") || "[]");
    return Array.isArray(raw) ? raw.filter((i) => i && i.id) : [];
  } catch {
    return [];
  }
};

/**
 * APP-WIDE republisher (owner, 2026-09-27: "I pressed sync, still my list isn't
 * updating" on /u/spyxagentkun). The page used to be republished only by a
 * watcher mounted on /account, so a title added from a movie page updated the
 * cloud copy but never the public page. This runs for the whole signed-in
 * session (useAccountSync) and republishes whenever this browser remembers the
 * page as public for THIS account. `getDisplayName` is read at publish time so
 * a rename is never overwritten by an old name.
 */
export const startPublicPageWatcher = (uid, getDisplayName = () => "") => {
  if (!uid) return () => {};
  const bump = () => {
    const flag = readLocalPublic();
    if (!flag || flag.uid !== uid || !HANDLE_PATTERN.test(flag.handle)) return;
    scheduleRepublish(uid, flag.handle, getDisplayName() || flag.handle);
  };
  window.addEventListener("mylist-updated", bump);
  window.addEventListener("history-updated", bump);
  window.addEventListener(LOOK_EVENT, bump);
  return () => {
    window.removeEventListener("mylist-updated", bump);
    window.removeEventListener("history-updated", bump);
    window.removeEventListener(LOOK_EVENT, bump);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
};

/**
 * Republish NOW when this browser remembers the page as public for `uid` —
 * after a sign-in merge (lists may have changed on another device) and on
 * "Sync now". Returns the handle published, or "".
 */
export const republishIfPublic = async (uid, displayName = "") => {
  const flag = readLocalPublic();
  if (!uid || !flag || flag.uid !== uid || !HANDLE_PATTERN.test(flag.handle)) return "";
  const result = await publishProfile(uid, flag.handle, displayName || flag.handle);
  if (!result?.ok) return "";
  lastPublished = JSON.stringify(
    buildPublicPayload({ handle: flag.handle, displayName: displayName || flag.handle, list: readMyList(), history: safeHistory() }),
  );
  return flag.handle;
};

/**
 * Pages published before this browser kept the "public" note (owner's
 * /u/spyxagentkun, published 13:37 UTC on 2026-09-27) were invisible to the
 * republisher, so nothing ever updated them. Ask the server once per sign-in:
 * if this account's username has a LIVE page, note it and republish now.
 * Returns the handle republished, or "".
 */
export const adoptLivePage = async (uid, displayName = "") => {
  if (!uid) return "";
  const flag = readLocalPublic();
  if (flag && flag.uid === uid) return republishIfPublic(uid, displayName);
  if (flag && flag.uid !== uid) return ""; // another account's note — never touch it
  let handle = "";
  try {
    const { getHandle } = await api();
    const data = await counted("read", () => getHandle(uid));
    handle = normalizeHandle(data?.handle || "");
  } catch {
    return ""; // unknown is not "public" — never publish on a guess
  }
  if (!HANDLE_PATTERN.test(handle)) return "";
  const { state } = await loadProfile(handle).catch(() => ({ state: "error" }));
  if (state !== "ready") return "";
  rememberPublic(uid, handle);
  return republishIfPublic(uid, displayName);
};

/** The Account page saw the page live on the server: remember it (pages published before the flag existed). */
export const markPagePublic = (uid, handle) => {
  if (uid && HANDLE_PATTERN.test(normalizeHandle(handle))) rememberPublic(uid, handle);
};

/** Drop the no-op cache (used when the handle changes or the profile is released). */
export const resetPublishCache = () => {
  lastPublished = "";
};

/**
 * A look that was never synced (it only lived in one browser before the cloud
 * copy carried it) can still exist on the member's PUBLISHED page. When this
 * browser and the cloud both have nothing, adopt the page's look once, so a
 * member who cleared site data gets their picture, banner and bio back.
 */
export const recoverLookFromPage = async (uid) => {
  if (!uid) return false;
  if (readLookStamp() || hasLook(readLook())) return false;
  const handle = await fetchMyHandle(uid).catch(() => "");
  if (!HANDLE_PATTERN.test(handle)) return false;
  const page = await fetchProfile(handle).catch(() => null);
  const look = { bio: page?.bio || "", accent: page?.accent || "", avatar: page?.avatar || "", cover: page?.cover || "" };
  if (!hasLook(look)) return false;
  writeLook(look, { synced: true }); // stamped now, so the next push uploads it
  return true;
};
