// ─── dbTimeout.js — no database call may hang the UI, ever ──────────────────
// Owner, 2026-09-25: "It keeps saving for infinite time but never saves."
//
// That is what a Firestore promise does when the request never gets an answer:
// the SDK retries in the background and the promise simply stays pending —
// there is no rejection, no error, no timeout of its own. Every await in this
// app therefore goes through withTimeout(), so the worst case is a message the
// member can act on instead of a spinner that never stops.
//
// The underlying request is NOT cancelled (the JS SDK offers no way to cancel a
// write). It may still complete in the background, which is why the copy says
// so and suggests reloading.

/** Writes get a generous window: slow mobile networks are normal. */
export const DB_TIMEOUT_MS = 12000;
/** Reads are cheaper to retry, so they may fail faster. */
export const DB_READ_TIMEOUT_MS = 9000;

/** Rejection marker — never shown to anyone, matched on to pick the copy. */
export const TIMEOUT_CODE = "timeout";

/**
 * Google's code for "this project has used up its Firestore allowance for now".
 *
 * Found the hard way (2026-09-25): the owner's phone showed "The cloud never
 * answered (timed out)" while every request WAS reaching Google. A probe run
 * from a clean network printed the real answer —
 *
 *     @firebase/firestore: FirebaseError: [code=resource-exhausted]: Quota exceeded.
 *     @firebase/firestore: Using maximum backoff delay to prevent overloading the backend.
 *
 * — and the SDK treats that code as RETRYABLE: it backs off and retries forever,
 * so the write promise never settles and the app sees only a timeout. No amount
 * of transport tuning fixes a spent allowance, which is why this now has a name,
 * a latch, and its own sentence.
 */
export const QUOTA_CODE = "resource-exhausted";

/**
 * The quota latch.
 *
 * Once Google says the allowance is gone, every further write is doomed — and
 * every one of them retries in the background from a phone on mobile data. So
 * the app stops STARTING writes for a while instead of spinning: the latch is
 * in memory (a reload is a fresh attempt) and expires on its own.
 */
export const QUOTA_HOLD_MS = 15 * 60 * 1000;
let quotaUntil = 0;
let quotaSeen = false;

/** True while the app is deliberately not starting new writes. */
export const isQuotaExhausted = () => quotaUntil > Date.now();

/** Whether Google has named this in this page load at all (for copy). */
export const sawQuotaExhausted = () => quotaSeen;

/** Latch it. Called wherever a real resource-exhausted error surfaces. */
export const markQuotaExhausted = () => {
  quotaSeen = true;
  quotaUntil = Date.now() + QUOTA_HOLD_MS;
  return quotaUntil;
};

/** Tests and the Check button need a clean slate. */
export const resetQuotaLatch = () => {
  quotaUntil = 0;
  quotaSeen = false;
};

/**
 * The one sentence for "Google is refusing writes because the allowance is
 * spent". Deliberately quotes Google instead of theorising, and says what is
 * NOT broken — the account, the rules, the database, the build.
 */
export const quotaMessage = () =>
  `Google is refusing writes for this project: the free Firestore allowance is used up for now (its own words: "Quota exceeded"). Nothing is wrong with your account, your list, this app or the deployment. Your list keeps working on this device, the app stops hammering the database for ${Math.round(
    QUOTA_HOLD_MS / 60000,
  )} minutes, and the allowance refills at midnight US Pacific time (about 12:30 pm IST).`;

/**
 * The sentence for "it never answered" — ONE copy, used by every consumer.
 *
 * The reachability probe decides which of the two different problems this is: a
 * browser that cannot reach the database host at all (a content blocker, a DNS
 * filter, the network), or a request that reached Google and was never answered
 * (which, since 2026-09-25, is most often the spent allowance above — the SDK
 * hides that behind an endless retry).
 */
export const explainDbSilence = async (seconds = Math.round(DB_TIMEOUT_MS / 1000)) => {
  if (isQuotaExhausted()) return quotaMessage();
  const reachable = await dbHostReachable();
  const tail = `Please try again in a moment. If the change did go through in the background, reloading this page will show it.`;
  if (reachable === false) {
    return `The database never answered after ${seconds} seconds, and this browser could not reach its host at all — so the request never left. That is a content blocker, a DNS filter, or the network you are on (sign-in still works because Google uses a different host). Turn the blocker off for this site, or try another connection. ${tail}`;
  }
  if (reachable === true) {
    return `The database host is reachable, but the request was never answered within ${seconds} seconds. ${tail}`;
  }
  return `The database did not answer within ${seconds} seconds. ${tail}`;
};

/**
 * Turn any Firestore failure into the honest sentence for its code.
 * The quota case is checked first: it is the one failure the app can name
 * exactly, and the one that used to be reported as "timed out".
 */
export const explainDbError = async (err, seconds) => {
  const code = err?.code || "";
  if (code === QUOTA_CODE) {
    markQuotaExhausted();
    return quotaMessage();
  }
  if (code === TIMEOUT_CODE) return explainDbSilence(seconds);
  return "";
};

export const withTimeout = (promise, ms = DB_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(TIMEOUT_CODE);
      err.code = TIMEOUT_CODE;
      reject(err);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

/**
 * Can this browser reach the site's OWN database at all?
 *
 * It used to probe firestore.googleapis.com (the Firestore era); the database is
 * on the site's own server now, so it probes that instead — same origin, so
 * there is no CORS and no third party in the way, and the answer is precisely
 * the thing that matters: did a request leave this browser and come back?
 *
 * The health route is public and tiny, which is what makes it a fair reachability
 * probe: if it cannot answer, nothing else would either. It costs one 3-second
 * request and only ever runs after something has ALREADY gone wrong.
 *
 * Returns true | false | null (null = cannot tell).
 */
export const dbHostReachable = async () => {
  if (typeof fetch !== "function") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch("/api/db/health", {
        cache: "no-store",
        signal: controller.signal,
      });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
};
