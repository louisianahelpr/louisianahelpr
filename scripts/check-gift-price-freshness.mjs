#!/usr/bin/env node
/**
 * Gift guide price freshness (holiday audit D M4, 11-20). A pick shows its checked price for PRICE_MAX_AGE_DAYS (3)
 * after the check (src/components/giftGuides/PickPrice.tsx showsPrice), then hides it: a stale price is never shown.
 * The prices are checked on the owner's Mac (~/Desktop/Link-library/fill_prices.py; Walmart needs a Chrome step), so
 * no CI job can refresh them; they reach the site only when a train re-runs scripts/gift-guide-picks.mjs and lands.
 * Without this check, a week with no train would silently empty every price on the site.
 *
 * Read from the committed picks (src/content/giftGuidePicks/*.json), it fails when the NEWEST priceAt is
 * WARN_AGE_DAYS (2) or more days old in Louisiana: the prices hide the day after next, so a train with a fresh price
 * pass is due now. staleness-watch.yml runs it every morning (06:20 Central) and a red run opens the
 * `nightly-red: staleness-watch` issue, which every session start reads. Also fails when no pick carries a price at
 * all (the import dropped them, or every price already hid).
 *
 *   node scripts/check-gift-price-freshness.mjs            # exit 1 when the prices are about to hide
 *   node scripts/check-gift-price-freshness.mjs --today 2026-11-22
 *
 * Guard: src/test/giftPriceFreshness.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRICE_MAX_AGE_DAYS } from "./giftGuidePrice.mjs";

export const WARN_AGE_DAYS = PRICE_MAX_AGE_DAYS - 1;
const dayNumber = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / 86400000;
export const louisianaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

/** The freshness of a set of priceAt days: { ok, newest, age, shown, message }. Pure. */
export function priceFreshness(priceAts, today) {
  const days = priceAts.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (days.length === 0) return { ok: false, newest: null, age: null, shown: 0, message: "No gift guide pick carries a checked price. Run the price pass (fill_prices.py) and a gift-guide train." };
  const newest = days.reduce((a, b) => (a > b ? a : b));
  const age = Math.round(dayNumber(today) - dayNumber(newest));
  const shown = days.filter((d) => { const a = dayNumber(today) - dayNumber(d); return a >= 0 && a <= PRICE_MAX_AGE_DAYS; }).length;
  const ok = age < WARN_AGE_DAYS;
  const message = ok
    ? `Gift guide prices are current: newest check ${newest} (${age}d old), ${shown} of ${days.length} priced picks showing.`
    : `Gift guide prices are ${age} day(s) old (newest check ${newest}); they hide after ${PRICE_MAX_AGE_DAYS} days, ${shown} of ${days.length} still showing. Run the price pass (~/Desktop/Link-library/fill_prices.py, Walmart Chrome step) and land a gift-guide train.`;
  return { ok, newest, age, shown, message };
}

/** Every priceAt in the committed picks. */
export function committedPriceAts(root) {
  const dir = join(root, "src/content/giftGuidePicks");
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const p of data.picks ?? []) if (p.priceAt) out.push(p.priceAt);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const t = args.indexOf("--today");
  const today = t >= 0 ? args[t + 1] : louisianaToday();
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const r = priceFreshness(committedPriceAts(root), today);
  if (r.ok) console.log(r.message);
  else {
    console.error(`::error::${r.message}`);
    process.exit(1);
  }
}
