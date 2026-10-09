// ─────────────────────────────────────────────────────────────────────────────
// TheOGPirateBot — AniList section logic (season segregation, weekly airing
// schedule, trending) — SINGLE SOURCE, THREE RUNTIMES:
//
//   1. Cloudflare Workers — imported by edge/worker/main.ts (routes), bundled
//      by `npm run build:worker` into edge/cloudflare-worker/worker.js
//   2. Vercel (api/index.py) — the Python mirror, emergency fallback only
//   3. THE BROWSER        — src/utils/anilistDirect.js imports this module as
//      the last-resort fallback when every serverless egress is WAF-blocked
//      by AniList (failure mode #19): graphql.anilist.co is CORS-open and
//      serves residential IPs, so the visitor's browser can still build the
//      season map / schedule / trending client-side.
//
// Ported 1:1 from api/index.py (which keeps its own Python mirror — parity
// covered by tests/*.test.mjs importing the pieces through the main.ts
// re-exports). Browsers silently drop the "User-Agent" header set in these
// fetchers (forbidden header name) — AniList sees the real browser UA, fine.
// ─────────────────────────────────────────────────────────────────────────────

// ─── AniList anime-metadata bridge ───
// Ported 1:1 from api/index.py — see that file + LESSONS-LEARNED.md for the
// full rationale (failure modes #1–#3, #5, #6, #9).

// AniList TV formats that make up the main season chain. Movies, specials
// and music videos are excluded — they don't belong in the episode grid.
const ANILIST_TV_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

function anilistTitle(media: any): string {
  // English title first, romaji fallback (AniList's own display order).
  const t = (media && media.title) || {};
  return t.english || t.romaji || t.native || "";
}

function anilistSeasonTitle(media: any): string {
  // Readable label for one season entry (used on the season cards).
  return anilistTitle(media).trim();
}

const ROMAN_TO_INT: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13,
};

// "Part 2" / "Part II" AND AniList's own "Cour 2" English display titles
// (Mushoku Tensei S1, SPY×FAMILY S1) both mark a split-cour continuation.
const PART_RE = /\b(?:part|cour)\s*(?:\d+|[ivx]+\b)/i;

function anilistExplicitSeason(titleLower: string): number | "final" | null {
  // The season identity a title states outright, or null. Returns a marker
  // ONLY for explicit season wording — "Season N", "Nth Season", a bare
  // ordinal ("2nd"), "final season", or a roman-numeral suffix
  // ("Overlord IV", "Sword Art Online II"). Returns null for arc/cour names
  // that carry no number (Bleach's TYBW cours), so those stay separate
  // seasons.
  if (titleLower.includes("final season") || titleLower.includes("the final")) return "final";
  let m = titleLower.match(/season\s+(\d+)/);
  if (m) return parseInt(m[1], 10);
  m = titleLower.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/);
  if (m) return parseInt(m[1], 10);
  m = titleLower.match(/\b(\d+)(?:st|nd|rd|th)\b/);
  if (m) return parseInt(m[1], 10);
  m = titleLower.match(/\b(i{1,3}|iv|v|vi{1,3}|ix|x{1,3})\b\s*$/);
  if (m) return ROMAN_TO_INT[m[1]] ?? null;
  return null;
}

function anilistHasPart(titleLower: string): boolean {
  // True when the title marks a continuation part — "Part 2", "Part II",
  // or AniList's English "Cour 2" display titles.
  return PART_RE.test(titleLower);
}

function anilistCover(media: any): string {
  const ci = (media && media.coverImage) || {};
  return ci.large || ci.medium || "";
}

type GroupResult =
  | [any, any, any, any, number | null, any]
  | [null, null, null, null, null, null];

type NextAiring = { anilist_id: number; season: number | null; episode: number | null; airingAt: number } | null;

/**
 * Pick the single currently-airing entry's next episode, if any. `season` is
 * the numbered season that entry maps to (null when merged into an earlier
 * part or outside the TMDB cap). Mirror of api/index.py `_anilist_next_airing`.
 */
export function anilistNextAiring(
  entries: any[],
  idsMap: Record<string, number> | null,
  segmentsMap: Record<string, any[]> | null = null
): NextAiring {
  // Season comes from the SEGMENTS first — a part merged into a season (e.g.
  // JoJo's Stone Ocean Part 2) belongs to that season even though idsMap only
  // knows the first part.
  const seasonOf = (mediaId: number): number | null => {
    for (const [k, segs] of Object.entries(segmentsMap ?? {})) {
      if ((segs ?? []).some((sg) => sg?.id === mediaId)) return Number(k);
    }
    const hit = Object.entries(idsMap ?? {}).find(([, v]) => v === mediaId);
    return hit ? Number(hit[0]) : null;
  };
  let best: NextAiring = null;
  for (const node of entries) {
    const nxt = node?.nextAiringEpisode ?? {};
    if (node?.status !== "RELEASING" || !nxt.airingAt) continue;
    if (best === null || nxt.airingAt < best.airingAt) {
      best = {
        anilist_id: node.id,
        season: seasonOf(node.id),
        episode: nxt.episode ?? null,
        airingAt: nxt.airingAt,
      };
    }
  }
  return best;
}

function anilistGroupSeasons(entries: any[], maxEpisodes: number | null): GroupResult {
  // Group watch-ordered AniList TV entries into real seasons.
  //
  // AniList stores every cour/part as its own entry ("Re:ZERO Season 2" and
  // "Re:ZERO Season 2 Part 2" are separate), so numbering each entry naively
  // turns one season into several. This merges consecutive entries that are
  // the SAME season split into parts:
  //   * an explicit season marker that matches the previous entry's
  //     ("Season 3" + "Season 3 Part 2"), and
  //   * a "Part N" continuation of the previous entry ("Mushoku Tensei" +
  //     "Mushoku Tensei Part 2").
  // Entries with NO marker and no "part" (Bleach's TYBW cours, each an arc
  // name) stay separate seasons.
  //
  // `maxEpisodes`, when given, is the TMDB entry's total episode budget: the
  // chain is cut once the episodes collected so far already COVER the budget,
  // so a sequel season that TMDB lists as a separate entry (or hasn't added
  // at all — "SAKAMOTO DAYS Season 2") never leaks into THIS entry's season
  // list. Crucially the cut happens ONLY at/after full coverage — not on the
  // entry that would merely PUSH the total past the budget: AniList counts
  // recap/prologue specials TMDB excludes (Mushoku Tensei II ships a
  // broadcast "episode 0", 13 vs TMDB's 12), and for a currently-airing tail
  // season that off-by-one would silently DROP the whole season (Mushoku
  // Tensei S3, SPY×FAMILY) from the season map → every HD embed slot for it
  // vanished. Keeping the partially-fitting tail is also self-consistent:
  // TMDB's own totals for THIS entry reach into it.
  const seasonsMap: Record<number, number> = {};
  const titlesMap: Record<number, string> = {};
  const idsMap: Record<number, number | null> = {};
  const postersMap: Record<number, string> = {};
  const segmentsMap: Record<number, any[]> = {};
  // Raw AniList episode counts per season: REAL number, or null when ANY
  // contributing entry reported no count (`episodes: null` → the 12
  // placeholder). The client uses this to tell a real 12-episode season
  // from a placeholder — a placeholder season with no AniList episode
  // collection must fall back to the full TMDB UI, not a dead 12-episode
  // shell (One Piece: entry 21 reports `episodes: null`).
  const rawCountsMap: Record<number, number | null> = {};
  let rootId: number | null = null;
  let seasonNo = 0;
  let currentKey: number | "final" | null = null;
  let totalEpisodes = 0;

  for (const node of entries) {
    if (!ANILIST_TV_FORMATS.has(node?.format)) continue;
    const titleLower = anilistTitle(node).toLowerCase();
    const key = anilistExplicitSeason(titleLower);
    const isPart = anilistHasPart(titleLower);
    const rawEps = node.episodes == null ? null : Number(node.episodes);
    const episodes = rawEps ?? 12;


    // Stop only once the chain has already covered this TMDB entry's own
    // total — everything past that point is a sequel season TMDB accounts
    // elsewhere (or not yet). Do NOT cut on overflow-while-adding: recaps /
    // prologue specials make AniList run slightly ahead of TMDB's counts,
    // and cutting there deletes currently-airing tail seasons. The first
    // season is always kept. A missing/zero budget means "no cap".
    if (maxEpisodes && seasonNo > 0 && totalEpisodes >= maxEpisodes) break;
    totalEpisodes += episodes;

    const appendSegment = (season: number, start: number) => {
      (segmentsMap[season] = segmentsMap[season] ?? []).push({
        id: node.id ?? null,
        start,
        count: episodes,
        title: anilistSeasonTitle(node),
      });
    };

    if (seasonNo === 0) {
      seasonNo = 1;
      currentKey = key;
      seasonsMap[1] = episodes;
      rawCountsMap[1] = rawEps;
      titlesMap[1] = anilistSeasonTitle(node);
      idsMap[1] = node.id ?? null;
      postersMap[1] = anilistCover(node);
      rootId = node.id ?? null;
      appendSegment(1, 1);
      continue;
    }

    // Same season, next part? Merge only when the entry belongs to the season
    // currently being built — matching explicit marker, or a bare "Part N" /
    // "Cour N" continuing the previous unnumbered entry.
    const merge = (key !== null && key === currentKey) || (isPart && key === null);
    if (merge) {
      seasonsMap[seasonNo] += episodes;
      rawCountsMap[seasonNo] =
        rawCountsMap[seasonNo] == null || rawEps == null ? null : rawCountsMap[seasonNo] + episodes;
      appendSegment(seasonNo, seasonsMap[seasonNo] - episodes + 1);
      continue;
    }

    seasonNo += 1;
    currentKey = key;
    seasonsMap[seasonNo] = episodes;
    rawCountsMap[seasonNo] = rawEps;
    titlesMap[seasonNo] = anilistSeasonTitle(node);
    idsMap[seasonNo] = node.id ?? null;
    postersMap[seasonNo] = anilistCover(node);
    appendSegment(seasonNo, 1);
  }

  if (Object.keys(seasonsMap).length === 0)
    return [null, null, null, null, null, null, null];
  return [seasonsMap, titlesMap, idsMap, postersMap, rootId, segmentsMap, rawCountsMap];
}

/**
 * Pick the candidate that IS the TMDB entry the user opened.
 * Score: exact title > year in title > start year == tmdb_year > TV format
 * > popularity (tie-break). Prevents the same-name-prequel trap (Hunter x
 * Hunter 1999 vs 2011): without it the 2011 page anchors on the 1999 series.
 * Mirror of api/index.py `_anilist_pick_anchor`.
 */
export function anilistPickAnchor(candidates: any[], title: string, tmdbYear: number | null): number | null {
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(title);
  let bestId: number | null = null;
  let bestScore: number | null = null;
  for (const m of candidates ?? []) {
    if (!m?.id) continue;
    let score = 0;
    const alTitle = anilistTitle(m).toLowerCase();
    if (norm(alTitle) === target) score += 100;
    if (tmdbYear && alTitle.includes(String(tmdbYear))) score += 80;
    if (tmdbYear && m?.startDate?.year === tmdbYear) score += 60;
    if (ANILIST_TV_FORMATS.has(m?.format)) score += 30;
    score += Math.min(15, Math.log10((m?.popularity || 0) + 1) * 5);
    if (bestScore === null || score > bestScore) {
      bestScore = score;
      bestId = m.id;
    }
  }
  return bestId;
}

// A chain entry belongs to THIS page only if it IS this franchise: its title
// shares a significant word (≥4 chars) with the reference title, or contains
// / is contained by it. Keeps same-name prequels (HxH 1999 → 2011), sequels
// ("NARUTO" → "NARUTO SHIPPUDEN") and cours/parts; drops related-but-OTHER
// works that AniList links as prequels/sequels — Oda's "MONSTERS: 103
// Mercies Dragon Damnation" one-shot ONA (1 ep, 2024) is linked PREQUEL to
// One Piece and used to hijack its Season 1 slot. An anchor with no
// significant words keeps the legacy (unfiltered) behaviour.
function sharesFranchiseTitle(a: any, b: any): boolean {
  const norm = (m: any) => anilistTitle(m).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const significant = (m: any) =>
    new Set(norm(m).split(" ").filter((w) => w.length >= 4 && !/^\d+$/.test(w)));
  const ta = norm(a);
  const tb = norm(b);
  if (ta && tb && (ta.includes(tb) || tb.includes(ta))) return true;
  const wa = significant(a);
  if (wa.size === 0) return true; // nothing to compare on — legacy behaviour
  const wb = significant(b);
  for (const w of wa) if (wb.has(w)) return true;
  return false;
}

export function anilistSeasonMapFromRelations(
  candidates: any[],
  maxEpisodes: number | null,
  anchorId: number | null = null
): GroupResult {
  // Number anime seasons by walking AniList SEQUEL/PREQUEL relations.
  //
  // TMDB often flattens every cours of an anime into one long season (Kaiju
  // No. 8 is a single 23-episode Season 1 there) while AniList keeps each
  // cours as a separate media entry. The sequel/prequel relation chain is
  // the reliable way to order those entries — title string parsing alone
  // misreads "Kaiju No. 8" as Season 8.
  //
  // Movies/OVAs/specials are kept in the graph (so a film like Demon
  // Slayer's "Mugen Train" can bridge two TV seasons) but are skipped when
  // numbering seasons — they never appear in the episode grid.
  const nodes: Record<number, any> = {};
  const add = (m: any) => {
    if (m && m.id) nodes[m.id] = nodes[m.id] ?? m;
  };

  // Two passes: candidates first so a full candidate ALWAYS beats an earlier
  // candidate's id-only relation stub (partial edge nodes must never replace
  // the real media object — that stripped format/episodes and silently
  // dropped the rest of the chain).
  for (const c of candidates) add(c);
  for (const c of candidates) {
    for (const edge of c?.relations?.edges ?? []) {
      if (edge?.relationType === "SEQUEL" || edge?.relationType === "PREQUEL") {
        add(edge.node ?? {});
      }
    }
  }

  if (Object.keys(nodes).length === 0) return [null, null, null, null, null, null, null];

  const sequelOf: Record<string, string[]> = {};
  const prequelOf: Record<string, string[]> = {};
  const link = (a: string, b: string) => {
    (sequelOf[a] = sequelOf[a] ?? []).push(b);
    (prequelOf[b] = prequelOf[b] ?? []).push(a);
  };

  for (const c of candidates) {
    const cid = c?.id;
    for (const edge of c?.relations?.edges ?? []) {
      const rel = edge?.relationType;
      if (rel !== "SEQUEL" && rel !== "PREQUEL") continue;
      const nid = edge?.node?.id;
      if (!nid || !(nid in nodes)) continue;
      if (rel === "SEQUEL") link(String(cid), String(nid));
      else link(String(nid), String(cid)); // PREQUEL — the node is the prequel of this candidate
    }
  }

  const episodesOf = (mid: string): number => {
    const m = nodes[mid] ?? {};
    if (!ANILIST_TV_FORMATS.has(m.format)) return 0;
    return Number(m.episodes) || 12;
  };

  let bestChain: string[] | null = null;
  if (anchorId !== null && String(anchorId) in nodes) {
    // Anchored chain (preferred): prequels that FIT this TMDB entry's budget
    // (oldest → newest), then the anchor, then its sequels. A same-name
    // prequel (HxH 1999 next to HxH 2011) overflows the 2011 budget and is
    // dropped, so the 2011 page can never number/stream the 1999 series.
    const anchor = String(anchorId);
    const seen = new Set([anchor]);
    let preChain: string[] = [];
    let cur = anchor;
    for (;;) {
      const p =
        (prequelOf[cur] ?? []).find(
          (x) => x in nodes && !seen.has(x) && sharesFranchiseTitle(nodes[x], nodes[anchor]),
        ) ?? null;
      if (p === null) break;
      seen.add(p);
      preChain.push(p);
      cur = p;
    }
    preChain = preChain.reverse(); // oldest → newest

    if (maxEpisodes) {
      let total = episodesOf(anchor);
      const kept: string[] = [];
      for (const p of [...preChain].reverse()) { // newest prequel first
        const eps = episodesOf(p);
        if (eps === 0) { kept.push(p); continue; }
        if (eps + total > maxEpisodes) continue;
        kept.push(p);
        total += eps;
      }
      preChain = kept.reverse();
    }

    bestChain = [...preChain, anchor];
    cur = anchor;
    for (;;) {
      const nxt =
        (sequelOf[cur] ?? []).find(
          (x) => x in nodes && !seen.has(x) && sharesFranchiseTitle(nodes[x], nodes[anchor]),
        ) ?? null;
      if (nxt === null) break;
      seen.add(nxt);
      bestChain.push(nxt);
      cur = nxt;
    }
  } else {
    // No anchor: legacy longest-chain-from-oldest-root walk.
    const roots = Object.keys(nodes).filter((mid) => !prequelOf[mid]);
    if (roots.length === 0) return [null, null, null, null, null, null, null];

    const startKey = (mid: string): [number, number, number] => {
      const d = nodes[mid]?.startDate ?? {};
      return [d.year ?? 9999, d.month ?? 99, d.day ?? 99];
    };

    roots.sort((a, b) => {
      const ka = startKey(a), kb = startKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
    });
    for (const root of roots) {
      const chain = [root];
      const seen = new Set([root]);
      let cur = root;
      for (;;) {
        let nxt: string | null = null;
        for (const s of sequelOf[cur] ?? []) {
          if (s in nodes && !seen.has(s) && sharesFranchiseTitle(nodes[s], nodes[root])) {
            nxt = s;
            break;
          }
        }
        if (nxt === null) break;
        seen.add(nxt);
        chain.push(nxt);
        cur = nxt;
      }
      if (bestChain === null || chain.length > bestChain.length) bestChain = chain;
    }
  }

  if (!bestChain) return [null, null, null, null, null, null, null];

  // Collect the TV entries in chain order (bridges like movies are traversed
  // but skipped), then merge same-season parts.
  const tvEntries = bestChain.map((mid) => nodes[mid]);
  return anilistGroupSeasons(tvEntries, maxEpisodes);
}

// Fetches clean, segmented season & episode counts from the AniList GraphQL
// API. `tmdbEpisodes` caps the AniList sequel chain so a sequel season that
// TMDB lists as a separate entry (or hasn't added) is never folded into this
// entry's seasons. Returns `{ status, body }` — the main.ts route wrapper
// turns it into HTTP; the browser fallback (src/utils/anilistDirect.js)
// consumes `body` directly, no Response needed.
export async function anilistMetadataJson(
  title: string,
  tmdbEpisodes: number | null = null,
  tmdbYear: number | null = null,
): Promise<{ status: number; body: any }> {

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  };

  const escapedTitle = title.replace(/"/g, '\\"');
  const query = `
  {
    Page(page: 1, perPage: 50) {
      media(search: "${escapedTitle}", type: ANIME) {
        id
        title {
          english
          romaji
          native
        }
        episodes
        format
        status
        popularity
        nextAiringEpisode {
          airingAt
          episode
        }
        startDate {
          year
          month
          day
        }
        coverImage {
          large
        }
        relations {
          edges {
            relationType
            node {
              id
              format
              episodes
              status
              nextAiringEpisode {
                airingAt
                episode
              }
              title {
                english
                romaji
              }
              coverImage {
                large
                medium
              }
            }
          }
        }
      }
    }
  }
  `;

  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(12000),
    });
    if (r.status !== 200) {
      // UPSTREAM failure (AniList's WAF answers 403 to some egress networks,
      // e.g. Cloudflare Workers; 429/5xx on outages). Answer 502 — never a
      // 200 {success:false} — so the frontend ladder (src/utils/edgeApi.js)
      // fails over to the next tier instead of treating it as a final "no
      // AniList data". App-level misses below stay 200.
      return { status: 502, body: { success: false, error: `AniList search failed: ${r.status}`, upstream_status: r.status } };
    }

    const data = (await r.json())?.data?.Page?.media ?? [];
    if (!data.length) {
      return { status: 200, body: { success: false, error: "No matches found on AniList" } };
    }

    // Filter out unrelated search hits by word overlap.
    const baseWords = new Set(title.toLowerCase().match(/[a-zA-Z0-9]+/g) ?? []);
    const stopWords = new Set(["the", "a", "of", "to", "and", "in", "season", "movie"]);
    let coreWords = new Set([...baseWords].filter((w) => !stopWords.has(w)));
    if (coreWords.size === 0) coreWords = baseWords;

    const candidates: any[] = [];
    for (const item of data) {
      const alTitle = anilistTitle(item);
      const alWords = new Set(alTitle.toLowerCase().match(/[a-zA-Z0-9]+/g) ?? []);
      let overlap = 0;
      for (const w of coreWords) if (alWords.has(w)) overlap++;
      if (overlap >= coreWords.size * 0.7) candidates.push(item);
    }

    if (!candidates.length) {
      return { status: 200, body: { success: false, error: "Title mismatch on AniList" } };
    }

    // Anime MOVIES (Your Name, A Silent Voice, …): the season-chain logic
    // below is TV-formats-only by design, so a movie-format best match never
    // produces a season map — and without `anilist_id` the player's
    // Sub/Dub embed slots have nothing to build URLs from and simply vanish.
    // Every embed host keys an anime movie as episode 1 of its AniList/MAL
    // entry, so the answer for a movie is just the entry id. Prefer the hit
    // whose year is closest to the TMDB release year (same-name cross-year
    // franchise protection, same spirit as the TV anchor).
    const hasTvCandidate = candidates.some((c) => ANILIST_TV_FORMATS.has(c?.format));
    if (!hasTvCandidate) {
      const movieHit =
        (tmdbYear !== null
          ? candidates.find((c) => c?.format === "MOVIE" && Math.abs((c?.startDate?.year ?? 0) - tmdbYear) <= 1)
          : null) ??
        candidates.find((c) => c?.format === "MOVIE") ??
        null;
      if (movieHit?.id) {
        return { status: 200, body: {
          success: true,
          movie: true,
          seasons: {},
          titles: {},
          anilist_ids: {},
          posters: {},
          segments: null,
          raw_counts: null,
          anilist_id: movieHit.id,
          title: anilistTitle(movieHit),
          next_airing: null,
        } };
      }
    }

    // OVA-only titles (Hellsing Ultimate = AniList 777 "HELLSING OVA", 10 eps):
    // no TV entry and not a movie, so both paths above and below produced
    // nothing — no anilist_id, and the Sub/Dub rows never rendered. Treat the
    // best OVA/SPECIAL/ONA match as a single-season show (the embed hosts key
    // it by its AniList id + episode like any TV entry). Closest episode count
    // to TMDB's wins, then popularity.
    if (!hasTvCandidate) {
      const ovaFormats = new Set(["OVA", "SPECIAL", "ONA", "TV_SHORT"]);
      const pool = candidates.filter((c) => ovaFormats.has(c?.format) && c?.id);
      if (pool.length) {
        const epsOf = (c: any) => (c?.episodes == null ? null : Number(c.episodes));
        pool.sort((x, y) => {
          if (tmdbEpisodes) {
            const dx = epsOf(x) == null ? 999 : Math.abs((epsOf(x) as number) - tmdbEpisodes);
            const dy = epsOf(y) == null ? 999 : Math.abs((epsOf(y) as number) - tmdbEpisodes);
            if (dx !== dy) return dx - dy;
          }
          return (y?.popularity || 0) - (x?.popularity || 0);
        });
        const pick = { ...pool[0], format: "TV" }; // run it through the normal season grouping
        const [sm, tm, im, pm, rid, segm, rawm] = anilistGroupSeasons([pick], null);
        if (sm && rid) {
          return { status: 200, body: {
            success: true,
            ova: true,
            seasons: sm,
            titles: tm,
            anilist_ids: im,
            posters: pm,
            segments: segm,
            raw_counts: rawm,
            anilist_id: rid,
            next_airing: null,
          } };
        }
      }
    }

    // 1) Preferred: order seasons via the sequel/prequel relation chain,
    //    anchored on the entry that IS this TMDB page (HxH 2011 must never
    //    anchor on the same-name 1999 series).
    const anchorId = anilistPickAnchor(candidates, title, tmdbYear);
    let [seasonsMap, titlesMap, idsMap, postersMap, anilistId, segmentsMap, rawCountsMap] =
      anilistSeasonMapFromRelations(candidates, tmdbEpisodes, anchorId);

    // Every node we know about (candidates + their sequel/prequel
    // neighbours) — the airing entry is usually a sequel of the searched
    // title, not the title itself.
    const allNodes = new Map<number, any>();
    for (const c of candidates) {
      if (c?.id && !allNodes.has(c.id)) allNodes.set(c.id, c);
      for (const edge of c?.relations?.edges ?? []) {
        const n = edge?.node ?? {};
        if ((edge?.relationType === "SEQUEL" || edge?.relationType === "PREQUEL") && n.id && !allNodes.has(n.id)) {
          allNodes.set(n.id, n);
        }
      }
    }

    // 2) Fallback: AniList relation data is missing — approximate the watch
    //    order by air date and group into seasons the same way.
    if (!seasonsMap) {
      const tvCandidates = candidates.filter((c) => ANILIST_TV_FORMATS.has(c?.format));
      tvCandidates.sort((a, b) => {
        const da = a?.startDate ?? {}, db = b?.startDate ?? {};
        return (
          (da.year ?? 9999) - (db.year ?? 9999) ||
          (da.month ?? 99) - (db.month ?? 99) ||
          (da.day ?? 99) - (db.day ?? 99)
        );
      });
      [seasonsMap, titlesMap, idsMap, postersMap, anilistId, segmentsMap, rawCountsMap] =
        anilistGroupSeasons(tvCandidates, tmdbEpisodes);
    }

    return { status: 200, body: {
      success: true,
      seasons: seasonsMap,
      titles: titlesMap,
      anilist_ids: idsMap,
      posters: postersMap,
      // Per-season AniList entry SEGMENTS (merged parts keep their
      // boundaries: [{id, start, count, title}]) — the player bridge uses
      // these to map (season, episode) to the RIGHT part id.
      segments: segmentsMap,
      // RAW per-season counts — null where AniList reported no count
      // (`episodes: null` → the 12 placeholder in `seasons`). A placeholder
      // season with no episode collection must fall back to the full TMDB
      // UI instead of rendering a dead 12-episode shell (One Piece, 21).
      raw_counts: rawCountsMap,
      anilist_id: anilistId,
      // "Next episode in …" — the RELEASING entry's upcoming airing.
      next_airing: anilistNextAiring([...allNodes.values()], idsMap, segmentsMap),
    } };
  } catch (e) {
    // Network/timeout on the way to AniList — transport-level, retry elsewhere.
    return { status: 502, body: { success: false, error: String(e) } };
  }
}

// ─── /api/anime-episodes — per-entry episode collection ────────────────────
// The anime UI takes its EPISODE data from AniList (episode number / title /
// thumbnail / airingAt): AniList's within-entry numbering is exactly what
// the embed hosts (zokoanime / megaplay / 4animo) key on, and the real
// collection also cures the `episodes: null → 12` placeholder that poisons
// long-runs like One Piece (entry 21 reports null but lists 1,100+ eps).
//
// EpisodeCollection is paginated at ≤25 per page and exposes NO total count,
// so we page until a short page: page 1 first (fast fail + no-episodes
// detection), then full pages in aliased GraphQL batches.
//
// Mirror of api/index.py `get_anime_episodes` — keep 1:1.

const EPISODES_PER_PAGE = 25;
const EPISODE_PAGE_BATCH = 10; // pages fetched concurrently
const EPISODE_PAGE_LIMIT = 200; // 5,000 episodes — more than any anime

async function anilistEpisodePages(
  anilistId: number,
  pages: number[],
): Promise<Array<{ status: number; episodes: any[] }>> {
  // GraphQL aliases let one HTTP request fetch a whole page batch. The old
  // implementation fired 10 independent POSTs per batch (52 requests for
  // One Piece), which was slow and readily rate-limited. This keeps the same
  // 25-item page semantics while reducing that case to seven HTTP requests.
  const fields = pages.map((page) => `
      p${page}: episodes(page: ${page}, perPage: ${EPISODES_PER_PAGE}) {
        number
        title
        thumbnail { large }
        airingAt
      }`).join("\n");
  const query = `{ Media(id: ${anilistId}, type: ANIME) { ${fields} } }`;
  const r = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(12000),
  });
  if (r.status !== 200) {
    return pages.map(() => ({ status: r.status, episodes: [] }));
  }
  const payload = await r.json();
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return pages.map(() => ({ status: 502, episodes: [] }));
  }
  const media = payload?.data?.Media || {};
  return pages.map((page) => ({
    status: 200,
    episodes: Array.isArray(media[`p${page}`]) ? media[`p${page}`] : [],
  }));
}

async function anilistEpisodePage(anilistId: number, page: number): Promise<{ status: number; episodes: any[] }> {
  return (await anilistEpisodePages(anilistId, [page]))[0];
}

/** Fetch only one 25-episode page for fast active-episode metadata. */
export async function anilistEpisodePageCollection(
  anilistId: number,
  page: number,
): Promise<{ status: number; body: any }> {
  try {
    const result = await anilistEpisodePage(anilistId, Math.max(1, Math.floor(page || 1)));
    if (result.status !== 200) {
      return {
        status: 502,
        body: { success: false, error: `AniList episodes failed: ${result.status}`, upstream_status: result.status },
      };
    }
    return { status: 200, body: { success: true, episodes: result.episodes } };
  } catch (e) {
    return { status: 502, body: { success: false, error: `AniList episodes failed: ${String(e)}` } };
  }
}

/**
 * Full episode list of one AniList entry: { success, count, episodes:
 * [{ number, title, thumbnail, airingAt }] } sorted by number.
 * 502 = upstream/transport failure (the ladder fails over); 200
 * {success:false} = definitive (entry has no episode records).
 */
export async function anilistEpisodeCollection(
  anilistId: number,
): Promise<{ status: number; body: any }> {
  try {
    const first = await anilistEpisodePage(anilistId, 1);
    if (first.status !== 200) {
      return {
        status: 502,
        body: { success: false, error: `AniList episodes failed: ${first.status}`, upstream_status: first.status },
      };
    }
    if (first.episodes.length === 0) {
      return { status: 200, body: { success: false, error: "No episode records on AniList for this entry" } };
    }

    let episodes = [...first.episodes];
    let page = 1;
    let stop = first.episodes.length < EPISODES_PER_PAGE;
    // Page 2 SOLO first: most anime are ≤50 episodes (2 pages) — batching
    // here would over-fetch 9 dead pages for the common short collection.
    if (!stop && page < EPISODE_PAGE_LIMIT) {
      const res = await anilistEpisodePage(anilistId, page + 1);
      if (res.status !== 200) {
        return {
          status: 502,
          body: { success: false, error: `AniList episodes failed: ${res.status}`, upstream_status: res.status },
        };
      }
      episodes = episodes.concat(res.episodes);
      page += 1;
      stop = res.episodes.length < EPISODES_PER_PAGE;
    }
    // Long-runs: full pages in aliased GraphQL batches.
    while (!stop && page < EPISODE_PAGE_LIMIT) {
      const batchEnd = Math.min(page + EPISODE_PAGE_BATCH, EPISODE_PAGE_LIMIT);
      const pages = Array.from({ length: batchEnd - page }, (_, i) => page + 1 + i);
      const results = await anilistEpisodePages(anilistId, pages);
      for (const res of results) {
        if (res.status !== 200) {
          return {
            status: 502,
            body: { success: false, error: `AniList episodes failed: ${res.status}`, upstream_status: res.status },
          };
        }
        episodes = episodes.concat(res.episodes);
        page += 1;
        if (res.episodes.length < EPISODES_PER_PAGE) stop = true;
      }
    }

    // De-dup by number + sort (the collection is normally already ordered).
    const byNumber = new Map<number, any>();
    for (const ep of episodes) {
      if (ep && ep.number != null) byNumber.set(ep.number, ep);
    }
    const list = [...byNumber.values()].sort((a, b) => a.number - b.number);
    return {
      status: 200,
      body: { success: true, count: list.length, episodes: list },
    };
  } catch (e) {
    // Network/timeout on the way to AniList — transport-level, retry elsewhere.
    return { status: 502, body: { success: false, error: `AniList episodes failed: ${String(e)}` } };
  }
}
//
// Powers the /schedule page. The browser NEVER talks to graphql.anilist.co
// directly (Indian ISPs DNS-block upstreams — LESSONS-LEARNED #12); this route
// fans the week out server-side and returns a trimmed, cacheable payload.
// Zero TMDB quota is spent: cards render from AniList ids/covers only.
//
// Query: start=<unix seconds> end=<unix seconds> — the client passes the
// visitor's LOCAL week (Mon 00:00 → next Mon 00:00). Defaults (current UTC
// week) are computed only when a bound is missing/invalid. The window is
// clamped to 14 days so a hostile query can't page through months.
// Mirror of api/index.py `get_anime_schedule` — keep 1:1.

const SCHEDULE_FORMATS = new Set(["TV", "TV_SHORT", "ONA", "MOVIE"]);
const SCHEDULE_MAX_PAGES = 4;
const SCHEDULE_PER_PAGE = 50;
const SCHEDULE_MAX_WINDOW_S = 14 * 86400;
const SCHEDULE_QUERY = `
query ($page: Int, $perPage: Int, $start: Int, $end: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      id
      airingAt
      episode
      media {
        id
        title { english romaji }
        coverImage { large }
        bannerImage
        format
        isAdult
        startDate { year }
      }
    }
  }
}
`;

/** Current UTC week: Monday 00:00 UTC → next Monday 00:00 UTC. */
export function scheduleDefaultWindow(nowS: number): [number, number] {
  const dayStart = nowS - (nowS % 86400);
  // 1970-01-01 was a Thursday → weekday index with Monday = 0.
  const weekday = (Math.floor(dayStart / 86400) + 3) % 7;
  const start = dayStart - weekday * 86400;
  return [start, start + 7 * 86400];
}

export function scheduleWindow(
  startRaw: number | null,
  endRaw: number | null,
  nowS: number,
): [number, number] {
  const startOk = Number.isInteger(startRaw) && (startRaw as number) > 0;
  const endOk = Number.isInteger(endRaw) && (endRaw as number) > 0;
  let start: number;
  let end: number;
  if (startOk && endOk && (endRaw as number) > (startRaw as number)) {
    start = startRaw as number;
    end = endRaw as number;
  } else {
    const [dStart] = scheduleDefaultWindow(nowS);
    start = startOk ? (startRaw as number) : dStart;
    end = endOk && (endRaw as number) > start ? (endRaw as number) : start + 7 * 86400;
  }
  if (end - start > SCHEDULE_MAX_WINDOW_S) end = start + SCHEDULE_MAX_WINDOW_S;
  return [start, end];
}

/** Trim one AniList airingSchedule node; null when it must be dropped. */
export function scheduleTrim(entry: any): any | null {
  const media = entry?.media ?? {};
  if (media.isAdult) return null;
  if (!SCHEDULE_FORMATS.has(media.format)) return null;
  if (!media.id || !entry?.airingAt) return null;
  const title = media.title ?? {};
  // Trimmed deliberately — mirror of `_schedule_trim` in api/index.py: the
  // client reads id, airingAt, episode and media{id, title, cover, banner,
  // format, startDate} only. idMal + the AniList episode total are dead
  // weight on up to 200 rows.
  return {
    id: entry.id ?? null,
    airingAt: entry.airingAt,
    episode: entry.episode ?? null,
    media: {
      id: media.id,
      title: { english: title.english ?? null, romaji: title.romaji ?? null },
      coverImage: { large: media.coverImage?.large ?? null },
      bannerImage: media.bannerImage ?? null,
      format: media.format ?? null,
      startDate: { year: media.startDate?.year ?? null },
    },
  };
}

/** Flatten + trim + dedupe (by schedule id) + sort the paged responses. */
export function scheduleCollect(pages: any[][]): any[] {
  const seen = new Set<number>();
  const items: any[] = [];
  for (const page of pages) {
    for (const entry of page ?? []) {
      const trimmed = scheduleTrim(entry);
      if (trimmed === null || seen.has(trimmed.id)) continue;
      seen.add(trimmed.id);
      items.push(trimmed);
    }
  }
  items.sort((a, b) => a.airingAt - b.airingAt || (a.id ?? 0) - (b.id ?? 0));
  return items;
}
/**
 * Pages AniList (max SCHEDULE_MAX_PAGES) for the window. `fetchImpl` is
 * injectable so the node-level harness can mock graphql.anilist.co.
 */
export async function fetchAnimeSchedule(
  startS: number,
  endS: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: true; start: number; end: number; items: any[] } | { success: false; error: string }> {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  };
  const pages: any[][] = [];
  try {
    for (let pageNo = 1; pageNo <= SCHEDULE_MAX_PAGES; pageNo++) {
      const r = await fetchImpl("https://graphql.anilist.co", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: SCHEDULE_QUERY,
          variables: {
            page: pageNo,
            perPage: SCHEDULE_PER_PAGE,
            // AniList's *_greater / *_lesser are strict; widen by 1s so an
            // episode airing exactly at Mon 00:00 is kept.
            start: startS - 1,
            end: endS,
          },
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status !== 200) {
        if (pages.length) break; // keep what we have — partial week beats an error
        return { success: false, error: `AniList schedule failed: ${r.status}` };
      }
      const page = (await r.json())?.data?.Page ?? {};
      pages.push(page.airingSchedules ?? []);
      if (!page.pageInfo?.hasNextPage) break;
    }
  } catch (e) {
    if (!pages.length) return { success: false, error: String(e) };
  }
  return { success: true, start: startS, end: endS, items: scheduleCollect(pages) };
}
// ─────────────────────────────────────────────────────────────────────────────
// /api/anime-trending — Top 10 Anime This Week (AniList trending)
//
// The Anime hub's "Top 10 Anime This Week" row is sourced from AniList's own
// TRENDING_DESC ranking, NOT from TMDB popularity. Mirror of the FastAPI
// route (api/index.py). Same rule as every AniList route: the browser never
// touches graphql.anilist.co; non-200 / transport failure → 502 so the
// frontend ladder fails over. Cards render from AniList covers; the TMDB id
// is resolved client-side on click (al2tmdb memo — zero TMDB quota on render).
// ─────────────────────────────────────────────────────────────────────────────
const TRENDING_QUERY = `query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, isAdult: false, sort: [TRENDING_DESC]) {
      id
      title { english romaji native }
      coverImage { extraLarge large }
      bannerImage
      averageScore
      popularity
      format
      episodes
      startDate { year month day }
      nextAiringEpisode { airingAt episode }
    }
  }
}`;
const TRENDING_PER_PAGE = 12;

export function trendingTrim(media: any): Record<string, unknown> | null {
  // Trim one AniList trending media node; null when it must be dropped.
  if (!media || typeof media !== "object") return null;
  if (media.isAdult) return null;
  if (!media.id) return null;
  const title = media.title ?? {};
  const cover = media.coverImage ?? {};
  const start = media.startDate ?? {};
  const nga = media.nextAiringEpisode ?? {};
  // Trimmed deliberately — mirror of `_trending_trim` in api/index.py:
  // idMal / seasonYear / status / genres are never read by the anime hub.
  return {
    id: media.id,
    title: { english: title.english ?? null, romaji: title.romaji ?? null, native: title.native ?? null },
    coverImage: { extraLarge: cover.extraLarge ?? null, large: cover.large ?? null },
    bannerImage: media.bannerImage ?? null,
    averageScore: media.averageScore ?? null,
    popularity: media.popularity ?? null,
    format: media.format ?? null,
    episodes: media.episodes ?? null,
    startDate: { year: start.year ?? null, month: start.month ?? null, day: start.day ?? null },
    nextAiringEpisode: { airingAt: nga.airingAt ?? null, episode: nga.episode ?? null },
  };
}

/** Injectable so the node-level harness can mock graphql.anilist.co. */
export async function fetchAnimeTrending(
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: true; source: "anilist"; items: any[] } | { success: false; error: string }> {
  try {
    const r = await fetchImpl("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      body: JSON.stringify({ query: TRENDING_QUERY, variables: { page: 1, perPage: TRENDING_PER_PAGE } }),
      signal: AbortSignal.timeout(12000),
    });
    if (r.status !== 200) return { success: false, error: `AniList trending failed: ${r.status}` };
    const page = (await r.json())?.data?.Page ?? {};
    const items = (page.media ?? []).map(trendingTrim).filter(Boolean);
    return { success: true, source: "anilist", items };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
