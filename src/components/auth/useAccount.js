import { useEffect, useRef, useSyncExternalStore } from "react";
import { getAuthSnapshot, isRealUser, subscribeAuth } from "../../utils/auth.js";
import {
  claimDevice,
  getSyncStatus,
  isSyncEnabled,
  pullAndMerge,
  releaseDevice,
  resetSyncCache,
  startLocalWatcher,
  subscribeSyncStatus,
} from "../../utils/accountSync.js";
import { startPublicPageWatcher } from "../../utils/profiles.js";

export const useAuth = () => useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
export const useIsSignedIn = () => isRealUser(useAuth().user);
export const useSyncStatus = () => useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);

/** Mount once in App: hydrate on sign-in, then debounce local edits to SQLite. */
export const useAccountSync = () => {
  const { ready, user } = useAuth();
  const uid = isRealUser(user) ? user.uid : "";
  const displayNameRef = useRef(user?.displayName || "");
  displayNameRef.current = user?.displayName || "";
  const prevUidRef = useRef(uid);

  useEffect(() => {
    const was = prevUidRef.current;
    prevUidRef.current = uid;
    if (was && !uid) {
      releaseDevice(was);
      resetSyncCache();
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      resetSyncCache();
      return undefined;
    }

    let cancelled = false;
    let stopWatcher = null;
    let stopProfile = null;
    claimDevice(uid);

    const onSyncFlag = () => {
      if (isSyncEnabled()) pullAndMerge(uid).catch(() => {});
    };
    window.addEventListener("account-sync-changed", onSyncFlag);

    const boot = async () => {
      if (isSyncEnabled()) {
        for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
          const ok = await pullAndMerge(uid);
          if (ok) break;
          await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
        }
      }
      if (cancelled) return;
      stopWatcher = startLocalWatcher(uid);
      stopProfile = startPublicPageWatcher(uid, () => displayNameRef.current);
    };
    boot().catch(() => {
      if (!cancelled) {
        stopWatcher = startLocalWatcher(uid);
        stopProfile = startPublicPageWatcher(uid, () => displayNameRef.current);
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener("account-sync-changed", onSyncFlag);
      stopWatcher?.();
      stopProfile?.();
    };
  }, [uid]);

  return { ready, uid };
};
