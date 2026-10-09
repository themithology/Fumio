import React, { useState } from "react";

// Logos vary wildly in aspect ratio. Keep the image inside the available
// column on every hub and let the hero grow vertically instead of clipping a
// tall wordmark inside a constrained wrapper.
const HeroLogo = ({ src, alt, onError }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="flex min-h-11 w-full min-w-0 max-w-full shrink-0 items-end pb-3">
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={onError}
        className={`block h-auto max-h-[min(18svh,160px)] w-auto max-w-full object-contain object-left-bottom drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)] transition-all duration-700 ease-out ${
          loaded ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-6 scale-95"
        }`}
      />
    </div>
  );
};

export default HeroLogo;
