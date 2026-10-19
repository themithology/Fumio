import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import Footer from "../components/Footer.jsx";
import { safeBack } from "../utils/goBack.js";
import { isRealUser, signOutUser, deleteAccount, authErrorMessage, displayLabel, displayInitial, scheduleAuthInit, updateDisplayName, displayNameError, normalizeDisplayName, DISPLAY_NAME_MAX } from "../utils/auth.js";
import AuthForm from "../components/auth/AuthForm.jsx";
import UsernameStep from "../components/account/UsernameStep.jsx";
import LookEditor from "../components/account/LookEditor.jsx";
import ProfileHead from "../components/account/ProfileHead.jsx";
import { hasLook, readLook } from "../utils/profileLook.js";
import VisibilityToggle from "../components/account/VisibilityToggle.jsx";
import {
  isSyncEnabled,
  setSyncEnabled,
  pushCloudData,
  deleteCloudData,
  pullAndMerge,
  readHistory,
} from "../utils/accountSync.js";
import { readMyList } from "../utils/myList.js";
import { useAuth, useSyncStatus } from "../components/auth/useAccount.js";
import {
  publishProfile,
  unpublishProfile,
  releaseHandle,
  fetchProfile,
  fetchMyHandle,
  readLocalHandle,
  markPagePublic,
  republishIfPublic,
  profileUrl,
  droppedFieldsMessage,
  PROFILE_WARNING_EVENT,
} from "../utils/profiles.js";

// ─── /account — optional member settings ────────────────────────────────────
// Deliberately thin: identity, the cloud-sync switch, and the two ways to walk
// away (delete the cloud copy, or sign out). There is no profile to build and
// no wall — signed-out visitors get the same page with a one-line explanation
// that nothing here is required.

// The account page is five short screens, not one long column (owner,
// 2026-09-27: "everything in one page"). The rail is horizontal on a phone and
// a sticky column on a laptop; the panels below reuse the blocks that were
// already there, so nothing about the behaviour changed — only where it lives.
const TABS = [
  { id: "profile", icon: "ri-user-3-line", label: "Profile" },
  { id: "look", icon: "ri-palette-line", label: "Your look" },
  { id: "page", icon: "ri-global-line", label: "Your page" },
  { id: "sync", icon: "ri-cloud-line", label: "Cloud sync" },
  { id: "account", icon: "ri-shield-user-line", label: "Sign-in & data" },
];

const PROVIDER_LABEL = {
  password: "Email & password",
  "google.com": "Google",
  anonymous: "Guest",
};

const Row = ({ icon, label, hint, children }) => (
  <div className="flex items-center justify-between gap-4 border-b border-white/5 px-4 py-4 last:border-0">
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-sm font-bold text-white">
        <i className={`${icon} text-base text-zinc-400`} /> {label}
      </p>
      {hint && <p className="mt-1 pl-7 text-[11px] leading-relaxed text-zinc-500">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

// /account is noindex + titled by the route table (src/utils/seoRoutes.js).
const Account = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  // ⚠️ The single most important line on this page. `user` is truthy for EVERY
  // visitor: src/firebase.js signs guests in anonymously so they can write
  // analytics events. Branching on `!user` therefore never took the guest path
  // — everyone, signed in or not, got the member panel ("Member", no email,
  // cloud-sync controls, Delete account). The page must branch on whether this
  // is a REAL account, which is exactly what isRealUser means.
  const signedIn = isRealUser(user);
  const sync = useSyncStatus();
  const [syncOn, setSyncOn] = useState(isSyncEnabled);
  const [busy, setBusy] = useState("");
  // Two-step delete: armed on the first tap, executed on the second.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState("");
  const [danger, setDanger] = useState("");
  const [counts, setCounts] = useState({ list: 0, history: 0 });
  // Which of the five panels is open, and the live look, which the preview at
  // the top of the page reads (the look editor reports every change through
  // onChanged, so the preview and the public page never disagree).
  const [tab, setTab] = useState("profile");
  const [look, setLook] = useState(readLook);
  // Bumped when this browser changes hands between accounts (utils/deviceAccount.js):
  // everything read from storage at mount is re-read, so account B never sees
  // A's picture or username for even a moment.
  const [deviceEpoch, setDeviceEpoch] = useState(0);
  useEffect(() => {
    const onDevice = () => {
      setLook(readLook());
      setDeviceEpoch((n) => n + 1);
    };
    window.addEventListener("device-account-changed", onDevice);
    window.addEventListener("profile-look-synced", onDevice);
    return () => {
      window.removeEventListener("device-account-changed", onDevice);
      window.removeEventListener("profile-look-synced", onDevice);
    };
  }, []);
  // Public profile (/u/handle) — optional, off until the member claims a
  // handle AND leaves it published.
  const [profileHandle, setProfileHandle] = useState(readLocalHandle);
  // "Not now" on the username step: remembered for this visit only, never
  // nagged again — the profile card offers the same thing in one tap.
  const [skippedUsername, setSkippedUsername] = useState(false);
  const [published, setPublished] = useState(false);
  const [profileBusy, setProfileBusy] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");
  // The display name is editable (2026-09-26). Before this, the only name a
  // member could ever have was the one Google handed over — see the note in
  // utils/auth.js updateDisplayName().
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState("");

  // What the public page shows as the member's name. Google accounts bring a
  // name; email sign-ups usually have none, so profiles.js falls back to the
  // handle. The email address is never used here. Defined ABOVE the effects
  // that list it as a dependency — a dep array is evaluated during render, so
  // a later declaration would throw before the effect ever ran.
  const displayName = (user?.displayName || "").trim();

  useEffect(() => {
    scheduleAuthInit();
    const reload = () => setCounts({ list: readMyList().length, history: readHistory().length });
    reload();
    window.addEventListener("mylist-updated", reload);
    window.addEventListener("history-updated", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("mylist-updated", reload);
      window.removeEventListener("history-updated", reload);
      window.removeEventListener("storage", reload);
    };
  }, [user]);

  // Which handle is mine (pointer document, or the local copy while offline)
  // and whether the page is currently published.
  useEffect(() => {
    let cancelled = false;
    if (!signedIn) {
      setProfileHandle("");
      setPublished(false);
      return undefined;
    }
    fetchMyHandle(user.uid)
      .then(async (handle) => {
        if (cancelled || !handle) return;
        setProfileHandle(handle);
        const live = await fetchProfile(handle);
        if (cancelled) return;
        setPublished(Boolean(live));
        // A page published before this browser kept the "public" note: note it
        // now, so the app-wide republisher follows it from here on.
        if (live) {
          markPagePublic(user.uid, handle);
          // …and bring it up to date now, not at the next list change.
          republishIfPublic(user.uid, displayName).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn, user, deviceEpoch, displayName]);

  // Republishing on list changes is APP-WIDE now (useAccountSync →
  // startPublicPageWatcher), so the page follows My List from every page of the
  // site, not only while this one is open.

  // A republish that came back with a field missing says so here, in words, with
  // the fix in them — the alternative is a member tapping a picture, seeing it
  // save, and never learning why their page ignored it.
  useEffect(() => {
    const onWarning = (event) => setProfileError(String(event?.detail || droppedFieldsMessage(["change"])));
    window.addEventListener(PROFILE_WARNING_EVENT, onWarning);
    return () => window.removeEventListener(PROFILE_WARNING_EVENT, onWarning);
  }, []);

  const provider = user?.providerData?.[0]?.providerId || "";
  const joined = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  // Save the edited display name. Two writes matter: the auth record itself, and
  // — when the page is public — the published copy, so a shared link shows the
  // new name now rather than at the next list change.
  const saveDisplayName = async () => {
    const problem = displayNameError(nameDraft);
    if (problem) {
      setNameError(problem);
      return;
    }
    setNameBusy(true);
    setNameError("");
    setNameSaved("");
    const result = await updateDisplayName(nameDraft);
    if (!result.ok) {
      setNameError(result.message);
      setNameBusy(false);
      return;
    }
    if (published && profileHandle) {
      const live = await publishProfile(user.uid, profileHandle, result.name);
      if (!live.ok) setProfileError(live.message);
    }
    setNameBusy(false);
    setEditingName(false);
    setNameSaved(result.unchanged ? "That was already your name." : "Name saved.");
  };

  // Starts EMPTY when the account has no name of its own (an email sign-up):
  // the placeholder the heading shows is the email prefix, and quietly
  // publishing a piece of somebody's address as their name is not a favour.
  const startEditingName = () => {
    setNameDraft(user?.displayName || "");
    setNameError("");
    setNameSaved("");
    setEditingName(true);
  };

  return (
    <div className="w-full min-h-screen bg-[var(--gtv-bg)] flex flex-col select-none animate-fade-in pb-28 sm:pb-24">
      <Topnav />

      <div className="flex-grow flex flex-col gap-6 px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 py-6">
        <div className="w-full flex items-center gap-3 border-b border-white/5 pb-4">
          <button
            onClick={() => safeBack(navigate, "/")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 border border-white/5 hover:bg-white/10 text-xl text-zinc-400 transition"
            aria-label="Go Back"
          >
            <i className="ri-arrow-left-line" />
          </button>
          <h1 className="section-rule font-display text-2xl font-bold text-white">Account</h1>
        </div>

        {!signedIn ? (
          /* Guest state — same language as the sign-in modal (2026-09-25): a
             value rail on the left, the actions on the right, instead of one
             centred blob of text with a button under it. The reassurance stays
             the headline: nothing on the site is gated. */
          <div className="mx-auto grid w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#08080a] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="flex flex-col justify-between gap-6 border-b border-white/5 bg-gradient-to-b from-white/[0.05] to-transparent p-7 sm:border-b-0 sm:border-r">
              <div className="flex items-center gap-3">
                <img src="/logo.svg" alt="" className="h-9 w-9 rounded-xl" />
                <span className="font-display text-sm font-black tracking-tight text-white">
                  TheOGPirateBot
                </span>
              </div>
              <div>
                <h2 className="font-display text-xl font-black leading-tight text-white">
                  You&apos;re browsing as a guest
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                  That&apos;s the default, and nothing is missing. An account does
                  exactly two things:
                </p>
              </div>
              <ul className="flex flex-col gap-3">
                <li className="flex items-center gap-3 text-[12px] text-zinc-400">
                  <i className="ri-bookmark-3-line text-base text-zinc-300" />
                  My List follows you to your other devices
                </li>
                <li className="flex items-center gap-3 text-[12px] text-zinc-400">
                  <i className="ri-history-line text-base text-zinc-300" />
                  Continue Watching picks up where you stopped
                </li>
                <li className="flex items-center gap-3 text-[12px] text-zinc-400">
                  <i className="ri-global-line text-base text-zinc-300" />
                  Optionally publish a public profile page
                </li>
              </ul>
            </div>

            {/* The sign-in / create-account form, IN PLACE — no modal, no second
                page to dismiss (owner, 2026-09-25: "Remove the first page (sign
                in sign up) directly the second page please"). A successful
                sign-in replaces this whole card with the member panel, because
                this page is subscribed to the auth store. */}
            <AuthForm />

          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
            <ProfileHead
              displayName={displayName}
              handle={profileHandle}
              published={published}
              look={look}
              onEditLook={() => setTab("look")}
            />

            {(notice || danger || (sync.state === "error" && sync.message)) && (
              <div className="flex flex-col gap-2">
              {danger && (
                <p className="px-4 py-3 text-[11px] font-semibold text-red-300">{danger}</p>
              )}
              {notice && (
                <p className="px-4 py-3 text-[11px] font-semibold text-zinc-400">{notice}</p>
              )}
              {sync.state === "error" && sync.message && (
                <p className="px-4 pb-3 text-[11px] font-semibold text-red-300">{sync.message}</p>
              )}
              </div>
            )}

            <div className="grid items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
              <nav
                aria-label="Account sections"
                className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-[calc(var(--domain-banner-h,0px)+68px)] lg:flex-col lg:overflow-visible lg:pb-0"
              >
                {TABS.map((item) => {
                  const active = tab === item.id;
                  const dot =
                    (item.id === "look" && hasLook(look)) ||
                    (item.id === "page" && published) ||
                    (item.id === "sync" && syncOn);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => setTab(item.id)}
                      className={`flex min-h-[42px] shrink-0 items-center gap-2 rounded-full border px-3.5 text-[12px] font-bold transition lg:w-full lg:rounded-xl ${
                        active
                          ? "border-white/15 bg-white text-black"
                          : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                      }`}
                    >
                      <i className={`${item.icon} text-base ${active ? "text-black" : "text-zinc-400"}`} />
                      <span className="whitespace-nowrap lg:flex-1 lg:text-left">{item.label}</span>
                      {item.id === "page" && !published && (
                        <i className="ri-lock-2-line hidden text-sm text-zinc-500 lg:inline" />
                      )}
                      {dot && (
                        <span
                          className={`hidden h-1.5 w-1.5 rounded-full lg:inline-block ${
                            active ? "bg-black/60" : "bg-emerald-400"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="flex min-w-0 flex-col gap-4">
                {tab === "profile" && (
                  <>
            {/* Identity — and the name, which is editable (2026-09-26). */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-xl font-black text-black">
                  {look.avatar || user?.photoURL ? (
                    <img src={look.avatar || user.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    displayInitial(user)
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold text-white">
                    {displayLabel(user)}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {user.email || displayLabel(user)} · {PROVIDER_LABEL[provider] || "Signed in"}
                  </p>
                  {joined && <p className="mt-0.5 text-[11px] text-zinc-600">Member since {joined}</p>}
                </div>
              </div>

              <div className="mt-4 border-t border-white/5 pt-3.5">
                {!editingName ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                        Display name
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                        {published
                          ? "The name on your public page. Anyone with the link reads it."
                          : "Shown on your page if you ever publish it. Your email is never used."}
                      </p>
                      {nameSaved && (
                        <p className="mt-1 text-[11px] font-semibold text-emerald-300">{nameSaved}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={startEditingName}
                      className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-bold text-zinc-200 transition hover:bg-white/10"
                    >
                      <i className="ri-pencil-line mr-1.5" />
                      Edit
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                        Display name
                      </span>
                      <input
                        value={nameDraft}
                        onChange={(e) => {
                          setNameDraft(e.target.value);
                          setNameError("");
                          setNameSaved("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !nameBusy) saveDisplayName();
                          if (e.key === "Escape") setEditingName(false);
                        }}
                        maxLength={DISPLAY_NAME_MAX}
                        autoFocus
                        autoComplete="off"
                        spellCheck="false"
                        placeholder="Your name"
                        aria-label="Display name"
                        className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30 focus:bg-black/60"
                      />
                    </label>

                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] text-zinc-600">
                        {normalizeDisplayName(nameDraft).length}/{DISPLAY_NAME_MAX}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingName(false);
                            setNameError("");
                          }}
                          className="rounded-full px-3 py-1.5 text-[11px] font-bold text-zinc-400 transition hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={nameBusy || !normalizeDisplayName(nameDraft)}
                          onClick={saveDisplayName}
                          className={`rounded-full px-4 py-1.5 text-[11px] font-black transition active:scale-[0.99] ${
                            nameBusy || !normalizeDisplayName(nameDraft)
                              ? "cursor-not-allowed bg-white/15 text-white/40"
                              : "bg-white text-black hover:bg-zinc-200"
                          }`}
                        >
                          {nameBusy ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>

                    {nameError && (
                      <p className="text-[11px] font-semibold text-red-300">{nameError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

                  </>
                )}

                {tab === "look" && (
                  <>
            {/* Your look — photo, banner, bio, accent (2026-09-26). Sits under
                the name because both are "who you are" before "what you publish":
                it works while private (kept in this browser) and rides along the
                next time the page is published. */}
            <LookEditor
              key={deviceEpoch}
              user={user}
              handle={profileHandle}
              published={published}
              onChanged={setLook}
            />

                  </>
                )}

                {tab === "page" && (
                  <>
            {/* ── Your page ───────────────────────────────────────────────
                Owner, 2026-09-25: ask for a username after sign-up, and make
                public/private a real button instead of a switch buried in a
                list of maintenance rows. Two states, two very different cards:

                  no username yet → UsernameStep     (asked once, skippable)
                  has a username  → the profile card (the visibility control)

                Private is the default and is honestly private: a username on
                its own writes only the owner-only pointer document, so there is
                no page for anyone to read until the member chooses Public. */}
            {!profileHandle && !skippedUsername ? (
              <UsernameStep
                user={user}
                displayName={displayName}
                onDone={(handle, isPublic) => {
                  setProfileHandle(handle);
                  setPublished(isPublic);
                  setProfileNotice(isPublic ? `Your page is live at /u/${handle}.` : "");
                }}
                onSkip={() => setSkippedUsername(true)}
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                  <i className={published ? "ri-global-line text-base text-emerald-300" : "ri-lock-2-line text-base text-zinc-400"} />
                  <p className="text-sm font-bold text-white">Your page</p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                      published
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                        : "border-white/10 bg-white/5 text-zinc-400"
                    }`}
                  >
                    {published ? "Public" : "Private"}
                  </span>
                </div>

                {profileHandle ? (
                  <div className="flex flex-col gap-4 p-4">
                    <VisibilityToggle
                      value={published ? "public" : "private"}
                      disabled={profileBusy === "toggle"}
                      handle={profileHandle}
                      onChange={async (next) => {
                        setProfileBusy("toggle");
                        setProfileError("");
                        setProfileNotice("");
                        const result =
                          next === "public"
                            ? await publishProfile(user.uid, profileHandle, displayName)
                            : await unpublishProfile(profileHandle);
                        setProfileBusy("");
                        if (!result.ok) {
                          setProfileError(result.message);
                          return;
                        }
                        setPublished(next === "public");
                        setProfileNotice(
                          next === "public"
                            ? `Your page is live at /u/${profileHandle}.`
                            : "Your page is offline. Your username is still yours.",
                        );
                      }}
                    />

                    <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard?.writeText(
                              window.location.origin + profileUrl(profileHandle),
                            );
                            setProfileNotice("Link copied.");
                          } catch {
                            setProfileNotice("Copy failed — select it from the address bar instead.");
                          }
                        }}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-zinc-200 transition hover:bg-white/10"
                      >
                        Copy link
                      </button>
                      <Link
                        to={profileUrl(profileHandle)}
                        className="rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-black transition hover:bg-zinc-200"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        disabled={profileBusy === "refresh"}
                        onClick={async () => {
                          setProfileBusy("refresh");
                          setProfileError("");
                          const result = await publishProfile(user.uid, profileHandle, displayName);
                          setProfileBusy("");
                          setProfileNotice(result.ok ? "Profile updated." : "");
                          if (!result.ok) setProfileError(result.message);
                        }}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
                      >
                        {profileBusy === "refresh" ? "Working…" : "Refresh now"}
                      </button>
                    </div>

                    <p className="text-[11px] leading-relaxed text-zinc-600">
                      Anyone with the link can see your display name, the titles on your list and the last
                      title you watched. Never your email, never your history beyond that. Changing your list
                      republishes it automatically while the page is public.
                    </p>

                    <Row
                      icon="ri-link-unlink"
                      label="Give the username back"
                      hint="Frees @yourname for anyone else. Your account, lists and sync are untouched."
                    >
                      <button
                        type="button"
                        disabled={profileBusy === "release"}
                        onClick={async () => {
                          setProfileBusy("release");
                          setProfileError("");
                          setProfileNotice("");
                          const result = await releaseHandle(user.uid, profileHandle);
                          setProfileBusy("");
                          if (!result.ok) {
                            setProfileError(result.message);
                            return;
                          }
                          setProfileHandle("");
                          setPublished(false);
                          setProfileNotice("Username released.");
                        }}
                        className="rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {profileBusy === "release" ? "Releasing…" : "Release"}
                      </button>
                    </Row>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 p-4">
                    <p className="text-[12px] leading-relaxed text-zinc-500">
                      No username yet — your lists stay entirely private. Choose one whenever you like:
                      nothing is published until you switch to Public.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSkippedUsername(false)}
                      className="min-h-[42px] w-fit rounded-xl bg-white px-4 text-[12px] font-bold text-black transition hover:bg-zinc-200"
                    >
                      Choose a username
                    </button>
                  </div>
                )}

                {profileError && (
                  <p className="px-4 py-3 text-[11px] font-semibold text-red-300">{profileError}</p>
                )}
                {profileNotice && (
                  <p className="px-4 py-3 text-[11px] font-semibold text-zinc-400">{profileNotice}</p>
                )}
              </div>
            )}

                  </>
                )}

                {tab === "sync" && (
                  <>
            {/* Sync */}
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <Row
                icon="ri-cloud-line"
                label="Cloud sync"
                hint="Keeps My List and Continue Watching on your other devices. Turning it off leaves your local lists untouched."
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={syncOn}
                  onClick={() => {
                    const next = !syncOn;
                    setSyncOn(next);
                    setSyncEnabled(next);
                  }}
                  className={`relative h-7 w-12 rounded-full border transition-colors duration-300 ${
                    syncOn ? "border-white bg-white" : "border-white/15 bg-white/5"
                  }`}
                  aria-label="Cloud sync"
                >
                  <span
                    className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all duration-300 ${
                      syncOn ? "left-6 bg-black" : "left-1 bg-zinc-500"
                    }`}
                  />
                </button>
              </Row>

              <Row
                icon="ri-refresh-line"
                label="Synced now"
                hint={`${counts.list} in My List · ${counts.history} in Continue Watching — stored in one document tied to your sign-in.`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                    {sync.state === "syncing"
                      ? "Syncing…"
                      : sync.state === "error"
                        ? "Not synced"
                        : syncOn
                          ? "Up to date"
                          : "Off"}
                  </span>
                  <button
                    type="button"
                    disabled={!syncOn || busy === "sync"}
                    onClick={async () => {
                      setBusy("sync");
                      setNotice("");
                      await pullAndMerge(user.uid).catch(() => {});
                      await pushCloudData(user.uid).catch(() => {});
                      // …and the public page, which "Sync" used to leave behind.
                      const page = await republishIfPublic(user.uid, displayName).catch(() => "");
                      setBusy("");
                      setNotice(page ? `Lists synced and your page /u/${page} updated.` : "Lists merged and pushed.");
                    }}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    {busy === "sync" ? "Working…" : "Sync now"}
                  </button>
                </div>
              </Row>

              <Row
                icon="ri-delete-bin-line"
                label="Delete cloud copy"
                hint="Removes the synced document from the server. Your local lists on this device stay."
              >
                <button
                  type="button"
                  disabled={busy === "delete"}
                  onClick={async () => {
                    setBusy("delete");
                    await deleteCloudData(user.uid).catch(() => {});
                    setBusy("");
                    setNotice("Cloud copy deleted.");
                  }}
                  className="rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-40"
                >
                  {busy === "delete" ? "Deleting…" : "Delete"}
                </button>
              </Row>

            </div>
                  </>
                )}

                {tab === "account" && (
                  <>
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <Row
                icon="ri-user-unfollow-line"
                label="Delete account"
                hint="Erases the sign-in and its synced document permanently. Lists saved on this device stay."
              >
                <button
                  type="button"
                  disabled={busy === "account"}
                  onClick={async () => {
                    // Two taps. The first only arms the button — deleting a real
                    // account on a single stray tap (on a phone, in a pocket) is
                    // not a risk worth taking, and "nothing appeared to happen"
                    // was half of why this looked broken.
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      setDanger("");
                      setNotice("Press it once more to delete the account — nothing has been removed yet.");
                      return;
                    }
                    setBusy("account");
                    setNotice("");
                    setDanger("");
                    try {
                      await deleteAccount();
                      // Signed out by the deletion itself, so this page is about
                      // to render the guest card. Leave a breadcrumb for whoever
                      // comes back to this page in the same session.
                      setNotice("Account deleted.");
                    } catch (err) {
                      setDanger(authErrorMessage(err));
                      setConfirmDelete(false);
                    } finally {
                      setBusy("");
                    }
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-40 ${
                    confirmDelete
                      ? "border-red-500/60 bg-red-500/25 text-red-200 hover:bg-red-500/35"
                      : "border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                  }`}
                >
                  {busy === "account"
                    ? "Deleting…"
                    : confirmDelete
                      ? "Tap again to delete"
                      : "Delete account"}
                </button>
              </Row>

                    </div>
            <button
              type="button"
              onClick={async () => {
                setBusy("out");
                await signOutUser().catch(() => {});
                setBusy("");
              }}
              disabled={busy === "out"}
              className="flex min-h-[46px] items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 text-sm font-bold text-white transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-50"
            >
              <i className="ri-logout-box-r-line" />
              {busy === "out" ? "Signing out…" : "Sign out"}
            </button>


            <p className="text-center text-[11px] leading-relaxed text-zinc-600">
              We store your sign-in email, your My List and your Continue
              Watching — nothing else. Deleting the cloud copy removes them;
              the details are on the{" "}
              <Link to="/privacy" className="font-bold text-zinc-400 underline decoration-white/20 underline-offset-2 hover:text-white">
                Privacy
              </Link>{" "}
              page.
            </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default Account;
