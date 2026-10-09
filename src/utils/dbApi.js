// Browser half of Iris's member-data layer. Firebase supplies the ID token;
// this module talks only to the site's own Node/SQLite HTTP API. There is no
// Firestore list/history path here.

import { getIdToken } from "./auth.js";

export const DB_API_TIMEOUT_MS = 15000;
export const DB_READ_ANSWER_TIMEOUT_MS = 10000;
export const AUTH_UNAVAILABLE_CODE = "auth-unavailable";

const API_BASE = String(import.meta.env.VITE_ACCOUNT_API_BASE || "").replace(/\/$/, "");
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

const currentIdToken = async (forceRefresh = false) => {
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

export const dbFetch = async (
  path,
  { method = "GET", body, auth = false, timeoutMs = DB_API_TIMEOUT_MS } = {},
) => {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = await currentIdToken();
    if (!token) throw new DbApiError("unauthenticated", "Sign in first.", 401);
    headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(endpoint(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    throw new DbApiError(error?.name === "AbortError" ? "timeout" : "unavailable", error?.message);
  } finally {
    clearTimeout(timer);
  }

  const data = await parseJson(response);
  if (response.ok) return data || {};

  const message = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
  if (response.status === 503 && /sign-in|token|auth/i.test(message)) {
    throw new DbApiError(AUTH_UNAVAILABLE_CODE, message, response.status);
  }
  throw new DbApiError(CODE_BY_STATUS[response.status] || "internal", message, response.status);
};

export const getUserData = (uid) =>
  dbFetch(`/api/db/user/${encodeURIComponent(uid)}`, {
    auth: true,
    timeoutMs: DB_READ_ANSWER_TIMEOUT_MS,
  });

export const putUserData = (uid, payload) =>
  dbFetch(`/api/db/user/${encodeURIComponent(uid)}`, {
    method: "PUT",
    body: payload,
    auth: true,
  });

export const deleteUserData = (uid) =>
  dbFetch(`/api/db/user/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    auth: true,
  });

export const getHealth = () => dbFetch("/api/db/health", { timeoutMs: DB_READ_ANSWER_TIMEOUT_MS });
