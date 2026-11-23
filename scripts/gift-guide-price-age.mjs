#!/usr/bin/env node
/**
 * How old the live gift guides' prices are (holiday audit 1121, High: "Every price disappears on Wed Nov 25").
 * Prices are re-imported by hand (~/Desktop/Link-library fill_prices.py, then scripts/gift-guide-picks.mjs); nothing
 * refreshes them on a schedule. The page shows a price for 30 days after its check (src/components/giftGuides/
 * PickPrice.tsx), with a "Prices as of <day>" note. This prints each live guide's newest and oldest check day and its
 * unpriced count, and exits 1 once the newest check is MAX_AGE_DAYS or more old (or a pick has no price), so a sweep
 * (the lead's hourly cron) notices the refresh is due long before anything hides.
 * Usage: node scripts/gift-guide-price-age.mjs [--today YYYY-MM-DD]
 */
import { readFileSync } from "node:fs";
import { LIVE_GUIDES_1121 } from "../src/content/giftGuideLive.mjs";
import { isOwnerList } from "../src/content/giftGuidePeople.mjs";

const MAX_AGE_DAYS = 2;
const arg = process.argv.indexOf("--today");
const today = arg > 0 ? process.argv[arg + 1] : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const dayNumber = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / 86400000;

let stale = false;
// The owner's own lists (Her, Him, Kids), where every pick carries a price (owner 2026-11-21).
for (const slug of LIVE_GUIDES_1121.filter((s) => isOwnerList(s))) {
  let picks;
  try {
    picks = JSON.parse(readFileSync(new URL(`../src/content/giftGuidePicks/${slug}.json`, import.meta.url), "utf8")).picks;
  } catch {
    // A live slug with no picks file (a deals or sponsors page) has no prices to age.
    continue;
  }
  const days = picks.map((p) => p.priceAt).filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const unpriced = picks.filter((p) => !(typeof p.price === "number" && p.price > 0) || !p.priceAt).length;
  const newest = days.at(-1);
  const age = newest ? dayNumber(today) - dayNumber(newest) : Infinity;
  const bad = age >= MAX_AGE_DAYS || unpriced > 0;
  stale ||= bad;
  console.log(`${bad ? "STALE" : "ok   "} ${slug}: ${picks.length} picks, newest check ${newest ?? "none"} (${age} days), oldest ${days[0] ?? "none"}, unpriced ${unpriced}`);
}
if (stale) console.log(`Refresh due: re-read prices, then append same-price re-checks to scripts/giftGuidePriceRecheck.mjs and set priceAt in the picks JSON (never re-run gift-guide-picks.mjs; prices hide 30 days after their check).`);
process.exit(stale ? 1 : 0);
