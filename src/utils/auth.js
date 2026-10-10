import {
  ensureAuthDomainReady,
  getFirebaseAuth,
  getFirebaseAuthModule,
  getFirebaseAuthModuleSync,
  getFirebaseAuthSync,
  getIdToken as readFirebaseIdToken,
  isConfigured,
} from "../firebase.js";

// Optional account session. A visitor who does not sign in keeps using the app
// exactly as before; this store only exposes the current Firebase Auth state.
let state = { ready: false, user: null, initError: "" };
let initPromise = null;
let unsubscribe = null;
const listeners = new Set();
const AUTH_OPERATION_TIMEOUT_MS = 15000;

const authTimeout = (operation) => {
  const error = new Error(`${operation} timed out. Check your connection and Firebase Auth setup.`);
  error.code = "auth/timeout";
  return error;
};

const withAuthTimeout = (promise, operation) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(authTimeout(operation)), AUTH_OPERATION_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

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

const isNativeApp = () => typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
const isEmbeddedFrame = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

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
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow popups, or open Sign in in a new tab.",
  "auth/unauthorized-domain": "This site is not enabled for Firebase sign-in yet.",
  "auth/network-request-failed": "The sign-in service could not be reached. Try again.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Console yet.",
  "auth/configuration-not-found": "Firebase Auth is not configured for this app yet.",
  "auth/api-key-not-valid": "The Firebase web configuration is not valid for this app.",
  "auth/timeout": "Firebase Auth did not respond. Check the connection, authorized domain, and enabled sign-in provider.",
  "auth/operation-not-supported-in-this-environment": "Google sign-in is not available in this window. Open Sign in in a new tab.",
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
  const auth = await withAuthTimeout(ensureAuthInit(), "Account setup");
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await withAuthTimeout(getFirebaseAuthModule(), "Firebase Auth loading");
  const { email: cleanEmail, password: cleanPassword } = cleanCredentials(email, password);
  const result = await withAuthTimeout(
    mod.createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword),
    "Account creation",
  );
  settle(result.user);
  return result.user;
};

export const signInWithEmail = async (email, password) => {
  const auth = await withAuthTimeout(ensureAuthInit(), "Account setup");
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await withAuthTimeout(getFirebaseAuthModule(), "Firebase Auth loading");
  const { email: cleanEmail, password: cleanPassword } = cleanCredentials(email, password);
  const result = await withAuthTimeout(
    mod.signInWithEmailAndPassword(auth, cleanEmail, cleanPassword),
    "Email sign-in",
  );
  settle(result.user);
  return result.user;
};

export const resetPassword = async (email) => {
  const auth = await withAuthTimeout(ensureAuthInit(), "Account setup");
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await withAuthTimeout(getFirebaseAuthModule(), "Firebase Auth loading");
  await withAuthTimeout(
    mod.sendPasswordResetEmail(auth, String(email || "").trim()),
    "Password reset",
  );
};

const popupBlocked = (error) =>
  error?.code === "auth/popup-blocked" || error?.code === "auth/operation-not-supported-in-this-environment";

let lastGoogleIdToken = "";

const startGooglePopup = (auth, mod) => {
  const provider = new mod.GoogleAuthProvider();
  // Iris: no forced prompt so a returning Google account is one tap.
  return mod.signInWithPopup(auth, provider).then((result) => {
    const credential = mod.GoogleAuthProvider.credentialFromResult(result);
    lastGoogleIdToken = credential?.idToken || "";
    settle(result.user);
    return result.user;
  });
};

export const consumeGoogleIdToken = () => {
  const token = lastGoogleIdToken;
  lastGoogleIdToken = "";
  return token;
};

export const signInWithGoogleIdToken = async (idToken) => {
  const token = String(idToken || "").trim();
  if (!token) throw new Error("Missing Google sign-in token.");
  const auth = await ensureAuthInit();
  if (!auth) throw new Error("Firebase Auth is unavailable.");
  const mod = await getFirebaseAuthModule();
  const result = await mod.signInWithCredential(auth, mod.GoogleAuthProvider.credential(token));
  settle(result.user);
  return result.user;
};

const fallbackGoogleSignIn = async (auth, mod, error) => {
  if (!popupBlocked(error)) throw error;
  // Redirect inside an iframe or Capacitor WebView is swallowed (X-Frame-Options
  // or the app's own external-navigation guard). Surface a real error instead.
  if (isEmbeddedFrame() || isNativeApp()) {
    const blocked = new Error(friendlyMessages["auth/popup-blocked"]);
    blocked.code = "auth/popup-blocked";
    throw blocked;
  }
  await mod.signInWithRedirect(auth, providerFrom(mod));
  return null;
};

const providerFrom = (mod) => {
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
};

export const signInWithGoogle = () => {
  const applyDomain = async (auth) => {
    try {
      const domain = await ensureAuthDomainReady();
      if (domain && auth?.config) auth.config.authDomain = domain;
    } catch {
      /* keep the SDK default */
    }
    return auth;
  };

  const auth = getFirebaseAuthSync();
  const mod = getFirebaseAuthModuleSync();
  if (auth && mod) {
    return applyDomain(auth)
      .then(() => startGooglePopup(auth, mod))
      .catch((error) => fallbackGoogleSignIn(auth, mod, error));
  }

  return (async () => {
    const loadedAuth = await ensureAuthInit();
    if (!loadedAuth) throw new Error("Firebase Auth is unavailable.");
    const loadedMod = await getFirebaseAuthModule();
    await applyDomain(loadedAuth);
    try {
      return await startGooglePopup(loadedAuth, loadedMod);
    } catch (error) {
      return fallbackGoogleSignIn(loadedAuth, loadedMod, error);
    }
  })();
};

export const signOutUser = async () => {
  const auth = await withAuthTimeout(ensureAuthInit(), "Account setup");
  if (!auth) return false;
  const mod = await withAuthTimeout(getFirebaseAuthModule(), "Firebase Auth loading");
  await withAuthTimeout(mod.signOut(auth), "Sign out");
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

export const DISPLAY_NAME_MAX = 40;

export const normalizeDisplayName = (raw) =>
  String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX);

export const displayNameError = (raw) => {
  const name = normalizeDisplayName(raw);
  if (!name) return "Type a name first.";
  if (String(raw ?? "").replace(/\s+/g, " ").trim().length > DISPLAY_NAME_MAX)
    return `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.`;
  return "";
};

export const updateDisplayName = async (raw) => {
  const name = normalizeDisplayName(raw);
  const problem = displayNameError(raw);
  if (problem) return { ok: false, message: problem };

  const auth = await ensureAuthInit();
  const user = auth?.currentUser;
  if (!isRealUser(user)) {
    return { ok: false, message: "Sign in first — a guest name is not saved anywhere." };
  }
  if (user.displayName === name) return { ok: true, name, unchanged: true };

  try {
    const mod = await getFirebaseAuthModule();
    await mod.updateProfile(user, { displayName: name });
    settle(auth.currentUser);
    return { ok: true, name };
  } catch (err) {
    return { ok: false, message: authErrorMessage(err) };
  }
};

export const deleteAccount = async () => {
  const auth = await ensureAuthInit();
  const user = auth?.currentUser;
  if (!user || user.isAnonymous) return false;
  const { deleteCloudData } = await import("./accountSync.js");
  await deleteCloudData(user.uid).catch(() => {});
  await user.delete();
  settle(null);
  return true;
};

export const disposeAuth = () => {
  unsubscribe?.();
  unsubscribe = null;
  initPromise = null;
  setState({ ready: false, user: null, initError: "" });
};

scheduleAuthInit();

if (typeof window !== "undefined") {
  window.addEventListener("fumio-native-auth", (event) => {
    const token = event?.detail?.idToken;
    if (!token) return;
    signInWithGoogleIdToken(token)
      .then(() => {
        window.dispatchEvent(new CustomEvent("fumio-native-auth-done"));
      })
      .catch((error) => {
        window.dispatchEvent(
          new CustomEvent("fumio-native-auth-error", {
            detail: { message: authErrorMessage(error) },
          }),
        );
      });
  });
}
