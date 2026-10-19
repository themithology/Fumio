// Browser half of Iris's member-data layer. Firebase supplies the ID token;
// this module talks only to the site's own Node/SQLite HTTP API. There is no
// Firestore list/history path here.

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getIdToken } from "./auth.js";

export const DB_API_TIMEOUT_MS = 15000;
export const DB_READ_ANSWER_TIMEOUT_MS = 10000;
export const AUTH_UNAVAILABLE_CODE = "auth-unavailable";

// The deployed account service is also the default for the native APK. A
// build-time VITE_ACCOUNT_API_BASE can still override it for staging or a
// different deployment.
const DEFAULT_ACCOUNT_API_BASE = "https://theogpiratebot.online";
const API_BASE = String(import.meta.env.VITE_ACCOUNT_API_BASE || DEFAULT_ACCOUNT_API_BASE).replace(/\/$/, "");
const endpoint = (path) => `${API_BASE}${path}`;

const CODE_BY_STATUS = {
  400: "invalid-argument",
  401: "unauthenticated",
  403: "permission-denied",
  404: "not-found",
  409: "already-exists",
  413: "invalid-argument",
  429: "resource-exhausted",
  503: "unavailable",
};

export class DbApiError extends Error {
  constructor(code, message, status = 0) {
    super(message || code);
    this.name = "DbApiError";
    this.code = code;
    this.status = status;
  }
}

let tokenProvider = null;
export const setTokenProvider = (provider) => {
  tokenProvider = provider;
};

export const currentIdToken = async (forceRefresh = false) => {
  if (tokenProvider) {
    try {
      return (await tokenProvider(forceRefresh)) || "";
    } catch {
      return "";
    }
  }
  return (await getIdToken(forceRefresh)) || "";
};

const parseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

let nativeHttpSeq = 0;
const nativeHttpWaiters = new Map();

if (typeof window !== "undefined") {
  window.addEventListener("fumio-native-http", (event) => {
    const id = event?.detail?.id;
    const waiter = nativeHttpWaiters.get(id);
    if (!waiter) return;
    nativeHttpWaiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(event.detail.result || {});
  });
}

const nativeHttpRequest = (method, url, headers, body, timeoutMs) => {
  const bridge = typeof window !== "undefined" ? window.FumioNative : null;
  if (!bridge?.requestJson) return null;
  return new Promise((resolve, reject) => {
    const id = `db-${Date.now()}-${++nativeHttpSeq}`;
    const timer = setTimeout(() => {
      if (!nativeHttpWaiters.delete(id)) return;
      reject(new DbApiError("timeout", "The database took too long to answer."));
    }, timeoutMs + 2000);
    nativeHttpWaiters.set(id, { resolve, reject, timer });
    try {
      bridge.requestJson(
        method,
        url,
        JSON.stringify(headers || {}),
        body === undefined ? "" : JSON.stringify(body),
        id,
      );
    } catch (error) {
      nativeHttpWaiters.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
};

export const dbFetch = async (
  path,
  { method = "GET", body, auth = false, timeoutMs = DB_API_TIMEOUT_MS } = {},
) => {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    let token = await currentIdToken();
    if (!token) token = await currentIdToken(true);
    if (!token) throw new DbApiError("unauthenticated", "Sign in first.", 401);
    headers.authorization = `Bearer ${token}`;
  }

  const url = endpoint(path);
  let response;
  try {
    // Capacitor's WebView origin is https://localhost, so window.fetch to the
    // site is cross-origin. Iris /api/db does not send CORS headers (the site
    // itself is same-origin). Native HTTP skips that check and still talks to
    // the same SQLite routes.
    const native = await nativeHttpRequest(method, url, headers, body, timeoutMs);
    if (native) {
      const parsed =
        native.data && typeof native.data === "object"
          ? native.data
          : typeof native.data === "string"
            ? (() => {
                try {
                  return JSON.parse(native.data);
                } catch {
                  return null;
                }
              })()
            : native.data;
      response = {
        ok: Boolean(native.ok),
        status: Number(native.status) || 0,
        json: async () => parsed,
      };
    } else if (Capacitor.isNativePlatform()) {
      const result = await CapacitorHttp.request({
        url,
        method,
        headers,
        ...(body !== undefined ? { data: body } : {}),
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      const parsed =
        typeof result.data === "string"
          ? (() => {
              try {
                return JSON.parse(result.data);
              } catch {
                return null;
              }
            })()
          : result.data;
      response = {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => parsed,
      };
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    throw new DbApiError(error?.name === "AbortError" ? "timeout" : "unavailable", error?.message);
  }

  const data = await parseJson(response);
  if (response.ok) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new DbApiError("unavailable", "The database did not return JSON.");
    }
    return data;
  }

  const message = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
  if (response.status === 503 && /sign-in|token|auth/i.test(message)) {
    throw new DbApiError(AUTH_UNAVAILABLE_CODE, message, response.status);
  }
  throw new DbApiError(CODE_BY_STATUS[response.status] || "internal", message, response.status);
};

const handlePath = (handle) => `/api/db/profile/${encodeURIComponent(handle)}`;
const uidPath = (uid) => `/api/db/handle/${encodeURIComponent(uid)}`;
const userPath = (uid) => `/api/db/user/${encodeURIComponent(uid)}`;

export const getProfile = (handle) => dbFetch(handlePath(handle), { timeoutMs: DB_READ_ANSWER_TIMEOUT_MS });
export const searchProfiles = (term, limit = 12) =>
  dbFetch(`/api/db/profiles?q=${encodeURIComponent(String(term ?? ""))}&limit=${encodeURIComponent(limit)}`, {
    timeoutMs: DB_READ_ANSWER_TIMEOUT_MS,
  });
export const putProfile = (handle, profile) =>
  dbFetch(handlePath(handle), { method: "PUT", body: { profile }, auth: true });
export const deleteProfile = (handle) => dbFetch(handlePath(handle), { method: "DELETE", auth: true });
export const getHandle = (uid) => dbFetch(uidPath(uid), { auth: true, timeoutMs: DB_READ_ANSWER_TIMEOUT_MS });
export const putHandle = (uid, handle) => dbFetch(uidPath(uid), { method: "PUT", body: { handle }, auth: true });
export const deleteHandle = (uid) => dbFetch(uidPath(uid), { method: "DELETE", auth: true });
export const getMe = () => dbFetch("/api/db/me", { auth: true, timeoutMs: DB_READ_ANSWER_TIMEOUT_MS });
export const postEvent = (event) => dbFetch("/api/events", { method: "POST", body: event, auth: true });
export const getVersion = () => dbFetch("/api/version", { timeoutMs: DB_READ_ANSWER_TIMEOUT_MS });

export const getUserData = (uid) =>
  dbFetch(userPath(uid), {
    auth: true,
    timeoutMs: DB_READ_ANSWER_TIMEOUT_MS,
  });

export const putUserData = (uid, payload) =>
  dbFetch(userPath(uid), {
    method: "PUT",
    body: payload,
    auth: true,
  });

export const deleteUserData = (uid) =>
  dbFetch(userPath(uid), {
    method: "DELETE",
    auth: true,
  });

export const getHealth = () => dbFetch("/api/db/health", { timeoutMs: DB_READ_ANSWER_TIMEOUT_MS });
