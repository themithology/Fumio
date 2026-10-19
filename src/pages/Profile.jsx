// ─── Profile.jsx — /u/:handle, a member's public page ───────────────────────
// Public by design: no sign-in, no account, works for anyone with the link.
// That is the point of the feature (publicity — a member shares their page and
// their followers find the site), so this page must never ask for anything.
//
// What it shows is exactly what profiles.js published and nothing else: a
// display name, the titles on their My List, and the last title they watched.
// There is no email, no uid, no history, and no "sign in to see more" — the
// document the page reads simply does not contain those fields.
//
// Unknown handle, revoked profile and unreachable server all land on the same
// calm explanation with a way back into the site: a dead link from a shared
// post should still sell the site.

import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import { loadProfile, normalizeHandle, HANDLE_PATTERN } from "../utils/profiles.js";
import { coverById } from "../utils/catalog.js";

const applySeo = ({ title }) => {
  if (title) document.title = title;
};

const Shell = ({ children }) => (
  <div className="flex min-h-screen w-full flex-col bg-[var(--gtv-bg)] text-[var(--gtv-text)] animate-fade-in pb-28 sm:pb-24">
    <Topnav />
    <div className="flex flex-grow flex-col gap-6 px-4 py-6 sm:px-8 md:px-12 lg:px-16 xl:px-20">
      {children}
    </div>
    <Footer />
  </div>
);

const EmptyState = ({ title, body }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-5 py-24 text-center">
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
      <i className="ri-user-search-line text-3xl text-zinc-400" />
    </span>
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-bold text-white sm:text-xl">{title}</h2>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-500 sm:text-sm">{body}</p>
    </div>
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black transition hover:bg-zinc-200 active:scale-95 sm:text-sm"
    >
      <i className="ri-home-4-line" /> Browse something
    </Link>
  </div>
);

const Profile = () => {
  const { handle: rawHandle } = useParams();
  const handle = normalizeHandle(rawHandle);
  const valid = HANDLE_PATTERN.test(handle);

  // "loading" | "ready" | "missing" | "invalid" | "blocked" | "offline" | "unavailable" | "error"
  const [state, setState] = useState(valid ? "loading" : "invalid");
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!valid) {
      setState("invalid");
      setProfile(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    // /u/:handle is noindex (src/utils/seoRoutes.js) — title only.
    applySeo({ title: `@${handle} — TheOGPirateBot` });

    loadProfile(handle)
      .then(({ state: next, profile: data }) => {
        if (cancelled) return;
        setProfile(data);
        setState(next);
        if (data?.displayName) applySeo({ title: `${data.displayName} (@${handle}) — TheOGPirateBot` });
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [handle, valid]);

  if (state === "loading") {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center py-24">
          <span className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
            <i className="ri-loader-4-line animate-spin text-lg" /> Loading profile
          </span>
        </div>
      </Shell>
    );
  }

  if (state !== "ready" || !profile) {
    // The reason decides the message. A member's page that cannot be READ must
    // never be reported as a page that does not EXIST — that is the difference
    // between a dead link and a deployment nobody has finished.
    const copy = {
      invalid: {
        title: "That link doesn't look like a profile",
        body: "Profile links look like /u/name — letters, numbers, dashes and underscores.",
      },
      blocked: {
        title: "Profiles can't be read right now",
        body: "The site could not read from its database — so this is a problem at our end, not a missing profile. The rest of the site works normally.",
      },
      offline: {
        title: "Couldn't reach the server",
        body: "Check your connection and try again — this page needs one request to load.",
      },
      timeout: {
        title: "The database didn't answer",
        body: "The request timed out with no reply. On this site that almost always means the project's Firestore rules have not been published, or the database was never created — a problem at our end, not a missing profile.",
      },
      unavailable: {
        title: "Profiles aren't available on this build",
        body: "This deployment has no database configuration, so no profile pages can load here.",
      },
      error: {
        title: "Something went wrong loading this profile",
        body: "That is on our side. Try again in a moment — the rest of the site is unaffected.",
      },
      missing: {
        title: "No profile here",
        body: `Nothing is published at @${handle || "that handle"} — the link may be old, or the member turned their profile off.`,
      },
    }[state] || { title: "No profile here", body: "Nothing is published at that address." };
    return (
      <Shell>
        <EmptyState title={copy.title} body={copy.body} />
      </Shell>
    );
  }

  const items = (Array.isArray(profile.list) ? profile.list : []).map((item) => ({
    ...item,
    media_type: item.type,
    release_date: item.year ? `${item.year}-01-01` : null,
  }));
  const watching = profile.watching;
  const cover = coverById(profile.cover);

  return (
    <Shell>
      {/* The member's cover (2026-09-27): one of the catalog's gradients, stored
          as an id, so this is a CSS background — no image request, nothing that
          can fail to load. */}
      {cover && (
        <div
          className="-mt-1 h-32 w-full overflow-hidden rounded-2xl border border-white/10 sm:h-44"
          style={{ backgroundImage: cover.css }}
        />
      )}

      <header className="flex flex-col gap-3 border-b border-white/5 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-white/10"
            />
          ) : (
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 font-display text-2xl font-black text-black"
              style={
                profile.accent
                  ? { backgroundImage: `linear-gradient(135deg, ${profile.accent}, ${profile.accent}bb)` }
                  : undefined
              }
            >
              {(profile.displayName || handle).charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-black text-white sm:text-2xl">
              {profile.displayName || handle}
            </h1>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-500">@{handle}</p>
            {profile.bio && (
              <p
                className="mt-1 max-w-md text-[12px] leading-relaxed text-zinc-400"
                style={profile.accent ? { color: profile.accent } : undefined}
              >
                {profile.bio}
              </p>
            )}
          </div>
        </div>

        {watching && (
          <p className="flex items-center gap-2 text-[11px] font-semibold text-zinc-400 sm:text-xs">
            <i className="ri-play-circle-fill text-base text-emerald-400" />
            <span className="truncate">
              Watching <span className="text-white">{watching.title}</span>
              {watching.season ? ` · S${watching.season}E${watching.episode ?? 1}` : ""}
            </span>
          </p>
        )}
      </header>

      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg font-bold text-white">
          {profile.displayName || handle}&apos;s list
        </h2>
        {items.length > 0 && (
          <span className="rounded-md border border-white/5 bg-zinc-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {items.length}
          </span>
        )}
      </div>

      {items.length > 0 ? (
        <HorizontalCards data={items} grid stagger />
      ) : (
        <EmptyState
          title="Nothing on the list yet"
          body="This member made their profile public but hasn't added anything to their list — check back later."
        />
      )}

      {/* The one thing a public page is allowed to sell: the site itself. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          This list is public because its owner chose to publish it. Want one? Open{" "}
          <span className="font-mono text-zinc-300">/account</span>.
        </p>
        <Link
          to="/"
          className="shrink-0 rounded-full bg-white px-4 py-2 text-[11px] font-black text-black transition hover:bg-zinc-200 active:scale-95"
        >
          Browse TheOGPirateBot
        </Link>
      </div>
    </Shell>
  );
};

export default Profile;
