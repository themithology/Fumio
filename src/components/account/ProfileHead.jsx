import React from "react";
import { Link } from "react-router-dom";
import { normalizeLook } from "../../utils/profileLook";
import { coverById } from "../../utils/catalog";
import { profileUrl } from "../../utils/profiles";

// ─── ProfileHead — "this is what people see" ────────────────────────────────
// The one part of /account that is a picture rather than a control. Until
// 2026-09-27 the look preview lived inside the look editor, half-way down one
// long column: the owner's screenshot of his own page showed it sliding under
// the navigation, and his verdict was "the UI is absolute bare minimum … everything
// in one page". So the preview moved to the top, where it anchors every tab, and
// the controls moved into tabs underneath it.
//
// It renders the SAME fields the public page renders (utils/profileLook), so it
// cannot drift into a flattering mock-up: bio, accent, avatar and banner are the
// published values, and the Public/Private pill is the published state.

const ProfileHead = ({ displayName, handle, published, look, onEditLook }) => {
  const clean = normalizeLook(look);
  const cover = coverById(clean.cover);
  const name = (displayName || "").trim() || handle || "Your name";
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const accent = clean.accent || undefined;

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.95)]">
      {/* The cover. A member picks a gradient, so this is a CSS background — no
          request, no image host, nothing that can 404. When none is chosen the
          space still shows what it is for rather than an empty black box. */}
      <div className="relative h-32 sm:h-40">
        {cover ? (
          <div className="absolute inset-0" style={{ backgroundImage: cover.css }} />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_15%_0%,rgba(255,255,255,0.10),transparent_65%)]">
            <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/20">
              Pick a cover · Your look
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08080a] via-[#08080a]/30 to-transparent" />

        <div className="absolute right-3 top-3 flex items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest backdrop-blur ${
              published
                ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200"
                : "border-white/15 bg-black/40 text-zinc-300"
            }`}
          >
            {published ? "Public" : "Private"}
          </span>
        </div>
      </div>

      <div className="relative -mt-11 flex flex-wrap items-end gap-4 px-4 pb-4 sm:px-6 sm:pb-5">
        {clean.avatar ? (
          <img
            src={clean.avatar}
            alt=""
            className="h-[88px] w-[88px] shrink-0 rounded-2xl border-2 border-[#0b0b0d] object-cover shadow-lg"
          />
        ) : (
          <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-2xl border-2 border-[#0b0b0d] bg-gradient-to-br from-white to-zinc-300 font-display text-3xl font-black text-black shadow-lg">
            {initial}
          </span>
        )}

        <div className="min-w-0 flex-1 pb-1">
          <p className="truncate font-display text-xl font-black leading-tight text-white" style={{ color: accent }}>
            {name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
            {handle ? `@${handle}` : "No username yet — your page has no address"}
          </p>
          <p
            className="mt-1 line-clamp-2 max-w-[46ch] text-[12px] leading-relaxed"
            style={{ color: accent || undefined }}
          >
            {clean.bio || <span className="text-zinc-600">Your bio appears here.</span>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 pb-1">
          <button
            type="button"
            onClick={onEditLook}
            className="rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-[11px] font-bold text-zinc-100 transition hover:bg-white/10 active:scale-[0.98]"
          >
            <i className="ri-palette-line mr-1.5" />
            Edit look
          </button>
          {handle && (
            <Link
              to={profileUrl(handle)}
              className="rounded-full bg-white px-3.5 py-2 text-[11px] font-black text-black transition hover:bg-zinc-200 active:scale-[0.98]"
            >
              {published ? "View page" : "Preview page"}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
};

export default ProfileHead;
