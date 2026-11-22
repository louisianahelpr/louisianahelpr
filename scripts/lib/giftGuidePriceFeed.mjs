/**
 * The gift guides' price feed (saved-gift price alerts, owner 2026-11-21): every guide pick that carries a checked
 * price, keyed by its shop link, built from src/content/giftGuidePicks/*.json (the daily price train's output) and
 * written by the build as dist/gift-guides/price-feed.json (vite.config.ts, plugin lh-gift-price-feed). The
 * gift-price-alerts edge function reads it from the live site each day, so the prices it compares are exactly the
 * ones the deployed guides show.
 *
 * A link in more than one guide takes the price with the newest check day (priceAt); on a tie, the first file in
 * name order. Only https links and prices above zero go in. Guard: src/test/giftPriceAlerts.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const PRICE_FEED_FILE = "gift-guides/price-feed.json";

/** @param {string} picksDir @returns {{ v: 1, items: Record<string, { price: number, at: string, name: string, image?: string, guide: string }> }} */
export function buildPriceFeed(picksDir) {
  /** @type {Record<string, { price: number, at: string, name: string, image?: string, guide: string }>} */
  const items = {};
  for (const file of readdirSync(picksDir).filter((f) => f.endsWith(".json")).sort()) {
    const guide = file.replace(/\.json$/, "");
    const data = JSON.parse(readFileSync(path.join(picksDir, file), "utf8"));
    for (const p of Array.isArray(data?.picks) ? data.picks : []) {
      if (typeof p?.href !== "string" || !/^https:\/\//.test(p.href)) continue;
      if (typeof p.price !== "number" || !(p.price > 0) || typeof p.priceAt !== "string") continue;
      const prev = items[p.href];
      if (prev && prev.at >= p.priceAt) continue;
      items[p.href] = {
        price: p.price,
        at: p.priceAt,
        name: String(p.name ?? ""),
        ...(typeof p.image === "string" && /^https:\/\//.test(p.image) ? { image: p.image } : {}),
        guide: typeof p.from === "string" && /^[a-z0-9-]{1,60}$/.test(p.from) ? p.from : guide,
      };
    }
  }
  return { v: 1, items };
}
