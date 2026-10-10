import { getApp, getApps, initializeApp } from "firebase/app";
import {
  FALLBACK_AUTH_DOMAIN,
  normaliseDomain,
  resolveAuthDomain,
} from "./config/authDomain.js";

// Firebase is used for identity only. My List and Continue Watching never use
// Firestore: the signed-in ID token is sent to Iris's own /api/db Node/SQLite
// service (src/utils/dbApi.js).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI",
  // Google one-tap must load Firebase Hosting's helper
  // (https://ogpb-331d5.firebaseapp.com/__/auth/handler), not the site SPA.
  authDomain:
    normaliseDomain(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) || FALLBACK_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ogpb-331d5",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ogpb-331d5.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "352929408479",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:352929408479:web:20fd9158e4a414f77f906a",
};

export const isConfigured = Boolean(firebaseConfig.projectId && firebaseConfig.appId);

let app = null;
if (isConfigured) {
  try {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  } catch (error) {
    console.error("Firebase init failed:", error);
  }
}

export { app };

let authPromise = null;
let authInstance = null;
let authModule = null;
let authDomainReady = null;

const applyAuthDomain = (domain) => {
  const target = normaliseDomain(domain);
  if (!target) return;
  try {
    if (app?.options) app.options.authDomain = target;
  } catch {
    /* options may be frozen */
  }
  try {
    if (authInstance?.config) authInstance.config.authDomain = target;
  } catch {
    /* auth not ready yet */
  }
};

/** Probe theogpiratebot.online/__/auth/handler like Iris, else firebaseapp.com. */
export const ensureAuthDomainReady = () => {
  if (!authDomainReady) {
    authDomainReady = resolveAuthDomain({ env: import.meta.env })
      .then((domain) => {
        applyAuthDomain(domain);
        return domain;
      })
      .catch(() => {
        applyAuthDomain(FALLBACK_AUTH_DOMAIN);
        return FALLBACK_AUTH_DOMAIN;
      });
  }
  return authDomainReady;
};

if (isConfigured) ensureAuthDomainReady();

const cacheAuth = async () => {
  const mod = await import("firebase/auth");
  authModule = mod;
  authInstance = mod.getAuth(app);
  const domain = await ensureAuthDomainReady().catch(() => FALLBACK_AUTH_DOMAIN);
  applyAuthDomain(domain);
  return authInstance;
};

/** Load Auth only when the account surface or sync layer needs it. */
export const getFirebaseAuth = async () => {
  if (!app) return null;
  if (authInstance) return authInstance;
  if (!authPromise) {
    authPromise = cacheAuth().catch((error) => {
      console.error("Firebase Auth load failed:", error);
      authPromise = null;
      authInstance = null;
      authModule = null;
      return null;
    });
  }
  return authPromise;
};

export const getFirebaseAuthModule = async () => {
  if (authModule) return authModule;
  await getFirebaseAuth();
  if (authModule) return authModule;
  return import("firebase/auth");
};

/** Synchronous handles so Google sign-in can call window.open in the same click. */
export const getFirebaseAuthSync = () => authInstance;
export const getFirebaseAuthModuleSync = () => authModule;

export const getIdToken = async (forceRefresh = false) => {
  const auth = await getFirebaseAuth();
  if (!auth?.currentUser) return "";
  try {
    return (await auth.currentUser.getIdToken(forceRefresh)) || "";
  } catch {
    return "";
  }
};
