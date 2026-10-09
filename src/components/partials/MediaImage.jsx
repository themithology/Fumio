import React, { useEffect, useState } from "react";

/* ============================================================
   MediaImage — image with a palette-matched NAME fallback.

   When the poster/profile photo is missing (null src) or fails
   to load, instead of the generic /noimage.jpg we render a
   monochrome (strict B&W palette) container with the title /
   person's name centered, plus a faint watermark letter behind
   it. The gradient is picked deterministically from the name so
   the same title always gets the same subtle variation.

   variant="poster"  → film icon + title (movies / series / anime)
   variant="person"  → initials + full name (cast / people)
   compact           → tiny containers (≤ ~120px, e.g. 84px cast
                       circles, 54–76px schedule thumbs)
   ============================================================ */

// Subtle diagonal grey gradients — all inside the strict palette.
const GRADIENTS = [
  "linear-gradient(150deg, #1a1a1c 0%, #111113 55%, #080809 100%)",
  "linear-gradient(160deg, #141416 0%, #101012 50%, #0a0a0b 100%)",
  "linear-gradient(140deg, #1e1e21 0%, #131315 60%, #09090a 100%)",
  "linear-gradient(155deg, #101013 0%, #0c0c0e 45%, #060607 100%)",
];

const hashCode = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const getInitials = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

const MediaImage = ({
  src,
  title = "",
  variant = "poster",
  compact = false,
  className = "",
  alt,
  style,
  ...imgProps
}) => {
  const name = (title || alt || "").trim() || "Untitled";
  const [failed, setFailed] = useState(false);

  // If the src changes (list re-use, pagination), give the image another shot.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    const gradient = GRADIENTS[hashCode(name) % GRADIENTS.length];
    const initials = getInitials(name);
    const watermark = (variant === "person" ? initials : (name[0] || "?")).toUpperCase();
    const longName = name.length > 24;

    return (
      <div
        role="img"
        aria-label={name}
        title={name}
        style={{ background: gradient, ...style }}
        className={`relative flex select-none flex-col items-center justify-center overflow-hidden text-center ring-1 ring-inset ring-white/10 ${className}`}
      >
        {/* Giant watermark letter/initials behind the name */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute font-display font-black leading-none text-white/[0.05]"
          style={{ fontSize: compact ? "2.4rem" : "5rem", letterSpacing: "-0.04em" }}
        >
          {watermark}
        </span>

        {variant === "person" ? (
          compact ? (
            /* 84px cast circle: full name centered, tiny + clamped */
            <span className="relative z-10 px-1.5 text-[8px] font-bold leading-tight text-zinc-300 line-clamp-3">
              {name}
            </span>
          ) : (
            /* Large portrait (PersonDetails): initials + full name */
            <>
              <span className="relative z-10 font-display text-5xl font-extrabold tracking-tight text-zinc-200">
                {initials}
              </span>
              <span className="relative z-10 mt-2 px-4 text-xs font-semibold uppercase tracking-widest text-zinc-400 line-clamp-2">
                {name}
              </span>
            </>
          )
        ) : (
          <>
            <i
              aria-hidden="true"
              className={`ri-clapperboard-line relative z-10 text-zinc-600 ${
                compact ? "mb-1 text-xs" : "mb-2 text-xl"
              }`}
            />
            <span
              className={`relative z-10 px-2 font-display font-bold leading-snug text-zinc-300 ${
                compact
                  ? "text-[8px] line-clamp-3"
                  : longName
                    ? "text-xs line-clamp-4"
                    : "text-sm line-clamp-4"
              }`}
            >
              {name}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || name}
      style={style}
      className={className}
      onError={() => setFailed(true)}
      {...imgProps}
    />
  );
};

export default MediaImage;
