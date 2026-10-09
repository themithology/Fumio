import { useEffect, useState } from "react";
import HorizontalCards from "./HorizontalCards.jsx";
import ScrollRow from "./ScrollRow.jsx";
import axios from "../../lib/irisAxios.js";
import { readMyList } from "../../utils/myList.js";
import { readContinueWatching } from "../../utils/watchHistory.js";

const RECENT_SEARCHES_KEY = "recentSearches";

const readJSON = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const isTitle = (item) => item && item.id && (item.type === "movie" || item.type === "tv");
const keyOf = (item) => `${item?.type || item?.media_type || "movie"}-${item?.id}`;

// Iris's on-device recommendation row. It uses only local watch/list/search
// signals and TMDB recommendation endpoints; it does not require an account.
export default function ForYou() {
  const [seeds] = useState(() => {
    const watched = readContinueWatching()
      .filter(isTitle)
      .sort((a, b) => Number(b.lastUpdated || 0) - Number(a.lastUpdated || 0));
    const watchedKeys = new Set(watched.map(keyOf));
    const watchedSeeds = watched.slice(0, 3).map((item, index) => ({
      id: item.id,
      type: item.type,
      label: item.title || "",
      weight: 3 * (1 - index * 0.25),
    }));

    const listSeeds = readMyList()
      .filter((item) => isTitle(item) && !watchedKeys.has(keyOf(item)))
      .slice(0, 2)
      .map((item, index) => ({
        id: item.id,
        type: item.type,
        label: item.title || "",
        weight: 2.2 * (1 - index * 0.2),
      }));

    return {
      allHistorySeeds: [...watchedSeeds, ...listSeeds],
      searchTerms: readJSON(RECENT_SEARCHES_KEY).filter((term) => typeof term === "string" && term.trim()).slice(0, 2),
      watchedKeys,
      primaryReason: watchedSeeds[0]?.label || listSeeds[0]?.label || null,
    };
  });

  const [items, setItems] = useState(null);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    if (!ref || items !== null) return undefined;
    let cancelled = false;

    const build = async () => {
      try {
        const searchSeeds = [];
        for (const query of seeds.searchTerms) {
          if (searchSeeds.length >= 2) break;
          try {
            const { data } = await axios.get(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`);
            const hit = (data?.results || []).find((item) => item && item.id && ["movie", "tv"].includes(item.media_type));
            if (hit && !seeds.watchedKeys.has(`${hit.media_type}-${hit.id}`)) {
              searchSeeds.push({
                id: hit.id,
                type: hit.media_type,
                label: hit.title || hit.name || query,
                weight: 1.5,
              });
            }
          } catch {
            // One failed search seed should not remove the whole row.
          }
        }

        const allSeeds = [...seeds.allHistorySeeds, ...searchSeeds].slice(0, 4);
        if (!allSeeds.length) {
          if (!cancelled) setItems([]);
          return;
        }

        const recommendationLists = await Promise.all(
          allSeeds.map(async (seed) => {
            try {
              const { data } = await axios.get(`/${seed.type}/${seed.id}/recommendations`);
              let list = data?.results || [];
              if (!list.length) {
                const similar = await axios.get(`/${seed.type}/${seed.id}/similar`).catch(() => null);
                list = similar?.data?.results || [];
              }
              return list.filter((item) => item?.id).slice(0, 10).map((item) => ({ ...item, media_type: seed.type }));
            } catch {
              return [];
            }
          }),
        );

        const scored = new Map();
        recommendationLists.forEach((list, seedIndex) => {
          const weight = allSeeds[seedIndex].weight;
          list.forEach((item, itemIndex) => {
            if (seeds.watchedKeys.has(`${item.media_type}-${item.id}`)) return;
            const rankBoost = Math.max(1 - itemIndex * 0.05, 0.4);
            const popularityBoost = Math.min(Number(item.popularity || 0) / 200, 0.5);
            const key = `${item.media_type}-${item.id}`;
            const previous = scored.get(key) || { item, score: 0 };
            previous.score += weight * rankBoost + popularityBoost;
            scored.set(key, previous);
          });
        });

        const recommendations = [...scored.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map(({ item }) => item);
        if (!cancelled) setItems(recommendations);
      } catch {
        if (!cancelled) setItems([]);
      }
    };

    build();
    return () => {
      cancelled = true;
    };
  }, [items, ref, seeds]);

  if (!seeds.allHistorySeeds.length && !seeds.searchTerms.length) return null;
  if (items !== null && !items.length) return null;

  const reason = seeds.primaryReason ? `Based on your interest in ${seeds.primaryReason}` : "From your recent discovery history";
  return (
    <section ref={setRef} className="flex min-h-[260px] w-full flex-col gap-1">
      <div className="flex items-end justify-between px-4 pb-2 pt-10 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 font-editorial text-xl font-bold tracking-tight text-white sm:text-2xl">
            <span className="h-6 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
            Picked For You
            <i className="ri-sparkling-2-fill text-base text-zinc-400" aria-hidden="true" />
          </h2>
          <span className="pl-3.5 text-[11px] font-semibold text-zinc-500">{reason}</span>
        </div>
      </div>
      <div className="px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        {items === null ? (
          <ScrollRow label="picked for you" className="gtv-no-scrollbar flex gap-4 overflow-x-auto py-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-[2/3] w-[130px] shrink-0 animate-pulse rounded-2xl border border-white/5 bg-zinc-900/60 sm:w-[150px] md:w-[170px] lg:w-[190px] xl:w-[210px]" />
            ))}
          </ScrollRow>
        ) : (
          <HorizontalCards data={items} />
        )}
      </div>
    </section>
  );
}
