import { getFirebaseAuth, getFirebaseAuthModule, getIdToken as readFirebaseIdToken, isConfigured } from "../firebase.js";

// Optional account session. A visitor who does not sign in keeps using the app
// exactly as before; this store only exposes the current Firebase Auth state.
let state = { ready: false, user: null, initError: "" };
let initPromise = null;
let unsubscribe = null;
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());
const setState = (patch) => {
  state = { ...state, ...patch };
  emit();
};

export const subscribeAuth = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getAuthSnapshot = () => state;
export const isRealUser = (user) => Boolean(user && !user.isAnonymous);

/** Start Firebase's persisted-session listener once. */
export const ensureAuthInit = () => {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!isConfigured) {
      setState({ ready: true, initError: "Firebase Auth is not configured." });
      return null;
    }

    const auth = await getFirebaseAuth();
    if (!auth) {
      setState({ ready: true, initError: "Firebase Auth could not load." });
      return null;
    }

    const mod = await getFirebaseAuthModule();
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      unsubscribe = mod.onAuthStateChanged(
        auth,
        (user) => {
          setState({ ready: true, user: user || null, initError: "" });
          finish();
        },
        (error) => {
          console.warn("Firebase Auth session check failed:", error?.code || error?.message);
          setState({ ready: true, user: null, initError: authErrorMessage(error) });
          finish();
        },
      );
      // A blocked IndexedDB/private-mode session should not hold the app on a
      // spinner forever. The listener will still update the snapshot later.
      setTimeout(finish, 4000);
    });

    try {
      await mod.getRedirectResult(auth);
    } catch (error) {
      setState({ initError: authErrorMessage(error) });
    }
    return auth;
  })().catch((error) => {
    console.warn("Firebase Auth initialization failed:", error?.code || error?.message);
    setState({ ready: true, user: null, initError: authErrorMessage(error) });
    return null;
  });
  return initPromise;
};

// Let the auth callback settle without delaying the first paint.
export const scheduleAuthInit = () => {
  if (typeof window === "undefined") return;
  const start = () => ensureAuthInit().catch(() => {});
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 0);
};

const friendlyMessages = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use a stronger password (at least six characters).",
  "auth/email-already-in-use": "That email already has an account. Sign in instead.",
  "auth/invalid-credential": "The email or password is not correct.",
  "auth/wrong-password": "The email or password is not correct.",
  "auth/user-not-found": "The email or password is not correct.",
  "auth/popup-closed-by-user": "The Google sign-in window was closed.",
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Try again or allow popups.",
  "auth/unauthorized-domain": "This site is not enabled for Firebase sign-in yet.",
  "auth/network-request-failed": "The sign-in service could not be reached. Try again.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
};

export const authErrorMessage = (error) => {
  if (!error) return "Something went wrong. Try again.";
  return friendlyMessages[error.code] || error.message || "Something went wrong. Try again.";
};

const settle = (user) => setState({ ready: true, user: user || null, initError: "" });

const cleanCredentials = (email, password) => ({
  email: String(email || "").trim(),
  password: String(password || ""),
});

export const signUpWithEmail = async (email, password) => {
  const auth = await ensureAuthInit();
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await getFirebaseAuthModule();
  const { email: cleanEmail, password: cleanPassword } = cleanCredentials(email, password);
  const result = await mod.createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
  settle(result.user);
  return result.user;
};

export const signInWithEmail = async (email, password) => {
  const auth = await ensureAuthInit();
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await getFirebaseAuthModule();
  const { email: cleanEmail, password: cleanPassword } = cleanCredentials(email, password);
  const result = await mod.signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
  settle(result.user);
  return result.user;
};

export const resetPassword = async (email) => {
  const auth = await ensureAuthInit();
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await getFirebaseAuthModule();
  await mod.sendPasswordResetEmail(auth, String(email || "").trim());
};

export const signInWithGoogle = async () => {
  const auth = await ensureAuthInit();
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await getFirebaseAuthModule();
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const result = await mod.signInWithPopup(auth, provider);
    settle(result.user);
    return result.user;
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/operation-not-supported-in-this-environment") {
      await mod.signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
};

export const signOutUser = async () => {
  const auth = await ensureAuthInit();
  if (!auth) return false;
  const mod = await getFirebaseAuthModule();
  await mod.signOut(auth);
  settle(null);
  return true;
};

export const getIdToken = (forceRefresh = false) => readFirebaseIdToken(forceRefresh);

export const displayLabel = (user) => {
  if (!user) return "";
  if (user.displayName) return user.displayName;
  if (user.email) return user.email.split("@")[0];
  return "Member";
};

export const displayInitial = (user) => (displayLabel(user) || "M").charAt(0).toUpperCase();

export const disposeAuth = () => {
  unsubscribe?.();
  unsubscribe = null;
  initPromise = null;
  setState({ ready: false, user: null, initError: "" });
};

scheduleAuthInit();
