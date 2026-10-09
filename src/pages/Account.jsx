import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import AuthForm from "../components/auth/AuthForm.jsx";
import { useAuth, useSyncStatus } from "../components/auth/useAccount.js";
import {
  displayInitial,
  displayLabel,
  isRealUser,
  signOutUser,
} from "../utils/auth.js";
import {
  isSyncEnabled,
  pullAndMerge,
  setSyncEnabled,
} from "../utils/accountSync.js";
import { readMyList } from "../utils/myList.js";
import { readContinueWatching } from "../utils/watchHistory.js";

const statusCopy = {
  off: "Local only",
  idle: "Ready to sync",
  syncing: "Syncing…",
  synced: "Synced",
  error: "Sync needs attention",
};

export default function Account() {
  const { ready, user, initError } = useAuth();
  const sync = useSyncStatus();
  const [enabled, setEnabled] = useState(() => isSyncEnabled());
  const [counts, setCounts] = useState(() => ({ myList: readMyList().length, history: readContinueWatching().length }));
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = isRealUser(user);

  useEffect(() => {
    document.title = "Account | TheOGPirateBot";
    const refresh = () => setCounts({ myList: readMyList().length, history: readContinueWatching().length });
    window.addEventListener("mylist-updated", refresh);
    window.addEventListener("history-updated", refresh);
    return () => {
      window.removeEventListener("mylist-updated", refresh);
      window.removeEventListener("history-updated", refresh);
    };
  }, []);

  const toggleSync = () => {
    const next = !enabled;
    setEnabled(next);
    setSyncEnabled(next);
  };

  const retry = () => {
    if (user?.uid) pullAndMerge(user.uid).catch(() => {});
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutUser();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--gtv-bg)] text-[var(--gtv-text)]">
      <Topnav />
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-28 pt-10 sm:px-8 sm:pt-16">
        {!ready ? (
          <div className="flex min-h-[360px] items-center text-sm text-zinc-500">Checking account session…</div>
        ) : !signedIn ? (
          <>
            {initError && <p className="mb-4 w-full max-w-md rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{initError}</p>}
            <AuthForm />
          </>
        ) : (
          <div className="w-full max-w-2xl">
            <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">TheOGPirateBot account</p>
                <h1 className="font-editorial text-4xl font-bold text-white">Your library, everywhere.</h1>
                <p className="mt-2 text-sm text-zinc-400">Signed in as {displayLabel(user)}{user.email ? ` · ${user.email}` : ""}</p>
              </div>
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-xl font-black text-black" aria-hidden="true">
                {displayInitial(user)}
              </div>
            </div>

            {initError && <p className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{initError}</p>}

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-7">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Cloud library sync</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
                    My List and Continue Watching stay local-first, then sync to the account database. Existing local and cloud titles are merged; neither side silently replaces the other.
                  </p>
                </div>
                <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${sync.state === "error" ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : sync.state === "synced" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-black/20 text-zinc-300"}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {statusCopy[sync.state] || "Local only"}
                </span>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <p className="text-2xl font-black text-white">{counts.myList}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-500">My List titles</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <p className="text-2xl font-black text-white">{counts.history}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-500">Continue Watching</p>
                </div>
              </div>

              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/8 bg-black/20 p-4">
                <input type="checkbox" checked={enabled} onChange={toggleSync} className="mt-1 h-4 w-4 accent-white" />
                <span>
                  <span className="block text-sm font-bold text-white">Sync this account on this device</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">Turn this off to keep browsing and playback entirely local. Your existing cloud copy is not deleted.</span>
                </span>
              </label>

              {sync.message && <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-100">{sync.message}</p>}
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={retry} disabled={sync.state === "syncing" || !enabled} className="min-h-10 rounded-full bg-white px-4 text-xs font-extrabold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50">
                  {sync.state === "syncing" ? "Syncing…" : "Sync now"}
                </button>
                <Link to="/" className="inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 text-xs font-bold text-white hover:bg-white/10">Back to browsing</Link>
              </div>
            </section>

            <button type="button" onClick={signOut} disabled={signingOut} className="mt-6 min-h-11 w-full rounded-2xl border border-red-300/20 bg-red-300/5 px-4 text-sm font-bold text-red-100 transition hover:bg-red-300/10 disabled:opacity-50">
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
