import React from "react";

// ─── VisibilityToggle — PUBLIC / PRIVATE as a real, visible choice ──────────
// Owner, 2026-09-25: "there should be a button for keeping your profile public
// and private ... rather than this old school approach."
//
// The old flow buried publish/unpublish in a small switch inside a list of
// maintenance rows ("Update", "Give the handle back"), which read like settings
// for a printer. This is the same underlying state — one boolean — presented as
// the decision it actually is: two big halves, the current one lit, and one
// line of plain English underneath saying what the choice means right now.
//
// It is deliberately not a switch: a switch shows the state but not the
// CONSEQUENCE, and the consequence here is the whole point ("anyone with the
// link" vs "only you").

const OPTIONS = [
  {
    value: "private",
    label: "Private",
    icon: "ri-lock-2-line",
    blurb: "Only you. Nobody can open a page — your list is not published at all.",
  },
  {
    value: "public",
    label: "Public",
    icon: "ri-global-line",
    blurb: "Anyone with the link can see your list and what you last watched. Never your email.",
  },
];

const VisibilityToggle = ({ value, disabled, onChange, handle }) => (
  <div className="flex flex-col gap-2.5">
    <div
      role="radiogroup"
      aria-label="Profile visibility"
      className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-black/40 p-1.5"
    >
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange?.(option.value)}
            className={`flex min-h-[52px] items-center justify-center gap-2 rounded-xl text-sm font-bold transition active:scale-[0.98] disabled:opacity-50 ${
              active
                ? "bg-white text-black shadow-sm"
                : "text-zinc-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <i className={`${option.icon} text-base`} />
            {option.label}
          </button>
        );
      })}
    </div>

    <p className="text-[12px] leading-relaxed text-zinc-500">
      {OPTIONS.find((o) => o.value === value)?.blurb}
    </p>

    {value === "public" && handle && (
      <p className="font-mono text-[11px] text-zinc-400">/u/{handle}</p>
    )}
  </div>
);

export default VisibilityToggle;
