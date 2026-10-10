import React, { useEffect, useMemo, useState } from "react";
import { loadCatalog, shippedAvatars, catalogCredit } from "../../utils/catalog";
import { COVER_CATALOG } from "../../config/avatarCatalog.js";
import { ACCENTS, BIO_MAX, lookSummary, normalizeLook, readLook, writeLook } from "../../utils/profileLook";

// ─── LookEditor — the member's picture, cover, bio and colour ───────────────
//
// Owner, 2026-09-27: "we will ads catalog of pfp like Netflix and hotstar no
// more problems just pick the peakest of the peak photo you have full freedom
// and also leave a option for me to add some from the console.. I.e trash this
// custom photo Idea".
//
// So this is a PICKER, not an uploader. There are no file inputs, no camera
// roll, no image host, no API key and no "Check photos" button — the four things
// that could go wrong with uploading (decoder, format, host, secret) are simply
// not here any more. What is left:
//
//   • a grid of pictures — tap one, it is yours; tap it again to clear it. The
//     ANIME CHARACTERS lead the grid (owner, 2026-09-27: "add anime character …
//     like Lloyd frontera and … natsuki subaru while keeping some genric ones"),
//     the drawn generic tiles follow, and the owner's own additions come first of
//     all (src/utils/catalog.js merges them). The chips filter between the three.
//   • a row of covers, each a CSS gradient — zero requests, cannot 404.
//   • the bio and the accent colour, unchanged.
//
// Everything saves as it is tapped and rides along the next publish, exactly the
// way the rest of the look always has (utils/profileLook.js).

const LookEditor = ({ user, handle, published, onChanged }) => {
  const [look, setLook] = useState(readLook);
  const [catalog, setCatalog] = useState(() => ({ avatars: shippedAvatars(), source: "build" }));
  const [draft, setDraft] = useState(() => readLook().bio);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  // A phone should not fetch ninety pictures at once. Portraits are lazy-loaded,
  // but the grid starts at two dozen tiles and the rest is one tap away — the
  // characters are ~100 KB each, the drawn ones a few KB.
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = (next) => {
    const stored = writeLook(next);
    setLook(stored);
    onChanged?.(stored);
    return stored;
  };

  // Three groups, because a hundred tiles with no way to narrow them is a wall:
  // the characters, the drawn generic ones, and whatever the owner added.
  const groups = useMemo(() => {
    const anime = catalog.avatars.filter((avatar) => avatar.kind === "anime");
    const generic = catalog.avatars.filter((avatar) => avatar.kind === "generic" || (!avatar.kind && !avatar.owner));
    const owner = catalog.avatars.filter((avatar) => avatar.owner || avatar.kind === "owner");
    return [
      { id: "all", label: "All", count: catalog.avatars.length },
      { id: "anime", label: "Anime", count: anime.length },
      { id: "generic", label: "Generic", count: generic.length },
      ...(owner.length ? [{ id: "owner", label: "Yours", count: owner.length }] : []),
    ];
  }, [catalog.avatars]);

  const GRID_PAGE = 24;

  const shown = useMemo(() => {
    if (filter === "all") return catalog.avatars;
    if (filter === "anime") return catalog.avatars.filter((avatar) => avatar.kind === "anime");
    if (filter === "owner") return catalog.avatars.filter((avatar) => avatar.owner || avatar.kind === "owner");
    return catalog.avatars.filter((avatar) => avatar.kind === "generic" || (!avatar.kind && !avatar.owner));
  }, [catalog.avatars, filter]);

  const clean = normalizeLook(look);
  const summary = lookSummary(clean);

  const pickPicture = (avatar) => {
    const same = clean.avatar === avatar.url;
    apply({ ...look, avatar: same ? "" : avatar.url });
    setNotice(same ? "Picture cleared — your initial is back." : `Picture set: ${avatar.name}.`);
  };

  const pickCover = (cover) => {
    const same = clean.cover === cover.id;
    apply({ ...look, cover: same ? "" : cover.id });
    setNotice(same ? "Cover cleared." : `${cover.name} cover set.`);
  };

  const saveText = () => {
    const stored = apply({ ...look, bio: draft });
    setDraft(stored.bio);
    setNotice(stored.bio ? "Bio saved." : "Bio cleared.");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <i className="ri-user-smile-line text-base text-zinc-300" />
        <p className="text-sm font-bold text-white">Your look</p>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          {summary === "nothing yet" ? "Not set" : summary}
        </span>
      </div>

      <div className="flex flex-col gap-5 p-4">
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Everything here shows up in the preview above the moment you tap it
          {handle ? ` — and on /u/${handle}` : ""}
          {published ? "." : ", and goes public when you switch your page to Public."}
        </p>

        {/* ── the pictures ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-bold text-white">Profile picture</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {groups[1]?.count || 0} anime characters, then a few drawn ones — each character is named
                under their picture. Tap yours, tap it again to clear it.
              </p>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={filter === group.id}
                  onClick={() => setFilter(group.id)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
                    filter === group.id
                      ? "border-white/20 bg-white text-black"
                      : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  {group.label}
                  <span className={filter === group.id ? " text-black/50" : " text-zinc-500"}>{` ${group.count}`}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {/* The letter avatar is a real option, not a fallback nobody chose. */}
            <button
              type="button"
              onClick={() => {
                apply({ ...look, avatar: "" });
                setNotice("No picture — your initial is shown.");
              }}
              aria-pressed={!clean.avatar}
              title="No picture"
              className={`grid aspect-square place-items-center rounded-2xl border-2 bg-gradient-to-br from-white/10 to-white/[0.02] font-display text-lg font-black text-zinc-300 transition ${
                clean.avatar ? "border-white/10 hover:border-white/40" : "border-white"
              }`}
            >
              Aa
            </button>

            {(showAll ? shown : shown.slice(0, GRID_PAGE)).map((avatar) => {
              const active = clean.avatar === avatar.url;
              // Characters wear their name ON the tile. They used to carry it in a
              // tooltip, which does not exist on a phone — a grid of unnamed faces
              // is what made the owner say the pictures were ones "no one is gonna
              // relate to". The drawn generic tiles keep no label: "Adventurer"
              // four times over is noise, and they are the ones he asked to keep as
              // filler anyway.
              const labelOnTile = Boolean(avatar.series) || avatar.kind === "anime";
              return (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => pickPicture(avatar)}
                  aria-pressed={active}
                  title={avatar.series ? `${avatar.name} — ${avatar.series}` : avatar.name}
                  className={`relative aspect-square overflow-hidden rounded-2xl border-2 bg-black/40 transition ${
                    active ? "border-white" : "border-white/10 hover:border-white/40"
                  }`}
                >
                  <img
                    src={avatar.url}
                    alt={avatar.series ? `${avatar.name} from ${avatar.series}` : avatar.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  {labelOnTile && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 via-black/60 to-transparent px-1 pb-1 pt-3 text-center text-[9px] font-bold leading-none text-white">
                      {avatar.name}
                    </span>
                  )}
                  {avatar.owner && (
                    <span className="absolute left-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-300">
                      Yours
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] text-black">
                      <i className="ri-check-line" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {shown.length > GRID_PAGE && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="min-h-[40px] w-full rounded-xl border border-white/10 bg-white/5 text-[11px] font-bold text-zinc-200 transition hover:bg-white/10"
            >
              {showAll ? "Show fewer" : `Show all ${shown.length} pictures`}
            </button>
          )}
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Tap the picture you are using again to go back to your initial.
          </p>
          <p className="text-[10px] leading-relaxed text-zinc-600">{catalogCredit()}</p>
        </div>

        {/* ── the cover ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 border-t border-white/5 pt-4">
          <p className="text-[12px] font-bold text-white">Cover</p>
          <p className="text-[11px] text-zinc-500">The band at the top of your page. Tap again to clear it.</p>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {COVER_CATALOG.map((cover) => {
              const active = clean.cover === cover.id;
              return (
                <button
                  key={cover.id}
                  type="button"
                  onClick={() => pickCover(cover)}
                  aria-pressed={active}
                  aria-label={cover.name}
                  title={cover.name}
                  className={`aspect-[2/1] rounded-lg border-2 transition ${
                    active ? "border-white" : "border-white/10 hover:border-white/40"
                  }`}
                  style={{ backgroundImage: cover.css }}
                />
              );
            })}
          </div>
        </div>

        {/* ── the bio ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5 border-t border-white/5 pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-bold text-white">Bio</span>
            <span className="font-mono text-[10px] text-zinc-600">
              {draft.length}/{BIO_MAX}
            </span>
          </div>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.slice(0, BIO_MAX));
              setNotice("");
            }}
            onKeyDown={(e) => e.key === "Enter" && saveText()}
            maxLength={BIO_MAX}
            autoComplete="off"
            placeholder="One line about you"
            aria-label="Bio"
            className="w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30 focus:bg-black/60"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveText}
              disabled={normalizeLook({ bio: draft }).bio === clean.bio}
              className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${
                normalizeLook({ bio: draft }).bio === clean.bio
                  ? "cursor-not-allowed bg-white/10 text-white/40"
                  : "bg-white text-black hover:bg-zinc-200"
              }`}
            >
              Save bio
            </button>
          </div>
        </div>

        {/* ── the accent ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 border-t border-white/5 pt-4">
          <span className="text-[12px] font-bold text-white">Accent colour</span>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((accent) => {
              const active = clean.accent === accent.value;
              return (
                <button
                  key={accent.value}
                  type="button"
                  aria-label={accent.name}
                  aria-pressed={active}
                  onClick={() => {
                    apply({ ...look, accent: active ? "" : accent.value });
                    setNotice(active ? "Accent cleared." : `${accent.name} accent set.`);
                  }}
                  className={`h-8 w-8 rounded-full border-2 transition ${
                    active ? "border-white" : "border-white/10 hover:border-white/40"
                  }`}
                  style={{ backgroundColor: accent.value }}
                />
              );
            })}
            {clean.accent && (
              <button
                type="button"
                onClick={() => {
                  apply({ ...look, accent: "" });
                  setNotice("Accent cleared.");
                }}
                className="rounded-full px-2 py-1 text-[11px] font-bold text-zinc-400 transition hover:text-white"
              >
                None
              </button>
            )}
          </div>
        </div>

        {notice && (
          <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3.5 py-2.5 text-[11px] font-semibold text-emerald-200">
            {notice}
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Saved to this browser
          {published ? " and published — your page shows this now." : ". Nothing is public until you switch your page to Public."}
          {user?.isAnonymous ? " Sign in first — a guest cannot keep a look." : ""}
        </p>
      </div>
    </div>
  );
};

export default LookEditor;
