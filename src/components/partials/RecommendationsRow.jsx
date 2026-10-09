import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ScrollRow from "./ScrollRow.jsx";
import MediaImage from "./MediaImage.jsx";
import TitleHint from "./TitleHint.jsx";

const DISCORD_URL = "https://discord.gg/t6tjszp5eb";
const API_BASE = String(import.meta.env.VITE_ACCOUNT_API_BASE || "").replace(/\/$/, "");

// Optional Iris server feature. The row disappears quietly when Fumio is
// served without Iris's Node recommendation endpoint or when the community
// has not submitted anything yet.
export default function RecommendationsRow() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let controller;
    const load = async () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${API_BASE}/api/recommendations/top`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("recommendations unavailable");
        const body = await response.json();
        if (controller.signal.aborted || !Array.isArray(body?.results)) return;
        setItems(
          body.results
            .filter(
              (item) =>
                Number.isSafeInteger(item.id) &&
                item.id > 0 &&
                ["movie", "tv"].includes(item.mediaType) &&
                typeof item.title === "string" &&
                item.count > 0,
            )
            .slice(0, 10),
        );
      } catch {
        // Community recommendations are optional and must never block Home.
      } finally {
        clearTimeout(timeout);
      }
    };

    void load();
    const interval = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(interval);
      controller?.abort();
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  if (!items.length) return null;

  return (
    <section aria-labelledby="community-recommendations-title" className="w-full px-4 pt-8 sm:px-8 md:px-12 lg:px-16 xl:px-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="community-recommendations-title" className="font-editorial text-2xl font-bold text-white sm:text-3xl">
            Suggested by the Discord Community
          </h2>
          <p className="mt-1 text-xs text-zinc-400">This week · Ranked by member recommendations</p>
        </div>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm text-zinc-300 hover:text-white">
          <i className="ri-discord-fill" aria-hidden="true" /> Add your recommendation
        </a>
      </div>
      <ScrollRow label="community recommendations" className="gtv-no-scrollbar flex gap-4 overflow-x-auto snap-x py-4">
        {items.map((item, index) => (
          <Link key={`${item.mediaType}:${item.id}`} to={`/${item.mediaType}/details/${item.id}`} className="group w-[130px] shrink-0 snap-start sm:w-[160px] lg:w-[180px]">
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
              <MediaImage
                src={/^\/[\w.-]+$/.test(item.posterPath || "") ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : null}
                title={item.title}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <span className="absolute left-2 top-2 rounded-md bg-black/80 px-2 py-1 text-sm font-bold text-white">{index + 1}</span>
            </div>
            <TitleHint className="mt-2 truncate text-sm font-semibold text-white">{item.title}</TitleHint>
            <p className="mt-1 text-xs text-zinc-400">{item.count} {item.count === 1 ? "recommendation" : "recommendations"}</p>
          </Link>
        ))}
      </ScrollRow>
    </section>
  );
}
