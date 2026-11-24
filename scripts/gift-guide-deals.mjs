#!/usr/bin/env node
/**
 * The deals page's data (owner 2026-11-21: "we still need to do the black friday section, small business saturday, and
 * cyber monday deals"; "Codes and deals shouldn't randomly show in sections"). Reads the checked deals in
 * scripts/gift-guide-deals-1121.json (each one read on the brand's own site, or named by the brand's Amazon Creator
 * Connections campaign, with its source, day and the words seen) and writes src/content/giftGuideDeals.json:
 *   - each deal in its event (Black Friday or Cyber Monday; Small Business Saturday is the 25 Days sponsors' file,
 *     src/content/giftGuideSmallBiz.json), each event sorted by our commission, high to low, then brand;
 *   - at most DEALS_PER_BRAND deals per brand across the page; never a price; an Amazon link carries our tag;
 *   - a photo with a background shows its cutout (public/gift-guides/deals/cutouts/<key>.webp, made by
 *     scripts/gift-guide-deals-cutouts.py, listed in scripts/gift-guide-deals-cutouts.json); Amazon photos never.
 * The commission, source, day checked and words seen stay in the source file: the shipped JSON carries only the order.
 * The 11-19 generator (lead's Desktop files, category sections) is replaced: its deals were re-read 2026-11-21 and only
 * the ones still shown on the brand's site came across.
 * Registered in scripts/check-generated-current.mjs (gift-guide-deals). Guard: src/test/giftGuideDeals1119.test.tsx.
 *
 *   node scripts/gift-guide-deals.mjs            write the file
 *   node scripts/gift-guide-deals.mjs --dry      print only
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEAL_EVENTS, DEALS_PER_BRAND } from "../src/content/giftGuideDeals.mjs";

const REPO = resolve(import.meta.dirname, "..");
const SRC = join(REPO, "scripts/gift-guide-deals-1121.json");
const CUTOUTS = join(REPO, "scripts/gift-guide-deals-cutouts.json");
const OUT = join(REPO, "src/content/giftGuideDeals.json");
const CUTOUT_PATH = "/gift-guides/deals/cutouts/";

// mavely.app.link: our Later (Mavely) links (bf-page-1124: Macy's/Target/Kohl's and the other Later-only Black Friday stores).
const AFFILIATE_HOSTS = new Set(["go.shopmy.us", "www.amazon.com", "www.anrdoezrs.net", "click.linksynergy.com", "mavely.app.link"]);
const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    // Not a URL: no host, so the check below refuses it.
    return "";
  }
};

/** The page's deals from the checked source rows; throws on a row that breaks a rule. */
export function buildDeals(rows, cutouts = {}) {
  const perBrand = new Map();
  const kept = [];
  for (const r of rows) {
    const events = DEAL_EVENTS.filter((e) => e.kind === "deals").map((e) => e.id);
    if (!events.includes(r.event)) throw new Error(`gift-guide-deals: ${r.brand}: unknown event ${r.event}`);
    if (!AFFILIATE_HOSTS.has(host(r.href)) || !r.href.startsWith("https://")) throw new Error(`gift-guide-deals: ${r.brand}: not one of our affiliate links: ${r.href}`);
    const amazon = host(r.href) === "www.amazon.com";
    if (amazon && new URL(r.href).searchParams.get("tag") !== "louisianahelpr-20") throw new Error(`gift-guide-deals: ${r.brand}: Amazon link without our tag`);
    if ("price" in r) throw new Error(`gift-guide-deals: ${r.brand}: a price never ships`);
    if (!r.source || !r.checked || !r.seen) throw new Error(`gift-guide-deals: ${r.brand}: needs source, checked and seen`);
    const n = (perBrand.get(r.brand) ?? 0) + 1;
    if (n > DEALS_PER_BRAND) throw new Error(`gift-guide-deals: ${r.brand}: more than ${DEALS_PER_BRAND} deals`);
    perBrand.set(r.brand, n);
    const key = !amazon && r.image ? cutouts[r.image] : undefined;
    kept.push({
      commission: Number(r.commission) || 0,
      deal: {
        event: r.event,
        brand: r.brand,
        deal: r.deal,
        href: r.href,
        ...(r.image ? { image: key ? `${CUTOUT_PATH}${key}.webp` : r.image } : {}),
        ...(r.item ? { item: r.item } : {}),
        ...(r.code ? { code: r.code } : {}),
        ...(r.starts ? { starts: r.starts } : {}),
        ...(r.ends ? { ends: r.ends } : {}),
        status: r.status === "announced" ? "announced" : "live",
        ...(amazon ? { store: "Amazon" } : {}),
      },
    });
  }
  const order = DEAL_EVENTS.map((e) => e.id);
  return kept
    .sort((a, b) => order.indexOf(a.deal.event) - order.indexOf(b.deal.event) || b.commission - a.commission || a.deal.brand.localeCompare(b.deal.brand))
    .map((k) => k.deal);
}

/** The file's exact text: one deal per line, so a change reads as a small diff. */
export const dealsText = (deals) => `[\n${deals.map((d) => JSON.stringify(d)).join(",\n")}\n]\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = JSON.parse(readFileSync(SRC, "utf8")).deals;
  const cutouts = existsSync(CUTOUTS) ? JSON.parse(readFileSync(CUTOUTS, "utf8")).cutouts : {};
  const deals = buildDeals(rows, cutouts);
  for (const e of DEAL_EVENTS) console.log(`${e.id}: ${deals.filter((d) => d.event === e.id).length}`);
  if (!process.argv.includes("--dry")) writeFileSync(OUT, dealsText(deals));
}
