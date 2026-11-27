// ─── Which host serves Firebase's sign-in popup ──────────────────────────────
//
// `authDomain` is NOT a label. It is the ORIGIN the sign-in helper is actually
// loaded from: the Firebase JS SDK builds every federated sign-in URL as
//     https://<authDomain>/__/auth/handler?apiKey=…&providerId=…
// (WIDGET_PATH in @firebase/auth) and that page is served by FIREBASE HOSTING,
// and only by Firebase Hosting. Change this string to a host that does not
// serve `/__/auth/*` and the "Continue with Google" popup opens the site's own
// HTML instead of the helper — Google sign-in dies, email/password and the
// anonymous analytics identity keep working, and no account or document is
// touched. Hence the probe below instead of a hopeful literal.
//
// The owner wants the popup to say the site's own domain and never show a
// `*.firebaseapp.com` host. That is only honest once the apex is connected in
// Firebase → Hosting AND the Google OAuth client carries
//     https://theogpiratebot.to/__/auth/handler
// as an authorised redirect URI (docs/ACCOUNTS.md §"Signing in on our own
// domain"). Until BOTH are true the apex cannot serve the helper, so we ask
// the running site which one is real and fall back to Firebase's own host.
//
// THE FAILURE DIRECTION IS THE POINT: a probe we cannot read, a probe that
// times out, a probe that sees the SPA rewrite or a bot-challenge page all
// resolve to the Firebase host — i.e. exactly the behaviour that works today.
// Nothing here can take sign-in away, and none of it can reach Firestore or
// Auth data (those are addressed by projectId/apiKey/appId, which are
// project identifiers, NOT domains — see the guardrail in src/firebase.js).

/**
 * The site's own apex. Moved from theogpiratebot.online on 2026-11-27.
 *
 * READ THIS BEFORE "FIXING" THE FALLBACK BELOW. `authDomain` is not a label;
 * it is the origin Firebase Hosting serves `/__/auth/handler` from, and only a
 * host that Firebase Hosting serves can answer it. resolveAuthDomain() therefore
 * deliberately returns FALLBACK_AUTH_DOMAIN to-day — see the note there. This
 * constant changing does NOT change the popup host by itself, by design.
 */
export const PRIMARY_AUTH_DOMAIN = "theogpiratebot.to";
export const FALLBACK_AUTH_DOMAIN = "ogpb-331d5.firebaseapp.com";

/** The one reserved path Firebase Hosting serves the sign-in helper from. */
export const HANDLER_PATH = "/__/auth/handler";

const CACHE_KEY = "opb:firebase-auth-domain";
const CACHE_TTL_MS = 60 * 60 * 1000; // re-check hourly; the verdict is stable
const PROBE_TIMEOUT_MS = 4000;

/**
 * Strip the parts a human pastes in. Accepts "https://theogpiratebot.to/",
 * "theogpiratebot.to" and "theogpiratebot.to/__" alike, because this
 * string also comes from a Vercel env var someone typed by hand.
 */
export const normaliseDomain = (value) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/\/.*$/, "");
};

/**
 * Does this HTML look like the sign-in helper, or like something else entirely?
 *
 * Rejection-only on purpose. The apex is served by our own Vercel/Cloudflare
 * stack, so the two things that can come back for `/__/auth/handler` are (a)
 * the SPA catch-all rewrite — byte-identical to `/` — and (b) a Cloudflare
 * bot-challenge page. Both are caught below. Anything else answering 2xx on
 * that path is Firebase Hosting, because nothing else hosts it. Guessing at
 * Google's private markup here would be the fragile way round: a marker that
 * Firebase reorganises would silently downgrade us to the fallback forever,
 * and nobody would notice the domain never changed.
 */
export const isAuthHelperResponse = (status, text) => {
  if (!(status >= 200 && status < 300)) return false;
  const body = String(text ?? "");
  if (!body.trim()) return false; // an empty 200 is a redirect stub, not a page
  if (body.includes('id="root"')) return false; // our own SPA shell
  if (body.includes("/assets/")) return false; // …and the hashed bundle it loads
  if (body.includes("TheOGPirateBot — Movies")) return false; // our <title>
  if (body.includes("challenge-platform") || body.includes("cf-challenge")) return false;
  if (body.includes("Just a moment") || body.includes("Attention Required")) return false;
  if (body.includes("__/auth/iframe") || body.includes("__/auth/handler")) return true;
  return true; // not the SPA, not a challenge → Firebase Hosting
};

// ─── localStorage cache (best-effort; private mode throws) ───────────────────
const safeStorage = (storage) => {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const readAuthDomainCache = (storage) => {
  try {
    const store = safeStorage(storage);
    if (!store) return null;
    const parsed = JSON.parse(store.getItem(CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.at !== "number") return null;
    if (typeof parsed.ready !== "boolean") return null;
    return parsed;
  } catch {
    return null; // corrupt JSON, storage blocked — re-probe
  }
};

const writeAuthDomainCache = (storage, entry) => {
  try {
    safeStorage(storage)?.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* private mode / quota: the probe just runs again next load */
  }
};

/** The cached verdict, or null when it is missing or older than the TTL. */
const freshCache = (storage, now) => {
  const entry = readAuthDomainCache(storage);
  if (!entry) return null;
  return now - entry.at < CACHE_TTL_MS ? entry : null;
};

// ─── The probe ───────────────────────────────────────────────────────────────
/**
 * Ask a host whether it really serves Firebase's sign-in helper.
 *
 * A cross-origin fetch that cannot read the response (no CORS header — which is
 * what our own Vercel/Cloudflare hosts answer with) REJECTS, and that is a
 * "no". That is deliberate: from localhost, a Vercel preview host or a
 * Pterodactyl IP the answer can only ever be a guess, and the safe guess is
 * the host that is known to work. On the canonical host the probe is
 * same-origin, fully readable, and exact — which is the one case that matters
 * for what the popup shows.
 */
export const probeAuthDomain = async (domain, { fetchImpl, timeoutMs = PROBE_TIMEOUT_MS } = {}) => {
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(`https://${domain}${HANDLER_PATH}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller?.signal,
    });
    if (!res.ok) return false;
    const text = typeof res.text === "function" ? await res.text() : "";
    return isAuthHelperResponse(res.status, text);
  } catch {
    return false; // offline, blocked, CORS, aborted — all mean "not proven"
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// ─── The decision ────────────────────────────────────────────────────────────
/**
 * Which authDomain should this build use? Memoised per page load.
 *
 * 1. `VITE_FIREBASE_AUTH_DOMAIN` wins outright. That is the rollback: set it
 *    to either host in the Vercel dashboard and redeploy, no code change, no
 *    data touched.
 * 2. Otherwise a fresh cached verdict.
 * 3. Otherwise probe the primary, cache the answer, and return whichever host
 *    the site proved it can actually use.
 */
export const resolveAuthDomain = async ({
  env,
  storage,
  fetchImpl,
  now = Date.now(),
  primary = PRIMARY_AUTH_DOMAIN,
  fallback = FALLBACK_AUTH_DOMAIN,
} = {}) => {
  const override = normaliseDomain(env?.VITE_FIREBASE_AUTH_DOMAIN ?? "");
  if (override) return override;

  // One-click Google must open Firebase Hosting's helper, not the site's SPA
  // at theogpiratebot.to/__/auth/handler. Always use the known-working host
  // unless an env override is set.
  //
  // THE DOMAIN MOVE DOES NOT CHANGE THIS LINE, ON PURPOSE. Switching the apex
  // from .online to .to does NOT make Firebase Hosting answer on .to: that needs
  //   (a) the .to apex connected in Firebase → Hosting, and
  //   (b) https://theogpiratebot.to/__/auth/handler registered as an authorised
  //       redirect URI on the Google OAuth client.
  // Until both are true, pointing authDomain at .to opens the site's own HTML in
  // the sign-in popup and Google sign-in dies — silently, with no error, for
  // every visitor. Set VITE_FIREBASE_AUTH_DOMAIN=theogpiratebot.to in the deploy
  // environment once (a) and (b) are done; that is the whole switch, and it
  // needs no code change.
  void primary;
  void storage;
  void fetchImpl;
  void now;
  return fallback;
};
