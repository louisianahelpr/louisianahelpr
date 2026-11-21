#!/usr/bin/env node
/**
 * Writes src/content/giftGuideEarnRank.json: each gift-guide shop link's click rank over the last 14 days, from our own
 * outbound click log (public.analytics_events_real, event "gift_out_click", sent by
 * src/pages/info/giftGuides/GiftOut.tsx; the view already drops robot and seed-account rows). Rank 1 = most clicks;
 * ties break by link so a re-run on the same data writes the same file. The page reads it through
 * src/content/giftGuideEarnOrder.ts (clicked picks first inside their price section on the default order).
 *
 * Sales are not in it: no affiliate network's report is connected to the repo, so nothing here claims a purchase.
 *
 * Re-run weekly (lead 11-21; no cron was added), from a worktree cut from origin/main, then commit the JSON:
 *   node scripts/gift-guide-earn-rank.mjs                 # prod, read-only: Management API, or `supabase db query --linked`
 *   node scripts/gift-guide-earn-rank.mjs --from rows.json # offline: [{ "href": "...", "clicks": 3 }, ...]
 *   node scripts/gift-guide-earn-rank.mjs --dry-run       # print, write nothing
 * Env (prod read): SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF, else the linked Supabase CLI.
 * Guard: src/test/giftGuideEarnOrder1121.test.tsx.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

export const WINDOW_DAYS = 14;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/content/giftGuideEarnRank.json");

export const CLICKS_SQL = `
SELECT properties->>'href' AS href, count(*)::int AS clicks
  FROM public.analytics_events_real
 WHERE event = 'gift_out_click'
   AND created_at > now() - interval '${WINDOW_DAYS} days'
   AND properties->>'href' LIKE 'https://%'
 GROUP BY 1
 ORDER BY 2 DESC, 1
 LIMIT 5000`;

/** [{ href, clicks }] -> { href: rank }, most clicks first, ties by link; non-https or zero-click rows dropped. */
export function rankFromClicks(rows) {
  const ok = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ href: String(r?.href ?? ""), clicks: Number(r?.clicks) || 0 }))
    .filter((r) => /^https:\/\/[^\s"'<>]+$/.test(r.href) && r.href.length <= 600 && r.clicks > 0);
  const best = new Map();
  for (const r of ok) best.set(r.href, (best.get(r.href) ?? 0) + r.clicks);
  const sorted = [...best].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.fromEntries(sorted.map(([href], i) => [href, i + 1]));
}

export function fileBody(ranks, day) {
  return `${JSON.stringify({ generated: day, windowDays: WINDOW_DAYS, source: "analytics_events_real gift_out_click (scripts/gift-guide-earn-rank.mjs)", ranks }, null, 2)}\n`;
}

async function liveRows() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: CLICKS_SQL, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  const { supabaseDbQuery } = await import("./lib/supabaseDbQuery.mjs");
  const out = supabaseDbQuery(["--linked", "-o", "json", CLICKS_SQL], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  const json = JSON.parse(out.slice(out.search(/[[{]/)));
  return json.rows ?? json;
}

async function main(argv) {
  const from = argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : null;
  const rows = from ? JSON.parse(readFileSync(from, "utf8")) : await liveRows();
  if (!Array.isArray(rows)) throw new Error("click rows: expected an array");
  const ranks = rankFromClicks(rows);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const body = fileBody(ranks, day);
  if (argv.includes("--dry-run")) process.stdout.write(body);
  else writeFileSync(OUT, body);
  console.error(`gift-guide-earn-rank: ${rows.length} row(s) read, ${Object.keys(ranks).length} link(s) ranked${argv.includes("--dry-run") ? " (dry run)" : ` -> ${OUT}`}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`gift-guide-earn-rank: ${e.message}`);
    process.exit(1);
  });
}
