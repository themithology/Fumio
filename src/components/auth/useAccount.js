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

export const useAuth = () => useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
export const useIsSignedIn = () => isRealUser(useAuth().user);
export const useSyncStatus = () => useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);

/** Mount once in App: hydrate on sign-in, then debounce local edits to SQLite. */
export const useAccountSync = () => {
  const { ready, user } = useAuth();
  const uid = isRealUser(user) ? user.uid : "";

  useEffect(() => {
    if (!uid) {
      resetSyncCache();
      return undefined;
    }

    let cancelled = false;
    let stopWatcher = null;
    claimDevice(uid);

    const onSyncFlag = () => {
      if (isSyncEnabled()) pullAndMerge(uid).catch(() => {});
    };
    window.addEventListener("account-sync-changed", onSyncFlag);

    const boot = async () => {
      if (isSyncEnabled()) await pullAndMerge(uid);
      if (cancelled) return;
      stopWatcher = startLocalWatcher(uid);
    };
    boot().catch(() => {
      if (!cancelled) stopWatcher = startLocalWatcher(uid);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("account-sync-changed", onSyncFlag);
      stopWatcher?.();
      // Keep the signed-out browser local-first, but never leave account A's
      // titles in the shared guest bucket for account B to inherit.
      releaseDevice(uid);
      resetSyncCache();
    };
  }, [uid]);

  // `ready` intentionally does not gate the sign-in boot. It is read here so
  // the hook remains subscribed to a confirmed session and can be extended
  // without making a failed auth check look like a signed-out account.
  return { ready, uid };
};
