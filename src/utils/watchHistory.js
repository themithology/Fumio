const HISTORY_KEY = "continueWatching";
export const HISTORY_UPDATED_EVENT = "history-updated";
export const HISTORY_PROGRESS_EVENT = "history-progress";
export const HISTORY_CAP = 10;

const getStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const parse = (raw) => {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.filter((item) => item && item.id) : [];
  } catch {
    return [];
  }
};

const keyOf = (item) => `${item?.type || item?.media_type || "movie"}-${item?.id}`;
const emit = (eventName) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(eventName));
};

export const readContinueWatching = () => parse(getStorage()?.getItem(HISTORY_KEY));

export const writeContinueWatching = (list, { progress = false } = {}) => {
  const seen = new Set();
  const clean = (Array.isArray(list) ? list : [])
    .filter((item) => item && item.id)
    .map((item) => ({ ...item, type: item.type || item.media_type || "movie" }))
    .filter((item) => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.lastUpdated || 0) - Number(a.lastUpdated || 0))
    .slice(0, HISTORY_CAP);
  try {
    getStorage()?.setItem(HISTORY_KEY, JSON.stringify(clean));
  } catch {
    return false;
  }
  emit(HISTORY_UPDATED_EVENT);
  if (progress) emit(HISTORY_PROGRESS_EVENT);
  return true;
};

/** Save the title/episode when the existing Fumio player is opened. */
export const saveContinueWatching = (item) => {
  if (!item?.id) return false;
  const key = keyOf(item);
  const existing = readContinueWatching().find((entry) => keyOf(entry) === key);
  const samePlayback = Boolean(
    existing &&
      ((item.type || item.media_type) !== "tv" ||
        (existing.season === item.season && existing.episode === item.episode)),
  );
  const preserved = samePlayback
    ? {
        ...(existing.progress === undefined ? {} : { progress: existing.progress }),
        ...(existing.duration === undefined ? {} : { duration: existing.duration }),
        ...(existing.minutesLeft === undefined ? {} : { minutesLeft: existing.minutesLeft }),
        ...(existing.episodeName ? { episodeName: existing.episodeName } : {}),
        ...(existing.episodeStill ? { episodeStill: existing.episodeStill } : {}),
      }
    : {};
  const next = readContinueWatching().filter((entry) => keyOf(entry) !== key);
  next.unshift({
    ...existing,
    ...item,
    ...preserved,
    type: item.type || item.media_type || "movie",
    media_type: item.media_type || item.type || "movie",
    lastUpdated: Date.now(),
  });
  return writeContinueWatching(next, { progress: true });
};

export const saveContinueWatchingProgress = (item, currentTime, duration) => {
  if (!item?.id) return false;
  const total = Number(duration);
  const position = Number(currentTime);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(position)) return false;
  const key = keyOf(item);
  const existing = readContinueWatching().find((entry) => keyOf(entry) === key);
  const samePlayback = Boolean(
    existing &&
      ((item.type || item.media_type) !== "tv" ||
        (existing.season === item.season && existing.episode === item.episode)),
  );
  if (!samePlayback) return false;
  const safeDuration = Math.round(Math.min(total, 6 * 60 * 60));
  const safePosition = Math.max(0, Math.min(Math.round(position), safeDuration));
  const next = readContinueWatching().filter((entry) => keyOf(entry) !== key);
  next.unshift({
    ...existing,
    progress: safePosition,
    duration: safeDuration,
    minutesLeft: Math.max(0, Math.ceil((safeDuration - safePosition) / 60)),
    lastUpdated: Date.now(),
  });
  return writeContinueWatching(next, { progress: true });
};

export const removeContinueWatching = (itemOrId, mediaType = "movie") => {
  const key = typeof itemOrId === "object" ? keyOf(itemOrId) : `${mediaType}-${itemOrId}`;
  return writeContinueWatching(readContinueWatching().filter((item) => keyOf(item) !== key));
};

export const historyKey = (item) => keyOf(item);
