import { getApp, getApps, initializeApp } from "firebase/app";

// Firebase is used for identity only. My List and Continue Watching never use
// Firestore: the signed-in ID token is sent to Iris's own /api/db Node/SQLite
// service (src/utils/dbApi.js).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ogpb-331d5.firebaseapp.com",
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

/** Load Auth only when the account surface or sync layer needs it. */
export const getFirebaseAuth = async () => {
  if (!app) return null;
  if (!authPromise) {
    authPromise = import("firebase/auth")
      .then(({ getAuth }) => getAuth(app))
      .catch((error) => {
        console.error("Firebase Auth load failed:", error);
        authPromise = null;
        return null;
      });
  }
  return authPromise;
};

export const getFirebaseAuthModule = () => import("firebase/auth");

export const getIdToken = async (forceRefresh = false) => {
  const auth = await getFirebaseAuth();
  if (!auth?.currentUser) return "";
  try {
    return (await auth.currentUser.getIdToken(forceRefresh)) || "";
  } catch {
    return "";
  }
};
