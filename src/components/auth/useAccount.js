import { useEffect, useSyncExternalStore } from "react";
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
  const displayName = user?.displayName || "";

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
      if (isSyncEnabled()) await pullAndMerge(uid);
      if (cancelled) return;
      stopWatcher = startLocalWatcher(uid);
      stopProfile = startPublicPageWatcher(uid, () => displayName);
    };
    boot().catch(() => {
      if (!cancelled) {
        stopWatcher = startLocalWatcher(uid);
        stopProfile = startPublicPageWatcher(uid, () => displayName);
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener("account-sync-changed", onSyncFlag);
      stopWatcher?.();
      stopProfile?.();
      // Keep the signed-out browser local-first, but never leave account A's
      // titles in the shared guest bucket for account B to inherit.
      releaseDevice(uid);
      resetSyncCache();
    };
  }, [uid, displayName]);

  return { ready, uid };
};
