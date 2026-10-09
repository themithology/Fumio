// ─── Live TV — pure navigation helpers (unit-tested, no DOM) ─────────────────
//
// The theater page (`LiveTvWatch.jsx`) needs three answers on every render:
//
//   * which channels does the rail under the player show? (a guide section, or
//     the viewer's own My List)
//   * which channel does "next channel" land on? (the zap buttons in the
//     header, the ones under the player, the arrow keys, and the in-player
//     channel changer all share this one rule)
//   * where does the current channel sit in that list? (the "12 / 34" readout)
//
// They live here, apart from the component, so the wrap-around, the
// deep-linked-channel-not-in-this-rail case and the single-channel rail are
// regression-tested without a browser (tests/live-tv-zap.test.mjs).

/** Rail key for the viewer's own list — the theater's "My List" chip. */
export const FAVS_RAIL = "favs";

/** Channel ids as strings, junk dropped (a pool can carry a null entry). */
export const channelIds = (list) =>
  (Array.isArray(list) ? list : [])
    .map((c) => (c && c.id !== undefined && c.id !== null ? String(c.id) : ""))
    .filter(Boolean);

/**
 * The channels a rail shows. `favs` is the ONE rail that is not a guide
 * section — it comes from localStorage-backed favourites, resolved to channel
 * objects by the caller (ids whose channel left the guide simply drop out).
 */
export const railChannelsFor = (railKey, pools, favorites) => {
  if (railKey === FAVS_RAIL) return Array.isArray(favorites) ? favorites : [];
  const list = pools && pools[railKey];
  return Array.isArray(list) ? list : [];
};

/**
 * Where a zap lands. `dir` is +1 (next) or -1 (previous).
 *
 *   * the list wraps in both directions — the last channel's "next" is the
 *     first, and the first channel's "previous" is the last;
 *   * a channel that is NOT in the rail (a deep link into another section, or
 *     My List while the rail shows Sports) enters the rail at its edge: next
 *     goes to the first channel, previous to the last — never a jump to the
 *     second one, which is what a raw index lookup used to do;
 *   * a rail with a single channel that IS the current one has nowhere to go
 *     (null), so the buttons stay disabled instead of turning into a no-op
 *     that silently retunes the same feed.
 *
 * Returns the target id as a string, or null when there is no move to make.
 */
export const zapTarget = (list, currentId, dir) => {
  const ids = channelIds(list);
  if (!ids.length) return null;
  const current = String(currentId ?? "");
  const at = ids.indexOf(current);
  if (at < 0) return dir >= 0 ? ids[0] : ids[ids.length - 1];
  if (ids.length < 2) return null;
  const next = ids[(at + (dir >= 0 ? 1 : -1) + ids.length) % ids.length];
  return next === current ? null : next;
};

/** "12 / 34" for the current channel, or `{ index: 0, total: n }` off-rail. */
export const channelPosition = (list, currentId) => {
  const ids = channelIds(list);
  const at = ids.indexOf(String(currentId ?? ""));
  return { index: at >= 0 ? at + 1 : 0, total: ids.length };
};
