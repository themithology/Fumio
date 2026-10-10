import React, { useEffect, useState } from "react";
import {
  reserveUsername,
  publishProfile,
  isUsernameTaken,
  validateHandle,
  profileUrl,
  RESERVED_HANDLES,
} from "../../utils/profiles";
import VisibilityToggle from "./VisibilityToggle";

// ─── UsernameStep — "choose your username", asked once, right after sign-up ──
// Owner, 2026-09-25: "users should be asked to create their username after
// signing up ... there should be a button for keeping your profile public and
// private."
//
// So this is the first thing a new member sees on /account: a username field
// with a live preview of the address, a public/private choice, and one button.
//
// Two things it must never do:
//   • Publish by accident. The default is Private, and Private really is
//     private — it writes the owner-only username and no page at all.
//   • Nag. This is a one-time card: pick a username and it is replaced by the
//     profile card. Skip it (there is a dismiss) and /account simply carries on
//     without a profile, exactly as before. Nothing on the site is gated behind
//     it, which is the promise the rest of the site makes.

/** Three starting points from the member's own display name. They are only
 * suggestions — every one still has to pass validateHandle() and a lookup. */
const suggestionsFor = (displayName) => {
  const base = String(displayName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14);
  if (base.length < 3) return [];
  return [base, `${base}-hq`, `the-${base}`]
    .map((h) => h.slice(0, 20).replace(/-+$/g, ""))
    .filter((h) => h.length >= 3 && !RESERVED_HANDLES.has(h));
};

const UsernameStep = ({ user, displayName, onDone, onSkip }) => {
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taken, setTaken] = useState(false);

  const { ok, reason, handle } = validateHandle(draft);

  // Availability, asked only when the name is otherwise valid: one public read
  // of the page that would be created. It is a courtesy, not a reservation —
  // the rules are what actually decide, at publish time.
  useEffect(() => {
    if (!ok) {
      setTaken(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const exists = await isUsernameTaken(handle).catch(() => false);
      if (!cancelled) setTaken(exists);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ok, handle]);

  const suggestions = suggestionsFor(displayName);
  const canSubmit = ok && !busy && !taken;

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      if (visibility === "public") {
        // Going public straight away: publishing also records the username, so
        // this is a single step for the member.
        const result = await publishProfile(user.uid, handle, displayName);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onDone?.(handle, true);
        return;
      }
      const result = await reserveUsername(user.uid, handle);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone?.(handle, false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <i className="ri-at-line text-base text-zinc-300" />
        <p className="text-sm font-bold text-white">Choose your username</p>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          One time
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-[13px] leading-relaxed text-zinc-400">
          Your username is how you would be known if you ever share your list. Nothing is
          published until you say so — and you can change your mind at any time.
        </p>

        <label className="relative flex items-center">
          <span className="pointer-events-none absolute left-4 text-sm font-bold text-zinc-500">@</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
            placeholder="yourname"
            aria-label="Username"
            className="w-full rounded-xl border border-white/10 bg-black/50 py-3.5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30 focus:bg-black/60"
          />
        </label>

        {/* Live feedback, in order of urgency: shape, then availability. */}
        {draft && !ok && <p className="text-[12px] font-semibold text-amber-300">{reason}</p>}
        {ok && taken && (
          <p className="text-[12px] font-semibold text-amber-300">
            @{handle} already has a page here — pick another username.
          </p>
        )}
        {ok && !taken && (
          <p className="font-mono text-[11px] text-zinc-500">
            {visibility === "public" ? `opg.online${profileUrl(handle)}` : `reserved for you · /u/${handle}`}
          </p>
        )}

        {suggestions.length > 0 && !draft && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft(s)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                @{s}
              </button>
            ))}
          </div>
        )}

        <VisibilityToggle value={visibility} onChange={setVisibility} disabled={busy} handle={ok ? handle : ""} />

        {error && (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs font-semibold text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className={`min-h-[46px] rounded-xl px-5 text-sm font-bold transition active:scale-[0.99] ${
              canSubmit ? "bg-white text-black hover:bg-zinc-200" : "cursor-not-allowed bg-white/15 text-white/40"
            }`}
          >
            {busy
              ? "Saving…"
              : visibility === "public"
                ? "Save and go public"
                : "Save my username"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-[12px] font-semibold text-zinc-500 underline decoration-white/15 underline-offset-4 transition hover:text-zinc-300"
          >
            Not now
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Optional. No username, no problem — My List, Continue Watching and everything else keep
          working exactly the same.
        </p>
      </div>
    </div>
  );
};

export default UsernameStep;
