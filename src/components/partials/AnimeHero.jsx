import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "../../lib/irisAxios.js";
import { useHeroWatchlist } from "./useHeroWatchlist";
import HeroLogo from "./HeroLogo";

// Hero backdrop sizing: w780 on phones, w1280 on desktop.
const heroImageUrl = (path) =>
  path
    ? `https://image.tmdb.org/t/p/${window.innerWidth >= 1024 ? "w1280" : "w780"}${path}`
    : "";

const preloadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });

const AnimeHero = ({ data }) => {
  const heroKey = useMemo(() => {
    const arr = Array.isArray(data) ? data : data ? [data] : [];
    return arr.map((i) => `${i.media_type || "tv"}-${i.id}`).join("|");
  }, [data]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (Array.isArray(data) ? data : data ? [data] : []), [heroKey]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [logos, setLogos] = useState({});
  const [customBackdrops, setCustomBackdrops] = useState({});
  const [logoFailed, setLogoFailed] = useState({});
  const [logoFallback, setLogoFallback] = useState({});
  const [inMyList, toggleSaved] = useHeroWatchlist(items, currentIndex);

  useEffect(() => {
    setCurrentIndex(0);
    setLogos({});
    setCustomBackdrops({});
    setLogoFailed({});
    setLogoFallback({});
  }, [heroKey]);

  // Touch Swipe Gesture State
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchEndX, setTouchEndX] = useState(0);

  // Mouse Drag Gesture State
  const [dragStartX, setDragStartX] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (items.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, 7000);

    return () => clearInterval(interval);
  }, [items]);

  // Preload logo and textless backdrop for active and next slide
  useEffect(() => {
    if (!items || items.length === 0) return;
    const nextIndex = (currentIndex + 1) % items.length;
    const targets = [items[currentIndex], items[nextIndex]];
    if (!targets[0]) return;

    let cancelled = false;
    const fallbackTimers = [];

    const fetchSlideImages = async () => {
      const logosMap = {};
      const backdropsMap = {};
      await Promise.all(
        targets.map(async (item) => {
          if (!item || !item.id) return;
          fallbackTimers.push(
            setTimeout(() => {
              if (!cancelled && !logosMap[item.id]) {
                setLogoFallback((prev) => ({ ...prev, [item.id]: true }));
              }
            }, 1400)
          );
          const mediaType = item.media_type || (item.title ? "movie" : "tv");
          try {
            const res = await axios.get(`/${mediaType}/${item.id}/images`);
            if (cancelled || !res.data || res.data.success === false) return;

            const logosList = res.data.logos || [];
            if (logosList.length > 0) {
              const englishLogos = logosList.filter((l) => l.iso_639_1 === "en" || l.iso_639_1 === "ja");
              const logo = englishLogos.length > 0 ? englishLogos[0] : logosList[0];
              const candidate = `https://image.tmdb.org/t/p/w300${logo.file_path}`;
              if (await preloadImage(candidate)) {
                if (!cancelled) logosMap[item.id] = candidate;
              } else if (!cancelled) {
                setLogoFailed((prev) => ({ ...prev, [item.id]: true }));
              }
            }

            const backdrops = res.data.backdrops || [];
            if (backdrops.length > 0) {
              const top20 = backdrops.slice(0, 20);
              const textlessTop20 = top20.filter((b) => b.iso_639_1 === null);
              const pool = textlessTop20.length > 0 ? textlessTop20 : top20;
              const chosen = pool[Math.floor(Math.random() * pool.length)];
              if (await preloadImage(heroImageUrl(chosen.file_path))) {
                if (!cancelled) backdropsMap[item.id] = chosen.file_path;
              }
            }
          } catch {
            if (!cancelled) setLogoFailed((prev) => ({ ...prev, [item.id]: true }));
          }
        })
      );
      if (!cancelled) {
        setLogos((prev) => ({ ...prev, ...logosMap }));
        setCustomBackdrops((prev) => ({ ...prev, ...backdropsMap }));
      }
    };

    fetchSlideImages();
    return () => {
      cancelled = true;
      fallbackTimers.forEach(clearTimeout);
    };
  }, [items, currentIndex]);

  const handleTouchStart = (e) => setTouchStartX(e.targetTouches[0].clientX);
  const handleTouchMove = (e) => setTouchEndX(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (!touchStartX || !touchEndX) return;
    const diff = touchStartX - touchEndX;
    if (diff > 50) setCurrentIndex((prev) => (prev + 1) % items.length);
    else if (diff < -50) setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
    setTouchStartX(0);
    setTouchEndX(0);
  };

  const handleMouseDown = (e) => {
    setDragStartX(e.clientX);
    setDragging(true);
  };
  const handleMouseMove = (e) => {
    if (!dragging) return;
    const diff = dragStartX - e.clientX;
    if (Math.abs(diff) > 80) {
      if (diff > 0) setCurrentIndex((prev) => (prev + 1) % items.length);
      else setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
      setDragging(false);
    }
  };
  const handleMouseUp = () => setDragging(false);

  const activeItem = items[currentIndex];
  if (!activeItem) return null;
  const nextIndex = items.length > 1 ? (currentIndex + 1) % items.length : currentIndex;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className="relative -mt-13 min-h-[clamp(520px,68svh,700px)] w-full overflow-hidden bg-black select-none cursor-grab active:cursor-grabbing"
    >
      {/* Slides */}
      {items.map((item, idx) => {
        const title = item.name || item.title || item.original_name || item.original_title;
        const year = (item.release_date || item.first_air_date || "").split("-")[0];
        const mediaType = item.media_type || (item.title ? "movie" : "tv");
        const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
        const overview = item.overview ? item.overview.slice(0, 160) : "";
        const activeBackdropPath = customBackdrops[item.id] || item.backdrop_path || item.poster_path;

        return (
          <div
            key={item.id}
            className={`flex min-h-[clamp(520px,68svh,700px)] w-full flex-col transition-all duration-1000 ease-in-out ${
              idx === currentIndex ? "relative opacity-100 scale-100 z-10" : "absolute inset-0 opacity-0 scale-105 z-0"
            }`}
          >
            {/* Backdrop image */}
            {(idx === currentIndex || idx === nextIndex) && activeBackdropPath && (
              <img
                src={heroImageUrl(activeBackdropPath)}
                alt=""
                fetchPriority={idx === currentIndex ? "high" : "low"}
                loading="eager"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: "center 20%" }}
              />
            )}

            {/* Cinematic dark gradients */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 32%, rgba(0,0,0,0.25) 58%, #000 100%), linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.15) 72%, transparent 100%)",
              }}
            />

            {/* Content Container */}
            {idx === currentIndex && (
              <div className="relative z-20 flex min-w-0 max-w-3xl flex-1 flex-col justify-end px-4 pb-12 pt-28 sm:px-8 sm:pb-16 md:px-12 lg:px-16 xl:px-20 animate-slide-up-fade">

                {/* An unboxed context line leaves the artwork in charge. */}
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold tracking-wide text-zinc-200 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:text-sm">
                  <span className="font-bold uppercase tracking-[0.16em] text-white">ANIME</span>
                  {year && <><span className="text-white/40" aria-hidden="true">·</span><span>{year}</span></>}
                  {rating && <><span className="text-white/40" aria-hidden="true">·</span><span><i className="ri-star-fill text-amber-300" aria-hidden="true" /> {rating} / 10</span></>}
                </div>

                {/* Title logo / plain text */}
                {logos[item.id] && !logoFailed[item.id] && !logoFallback[item.id] ? (
                  <HeroLogo
                    key={logos[item.id]}
                    src={logos[item.id]}
                    alt={title}
                    onError={() => setLogoFailed((prev) => ({ ...prev, [item.id]: true }))}
                  />
                ) : logoFailed[item.id] || logoFallback[item.id] ? (
                  <h1 className="mb-3 max-w-[90%] gtv-hero-title font-editorial font-bold tracking-tight text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.9)] animate-slide-up-fade">
                    {title}
                  </h1>
                ) : (
                  <h1
                    aria-hidden="true"
                    className="mb-3 max-w-[90%] gtv-hero-title font-editorial font-bold tracking-tight text-white opacity-0 select-none pointer-events-none"
                  >
                    {title}
                  </h1>
                )}

                {overview && (
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-200 line-clamp-2 sm:line-clamp-3 sm:text-base drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                    {overview}...
                  </p>
                )}

                {/* One title link, one saved-list action — no duplicate CTA. */}
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    to={`/${mediaType}/details/${item.id}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-extrabold text-black transition-all duration-300 hover:bg-zinc-200 hover:scale-[1.03] active:scale-95"
                  >
                    <i className="ri-play-fill text-lg" aria-hidden="true" /> Start Watching
                  </Link>
                  <button
                    type="button"
                    aria-pressed={inMyList}
                    onClick={toggleSaved}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                  >
                    <i className={inMyList ? "ri-bookmark-fill text-lg" : "ri-add-line text-lg"} aria-hidden="true" />
                    {inMyList ? "In My List" : "My List"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Full-height tap targets, positioned away from the mobile actions. */}
      {items.length > 1 && (
        <div className="absolute right-4 top-24 z-30 flex gap-2 sm:top-auto sm:bottom-8 sm:right-10">
          {items.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className="group flex h-6 items-center px-[3px]"
              aria-label={`Go to slide ${idx + 1}`}
              aria-current={idx === currentIndex ? "true" : undefined}
            >
              <span className={`block h-1.5 rounded-full transition-all duration-300 ${
                idx === currentIndex ? "w-6 bg-white" : "w-2 bg-white/30 group-hover:bg-white/60"
              }`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnimeHero;
