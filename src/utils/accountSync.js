import { getUserData, putUserData, deleteUserData } from "./dbApi.js";
import { readMyList, writeMyList, MY_LIST_CAP } from "./myList.js";
import { readContinueWatching, writeContinueWatching, HISTORY_CAP } from "./watchHistory.js";
import { readLook, readLookStamp, writeLook, hasLook, LOOK_EVENT } from "./profileLook.js";

const OWNER_KEY = "fumio-account-owner";
const STASH_PREFIX = "fumio-account-stash:";
const GUEST_OWNER = "";
const SYNC_FLAG_KEY = "fumio-account-sync";
const WRITE_DEBOUNCE_MS = 2500;
export const PROGRESS_PUSH_MS = 60 * 1000;

const safeStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(safeStorage()?.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    safeStorage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const remove = (key) => {
  try {
    safeStorage()?.removeItem(key);
  } catch {
    /* private mode */
  }
};

const listKey = (item) => `${item?.type || item?.media_type || "movie"}-${item?.id}`;

/** Merge by title, retaining the newest copy from either device. */
export const mergeByNewest = (local, cloud, stamp, cap) => {
  const best = new Map();
  for (const item of [...(cloud || []), ...(local || [])]) {
    if (!item?.id) continue;
    const key = listKey(item);
    const existing = best.get(key);
    // Local wins a timestamp tie: it is the copy the member can see/edit now.
    if (!existing || Number(item[stamp] || 0) >= Number(existing[stamp] || 0)) best.set(key, item);
  }
  return [...best.values()]
    .sort((a, b) => Number(b[stamp] || 0) - Number(a[stamp] || 0))
    .slice(0, cap);
};

export const mergeMyList = (local, cloud) => mergeByNewest(local, cloud, "addedAt", MY_LIST_CAP);
export const mergeHistory = (local, cloud) => mergeByNewest(local, cloud, "lastUpdated", HISTORY_CAP);

let status = { state: "off", message: "", at: 0 };
const statusListeners = new Set();
export const subscribeSyncStatus = (listener) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};
export const getSyncStatus = () => status;
const setStatus = (patch) => {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener());
};

export const isSyncEnabled = () => {
  try {
    return safeStorage()?.getItem(SYNC_FLAG_KEY) !== "off";
  } catch {
    return true;
  }
};

export const setSyncEnabled = (enabled) => {
  try {
    safeStorage()?.setItem(SYNC_FLAG_KEY, enabled ? "on" : "off");
  } catch {
    /* local-only mode remains usable */
  }
  setStatus({ state: enabled ? "idle" : "off", message: "", at: Date.now() });
  window.dispatchEvent(new CustomEvent("account-sync-changed"));
};

const stashKey = (uid) => `${STASH_PREFIX}${encodeURIComponent(uid)}`;

/**
 * Keep one browser's account data from becoming another account's starting
 * point. A signed-out visitor gets a fresh local-first list; the previous
 * member's local copy stays in a uid-keyed stash and is merged back only when
 * that same account returns.
 */
export const claimDevice = (uid) => {
  if (!uid) return;
  const current = readJson(OWNER_KEY, GUEST_OWNER);
  if (current && current !== uid) {
    writeJson(stashKey(current), { myList: readMyList(), continueWatching: readContinueWatching() });
    writeMyList([]);
    writeContinueWatching([]);
  }

  const saved = readJson(stashKey(uid), null);
  if (saved) {
    writeMyList(mergeMyList(readMyList(), Array.isArray(saved.myList) ? saved.myList : []));
    writeContinueWatching(mergeHistory(readContinueWatching(), Array.isArray(saved.continueWatching) ? saved.continueWatching : []));
    remove(stashKey(uid));
  }
  writeJson(OWNER_KEY, uid);
};

export const releaseDevice = (uid) => {
  if (!uid) return;
  const current = readJson(OWNER_KEY, GUEST_OWNER);
  if (current !== uid) return;
  writeJson(stashKey(uid), { myList: readMyList(), continueWatching: readContinueWatching() });
  writeMyList([]);
  writeContinueWatching([]);
  writeJson(OWNER_KEY, GUEST_OWNER);
};

export const readDeviceOwner = () => readJson(OWNER_KEY, GUEST_OWNER);

const explainFailure = (error) => {
  const code = error?.code || "";
  if (code === "timeout") return "Your lists are safe on this device. The database took too long to answer; sync will retry.";
  if (code === "unavailable") return "Your lists are safe on this device. The site's SQLite server could not be reached; sync will catch up later.";
  if (code === "auth-unavailable") return "Your lists are safe on this device. The server could not check this sign-in right now; try again in a moment.";
  if (code === "unauthenticated" || code === "permission-denied") return "Your lists are safe on this device. Sign in again to resume syncing.";
  return "Your lists are safe on this device. Cloud sync is temporarily unavailable.";
};

let lastPushedByUid = new Map();

export const pullCloudData = async (uid) => {
  try {
    const data = await getUserData(uid);
    return {
      myList: Array.isArray(data?.myList) ? data.myList : [],
      continueWatching: Array.isArray(data?.continueWatching) ? data.continueWatching : [],
      look: data?.look && typeof data.look === "object" ? data.look : null,
    };
  } catch (error) {
    if (error?.code === "not-found") return { myList: [], continueWatching: [], look: null };
    setStatus({ state: "error", message: explainFailure(error), at: Date.now() });
    console.warn("Cloud sync read failed:", error?.code || error?.message);
    return null;
  }
};

export const pushCloudData = async (uid) => {
  if (!uid || !isSyncEnabled()) return false;
  const payload = {
    myList: readMyList().slice(0, MY_LIST_CAP),
    continueWatching: readContinueWatching().slice(0, HISTORY_CAP),
  };
  const look = readLook();
  const lookAt = readLookStamp();
  if (lookAt || hasLook(look)) payload.look = { ...look, updatedAt: lookAt };
  const serialised = JSON.stringify(payload);
  if (serialised === lastPushedByUid.get(uid)) return true;

  setStatus({ state: "syncing", message: "", at: Date.now() });
  try {
    await putUserData(uid, payload);
    lastPushedByUid.set(uid, serialised);
    setStatus({ state: "synced", message: "", at: Date.now() });
    return true;
  } catch (error) {
    setStatus({ state: "error", message: explainFailure(error), at: Date.now() });
    console.warn("Cloud sync write failed:", error?.code || error?.message);
    return false;
  }
};

export const pullAndMerge = async (uid) => {
  setStatus({ state: "syncing", message: "", at: Date.now() });
  const cloud = await pullCloudData(uid);
  if (!cloud) return false;

  const localList = readMyList();
  const localHistory = readContinueWatching();
  const mergedList = mergeMyList(localList, cloud.myList);
  const mergedHistory = mergeHistory(localHistory, cloud.continueWatching);
  if (JSON.stringify(mergedList) !== JSON.stringify(localList)) writeMyList(mergedList);
  if (JSON.stringify(mergedHistory) !== JSON.stringify(localHistory)) writeContinueWatching(mergedHistory);
  const incomingLook = pickSyncedLook(readLook(), readLookStamp(), cloud.look);
  if (incomingLook) writeLook(incomingLook, { stamp: incomingLook.updatedAt || Date.now(), synced: true });
  return pushCloudData(uid);
};

export const pickSyncedLook = (localLook, localAt, cloudLook) => {
  if (!cloudLook || typeof cloudLook !== "object") return null;
  const cloudAt = Number(cloudLook.updatedAt) || 0;
  const localEmpty = !localAt && !hasLook(localLook);
  if (localEmpty) return hasLook(cloudLook) || cloudAt ? cloudLook : null;
  return cloudAt > localAt ? cloudLook : null;
};

export const readHistory = () => readContinueWatching();

export const deleteCloudData = async (uid) => {
  if (!uid) return false;
  try {
    await deleteUserData(uid);
    lastPushedByUid.delete(uid);
    setStatus({ state: "idle", message: "", at: Date.now() });
    return true;
  } catch (error) {
    if (error?.code === "not-found") return true;
    setStatus({ state: "error", message: explainFailure(error), at: Date.now() });
    return false;
  }
};

let debounceTimer = null;
let progressTimer = null;

const schedulePush = (uid) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pushCloudData(uid).catch(() => {});
  }, WRITE_DEBOUNCE_MS);
};

const scheduleProgress = (uid) => {
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    pushCloudData(uid).catch(() => {});
  }, PROGRESS_PUSH_MS);
};

export const startLocalWatcher = (uid) => {
  const onChange = () => schedulePush(uid);
  const onProgress = () => scheduleProgress(uid);
  const flush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (progressTimer) clearTimeout(progressTimer);
    debounceTimer = null;
    progressTimer = null;
    pushCloudData(uid).catch(() => {});
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };

  window.addEventListener("mylist-updated", onChange);
  window.addEventListener("history-updated", onChange);
  window.addEventListener(LOOK_EVENT, onChange);
  window.addEventListener("history-progress", onProgress);
  window.addEventListener("storage", onProgress);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  return () => {
    window.removeEventListener("mylist-updated", onChange);
    window.removeEventListener("history-updated", onChange);
    window.removeEventListener(LOOK_EVENT, onChange);
    window.removeEventListener("history-progress", onProgress);
    window.removeEventListener("storage", onProgress);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (progressTimer) clearTimeout(progressTimer);
    debounceTimer = null;
    progressTimer = null;
  };
};

export const resetSyncCache = () => {
  lastPushedByUid = new Map();
  setStatus({ state: "off", message: "", at: 0 });
};

export const clearCloudSyncState = (uid) => {
  if (uid) lastPushedByUid.delete(uid);
  setStatus({ state: "idle", message: "", at: Date.now() });
};
