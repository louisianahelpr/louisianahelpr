#!/usr/bin/env node
/**
 * Gift-guide picks loader (lead 2026-11-18, follow-up batch 11-18 PM): turns the researched picks in
 * ~/Desktop/Gift-guide-picks into src/content/giftGuidePicks.ts, the generated file src/content/giftGuideCatalog.ts
 * reads. Re-runnable: every run re-reads every file, so links added on the Desktop flow in on the next run.
 * Usage: node scripts/gift-guide-picks.mjs [<picks dir>]
 *
 * Read:
 *   - <slug>.json: one guide's picks, in order (store-<x>.json is a store page's own "Louisiana Helpr Picks");
 *   - extras with a `fits` list of guide slugs: _awin.json, _later.json, _later-mylinks.json (every Later link), _later-brands.json;
 *   - store extras: _xtratuf.json, _warby-parker.json (+ Her/Him/Coworkers/RNs/Teens), _walmart.json,
 *     _tiktok-shop.json, _amazon-trending.json, _amazon-bounties.json (Prime/Audible/registries);
 *   - deal sections: _store-deal-sections.json, _walmart-collections.json, _amazon-hub.json, _later-deals.json,
 *     _later-promos.json (each hidden after its end date, on the page).
 *
 * LINK RULE (owner 2026-11-18): a pick links to its `affiliate_href` when it has one. Otherwise its plain `href` is
 * used only on a host that needs no affiliate link (Amazon with tag=louisianahelpr-20, ShopMy, the Louisiana shops,
 * the sponsors and BRAND_SITES); any other pick stays HIDDEN until its affiliate link exists. Every link must be https
 * on an allowlisted host (AFFILIATE_HOSTS + those) and no text may carry a price ("$" + digit): a pick that breaks a
 * rule is hidden and listed, never shown unchecked.
 * PHOTOS FIRST (owner 11:35 AM): within each guide, picks with a real product photo come first, the order inside each
 * group kept.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = process.argv[2] ?? join(homedir(), "Desktop", "Gift-guide-picks");
const out = new URL("../src/content/giftGuidePicks.ts", import.meta.url);
const content = readFileSync(new URL("../src/content/giftGuides.ts", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../src/content/giftGuideIndex.ts", import.meta.url), "utf8");
const listed = (name) => [...(content.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const AMAZON = new Set(["www.amazon.com", "amazon.com", "amzn.to"]);
const LOUISIANA = new Set(listed("LOUISIANA_SHOPS"));
const SPONSORS = new Set(listed("SPONSOR_SITES"));
const BRANDS = new Set(listed("BRAND_SITES"));
/** Hosts a plain (non-affiliate) link may use. */
const PLAIN_OK = new Set([...AMAZON, "shopmy.us", ...LOUISIANA, ...SPONSORS, ...BRANDS]);
const AFFILIATE = new Set([...listed("AFFILIATE_HOSTS"), ...AMAZON, "shopmy.us"]);

const readJson = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null);

/** The guide slugs and store-page titles on the owner's list (giftGuideIndex.ts). */
const INDEX = [...indexSrc.matchAll(/slug: "([^"]+)", title: "([^"]+)"/g)].map((m) => ({ slug: m[1], title: m[2] }));
const GUIDE_SLUGS = new Set(INDEX.map((g) => g.slug));
const compact = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const STORE_BY_COMPACT = new Map(INDEX.filter((g) => g.slug.startsWith("store-")).flatMap((g) => [[compact(g.title), g], [compact(g.slug.slice(6)), g]]));
const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cleanName = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(US|USA)$/, "").trim();
const domainCore = (d) => d.replace(/^(www|shop|us)\./, "").replace(/\.(com|us|co|net|org)(\.[a-z]+)?$/, "");

/** Every store page a pick belongs to: slug -> name (and the hosts its links use, filled below). */
const stores = new Map();
const storeFor = (raw) => {
  if (!raw) return null;
  const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw);
  const name = isDomain ? domainCore(raw) : cleanName(raw);
  const hit = STORE_BY_COMPACT.get(compact(name));
  const slug = hit?.slug ?? `store-${slugify(name)}`;
  const title = hit?.title ?? (isDomain ? name.charAt(0).toUpperCase() + name.slice(1) : name);
  if (!stores.has(slug)) stores.set(slug, { name: title, hosts: new Set() });
  return slug;
};

const hidden = [];
/** One raw pick -> the page's pick, or null (hidden: the reason is listed). */
function toPick(p, where) {
  const href = p.affiliate_href || p.href;
  let url;
  try {
    url = new URL(href);
  } catch {
    hidden.push(`${where}: bad link ${href}`);
    return null;
  }
  const host = url.hostname;
  const isAffiliate = Boolean(p.affiliate_href);
  if (url.protocol !== "https:") return hidden.push(`${where}: ${href} is not https`), null;
  if (isAffiliate ? !AFFILIATE.has(host) : !PLAIN_OK.has(host)) return hidden.push(`${where}: ${p.name} has no affiliate link yet (${host})`), null;
  if (AMAZON.has(host) && host !== "amzn.to" && url.searchParams.get("tag") !== "louisianahelpr-20") return hidden.push(`${where}: ${href} lacks tag=louisianahelpr-20`), null;
  for (const v of [p.name, p.line]) if (/\$\s?\d/.test(v ?? "")) return hidden.push(`${where}: price in "${v}"`), null;
  const plainHost = (() => { try { return new URL(p.href).hostname; } catch { return ""; } })();
  // The store page: Amazon, a ShopMy pick's retailer, or the pick's store/brand. Louisiana shops and sponsors keep
  // their own badge line and have no store page here.
  const store = AMAZON.has(host) || AMAZON.has(plainHost) ? storeFor("Amazon")
    : LOUISIANA.has(host) || SPONSORS.has(host) ? null
    : storeFor(p.retailer || p.store || p.brand);
  if (store) stores.get(store).hosts.add(host);
  const flags = Object.fromEntries(["trending", "shipsFast", "localPickup"].filter((k) => p[k] === true).map((k) => [k, true]));
  const image = typeof p.image === "string" && p.image.startsWith("https://") ? p.image : undefined;
  return {
    name: p.name, brand: p.brand ?? "", line: p.line ?? "", href,
    ...(image ? { image } : {}), ...(store ? { store } : {}), ...(p.louisianaFit ? { louisianaFit: true } : {}), ...flags,
  };
}

/** The 25 Days sponsors guide: every pick there is a sponsor's (lead 2026-11-18: each gets the sponsor badge). */
export const SPONSORS_GUIDE = "25-days-sponsors";
/** Picks left out by the lead, by guide and brand, the brand kept by name only (Hilma's probiotic, a health product). */
export const NAME_ONLY = [{ guide: SPONSORS_GUIDE, brand: "Hilma" }];
const nameOnly = (slug, p) => NAME_ONLY.some((x) => x.guide === slug && x.brand === p.brand);

const guides = {};
const add = (slug, raw, where) => {
  const p = toPick(raw, where);
  if (!p) return;
  if (slug === SPONSORS_GUIDE) p.sponsor = true;
  const list = (guides[slug] ??= []);
  if (!list.some((x) => x.href === p.href && x.name === p.name)) list.push(p);
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort()) {
  const slug = file.replace(/\.json$/, "");
  for (const p of JSON.parse(readFileSync(join(dir, file), "utf8"))) if (!nameOnly(slug, p)) add(slug, p, file);
}
/** Extras that name their guides (`fits`); each also lands on its store page. */
for (const f of ["_awin.json", "_later.json", "_later-mylinks.json", "_later-brands.json"]) {
  for (const p of readJson(f) ?? []) for (const slug of p.fits ?? []) if (GUIDE_SLUGS.has(slug)) add(slug, p, f);
}
/** Store extras: the store page, and for Warby Parker the guides the owner named (11-18). */
const WARBY_GUIDES = ["her", "him", "coworkers", "rns", "girls-teens", "boys-teens"];
const storeExtras = [["_xtratuf.json", []], ["_warby-parker.json", WARBY_GUIDES], ["_walmart.json", []], ["_tiktok-shop.json", []], ["_amazon-trending.json", []], ["_later.json", []], ["_awin.json", []], ["_later-mylinks.json", []], ["_later-brands.json", []]];
for (const [f, extraGuides] of storeExtras) {
  for (const p of readJson(f) ?? []) {
    const pick = toPick(p, f);
    if (!pick?.store) continue;
    add(pick.store, p, f);
    for (const g of extraGuides) add(g, p, f);
  }
}
/** Amazon bounties (Prime, Audible, registries) in the guides they fit. */
const BOUNTY_GUIDES = { "Try Prime free": ["store-amazon", "stocking-stuffers"], "Audible free trial": ["book-lover", "new-mom", "store-amazon"], "Start an Amazon Baby Registry": ["new-mom", "store-amazon"], "Start an Amazon Wedding Registry": ["newlyweds", "newly-engaged", "store-amazon"] };
for (const b of readJson("_amazon-bounties.json") ?? []) {
  const key = Object.keys(BOUNTY_GUIDES).find((k) => b.name.startsWith(k));
  for (const slug of key ? BOUNTY_GUIDES[key] : []) add(slug, { name: b.name, brand: "Amazon", line: "", href: b.href }, "_amazon-bounties.json");
}
/** Photos first, order kept inside each group. */
for (const slug of Object.keys(guides)) guides[slug] = [...guides[slug].filter((p) => p.image), ...guides[slug].filter((p) => !p.image)];

/** "Nov 22" / "2026-11-23 (...)" -> "2026-11-22"; anything else -> no end date. */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const endDate = (s) => {
  if (!s) return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const md = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(s);
  if (!md || !MONTHS[md[1].toLowerCase()]) return undefined;
  const m = MONTHS[md[1].toLowerCase()];
  return `${m < 6 ? 2027 : 2026}-${String(m).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
};
const okLink = (href) => {
  try {
    const u = new URL(href);
    return u.protocol === "https:" && AFFILIATE.has(u.hostname) && (!AMAZON.has(u.hostname) || u.hostname === "amzn.to" || u.searchParams.get("tag") === "louisianahelpr-20");
  } catch {
    return false;
  }
};
const noPrice = (s) => !/\$\s?\d/.test(s ?? "");

/** Each store page's live deal sections (title, affiliate link, end date, items for Walmart's collections). */
const deals = {};
const addDeal = (slug, d) => {
  if (!okLink(d.href) || !noPrice(d.title)) return hidden.push(`deal ${slug}: ${d.title} (no affiliate link or a price)`);
  if (!stores.has(slug)) stores.set(slug, { name: d.storeName, hosts: new Set() });
  const list = (deals[slug] ??= []);
  if (!list.some((x) => x.href === d.href)) list.push({ title: d.title, href: d.href, ...(d.ends ? { ends: d.ends } : {}), ...(d.items?.length ? { items: d.items } : {}) });
};
for (const [slug, list] of Object.entries(readJson("_store-deal-sections.json") ?? {})) {
  const title = INDEX.find((g) => g.slug === slug)?.title ?? slug.slice(6);
  for (const d of list) if (!d.hidden && d.affiliate_href) addDeal(slug, { storeName: title, title: d.title, href: d.affiliate_href, ends: endDate(d.ends) });
}
for (const c of readJson("_walmart-collections.json") ?? []) {
  const items = (c.items ?? []).filter((i) => i.affiliate_href && okLink(i.affiliate_href) && noPrice(i.name)).map((i) => ({ name: i.name, href: i.affiliate_href }));
  if (c.collection_affiliate_href) addDeal(storeFor("Walmart"), { storeName: "Walmart", title: c.collection.replace(/^Walmart\s+/, ""), href: c.collection_affiliate_href, items });
}
for (const h of readJson("_amazon-hub.json") ?? []) addDeal(storeFor("Amazon"), { storeName: "Amazon", title: h.name, href: h.affiliate_href, ends: endDate(h.ends) });
for (const f of ["_later-deals.json", "_later-promos.json"]) {
  for (const d of readJson(f) ?? []) {
    const slug = storeFor(d.brand ?? d.store);
    if (slug) addDeal(slug, { storeName: stores.get(slug).name, title: d.title ?? d.offer, href: d.affiliate_href, ends: endDate(d.ends) });
  }
}

/** The Sales list (sidebar): one line per store with a live deal, soonest end first; the page hides expired ones. */
const sales = Object.entries(deals).flatMap(([slug, list]) => list.filter((d) => d.ends).map((d) => ({ store: stores.get(slug).name, slug, offer: d.title, ends: d.ends, href: d.href })))
  .sort((a, b) => a.ends.localeCompare(b.ends) || a.store.localeCompare(b.store));

const storeList = Object.fromEntries([...stores.entries()].filter(([slug]) => guides[slug]?.length || deals[slug]?.length || Object.values(guides).some((l) => l.some((p) => p.store === slug)))
  .sort(([a], [b]) => a.localeCompare(b)).map(([slug, s]) => [slug, { name: s.name, hosts: [...s.hosts].sort() }]));

if (Object.keys(guides).length === 0) process.exit(1);
if (hidden.length && process.env.GIFT_PICKS_VERBOSE) console.error(`HIDDEN (no affiliate link yet, or a rule broken):\n${hidden.join("\n")}`);
const body = Object.entries(guides).sort(([a], [b]) => a.localeCompare(b)).map(([slug, picks]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(picks)},`).join("\n");
writeFileSync(
  out,
  `/** GENERATED by scripts/gift-guide-picks.mjs from ~/Desktop/Gift-guide-picks (re-run it after any change there). Do not edit. */\n` +
    `export interface ResearchedPick { name: string; brand: string; line: string; href: string; image?: string; store?: string; louisianaFit?: true; trending?: true; shipsFast?: true; localPickup?: true; sponsor?: true }\n` +
    `export interface StoreDeal { title: string; href: string; ends?: string; items?: { name: string; href: string }[] }\n` +
    `export interface Sale { store: string; slug: string; offer: string; ends: string; href: string }\n` +
    `/** Sponsors listed by name only on their guide (their pick is left out). */\n` +
    `export const NAME_ONLY_SPONSORS: Record<string, string[]> = ${JSON.stringify(Object.fromEntries(NAME_ONLY.map((x) => [x.guide, NAME_ONLY.filter((y) => y.guide === x.guide).map((y) => y.brand)])))};\n` +
    `/** Every store page (slug -> the name shown and the link hosts its picks use). */\n` +
    `export const RESEARCHED_STORES: Record<string, { name: string; hosts: string[] }> = ${JSON.stringify(storeList)};\n` +
    `/** Each store page's deal sections, after its picks (each hidden after its end date). */\n` +
    `export const STORE_DEALS: Record<string, StoreDeal[]> = ${JSON.stringify(deals)};\n` +
    `/** The sidebar's Sales (each hidden after its end date). */\n` +
    `export const SALES: Sale[] = ${JSON.stringify(sales)};\n` +
    `export const RESEARCHED_PICKS: Record<string, ResearchedPick[]> = {\n${body}\n};\n`,
);
console.log(`gift-guide-picks: ${Object.keys(guides).length} guides, ${Object.values(guides).flat().length} picks, ${Object.keys(storeList).length} store pages, ${sales.length} sales; ${hidden.length} hidden (GIFT_PICKS_VERBOSE=1 lists them)`);
