// ─── dbUsage.js — the allowance is a budget, and the app is the one spending it
//
// Owner, 2026-09-25: "Yep I have hit the limit long ago like 6-7 days ago."
//
// The project ran out of Firestore allowance and stayed out — which means the
// app was spending the whole free tier, every day, and losing the member's own
// writes each time it did. A budget nobody can see is not a budget, so this
// module does three things:
//
//   1. COUNTS what this device asks the database to do, per day, in localStorage
//      (numbers only — no content, no ids, nothing that leaves the device).
//   2. RATIONS the part nobody needs: analytics events. They stop at
//      ANALYTICS_WRITE_BUDGET for the day, so a runaway page-view loop can never
//      again eat the allowance that member sync depends on.
//   3. NEVER RATIONS member data. My List and Continue Watching are the reason
//      the database exists; if a budget could block them, the budget would be
//      the bug. They are counted, never refused.
//
// Every function is safe to call anywhere: no throw, no await, no network. If
// localStorage is unavailable (private mode, blocked cookies) the counters
// simply do not persist for that session.

/** Analytics events a single device may write per day. */
export const ANALYTICS_WRITE_BUDGET = 60;
/** Firestore's free per-day allowance for a project (documented, for context). */
export const FREE_DAILY_WRITE_LIMIT = 20000;

const KEY = "iris-db-usage-v1";

/** Local calendar day, so "today" means the owner's day, not UTC's. */
export const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const empty = () => ({ writes: 0, reads: 0, refusals: 0, analytics: 0 });

/** Today's counters, always a complete object (never null). */
export const readUsage = (key = dayKey()) => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}");
    const today = all?.[key];
    if (!today || typeof today !== "object") return { ...empty(), day: key };
    return { ...empty(), ...today, day: key };
  } catch {
    return { ...empty(), day: key };
  }
};

const writeUsage = (usage) => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}");
    // Keep a week, so a bad day can still be looked at tomorrow.
    const trimmed = Object.fromEntries(
      Object.entries({ ...all, [usage.day]: usage })
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .slice(0, 7),
    );
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
};

/**
 * Count one database call.
 *
 * `kind`:
 *   • "write"      — any write, including member data
 *   • "read"       — any read
 *   • "refusal"    — a call that came back refused, for any reason
 *   • "analytics"  — a write that was an analytics event (also a "write")
 *
 * Returns the updated counters so a caller can decide something with them.
 */
export const recordDbCall = (kind) => {
  const usage = readUsage();
  if (kind === "write" || kind === "analytics") {
    usage.writes += 1;
    if (kind === "analytics") usage.analytics += 1;
  } else if (kind === "read") {
    usage.reads += 1;
  } else if (kind === "refusal") {
    usage.refusals += 1;
  }
  writeUsage(usage);
  return usage;
};

/** Analytics events written today from this device. */
export const analyticsSpent = () => readUsage().analytics;

/**
 * May another analytics event be written today?
 *
 * Deliberately generous — a person browsing for an hour writes a handful of
 * events, so the budget is only ever reached by a loop or a flood, which is
 * exactly what it is there to stop.
 */
export const analyticsBudgetLeft = () => Math.max(0, ANALYTICS_WRITE_BUDGET - analyticsSpent());

/** The line /account shows, so the owner can see the app's own spending. */
export const usageSummary = () => {
  const u = readUsage();
  return `${u.writes} database writes + ${u.reads} reads from this device today`;
};
