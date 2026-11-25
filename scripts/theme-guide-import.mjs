#!/usr/bin/env node
/**
 * ONE-COMMAND THEMED KIDS GUIDE (owner 2026-11-24: Monster Jam, then Marvel, Bluey, KPop Demon Hunters, Pokémon ...,
 * each "built exactly like" Monster Jam). Turns a research lane's folder into a live /gift-guides/<slug> page:
 *
 *   node scripts/theme-guide-import.mjs <slug> "<Theme name>" <research folder> [--redraw-cover]
 *
 * The folder holds items.json ({ groups: [{ category, items: [{ id, name, store, href, price, was, rate, image, age,
 * oos, line?, brand? }] }] }, the Monster Jam research's schema), cutouts/<id>.webp, and cover6.json (the six cover
 * item ids: a list, or { ids: [...] }). It
 *  - writes scripts/gift-guide-themes/<slug>.json: one row per item in the list's group order; items with no price, no
 *    https link, no affiliate link, no photo or one that breaks the owner's style rules (giftGuideRules ownerStyleOff: no
 *    neon on any guide) go under `skipped`. An item marked out of stock (`oos`) stays on the page (owner 11-24 ~9:30 PM:
 *    "No leave the sold out stuff on"). An item with `hold: "<why>"` goes under `skipped` with that reason. A re-import keeps each existing row's own line and
 *    brand (by id). Amazon photos are never edited (Associates terms): an Amazon row shows Amazon's own photo;
 *  - copies the cutouts into public/gift-guides/cutouts/<name>-<store>-<md5 6>.webp (the repo's naming) and removes a
 *    cutout a re-import no longer uses when nothing else names it;
 *  - adds a store key (or a link host) RESEARCHED_STORES lacks;
 *  - adds the theme to src/content/giftGuideLive.mjs THEME_GUIDE_NAMES_1124 and scripts/gift-guide-themes/index.mjs;
 *  - refreshes by hand-edit every generated file a theme lives in (never scripts/gift-guide-picks.mjs, which rewrites
 *    ~45 unrelated files): its picks chunk, CHUNK_PICK_COUNTS / CHUNK_SLUGS / the chunk glob, GIFT_GUIDE_SEO, api/share.ts WIDE_CARD_FOR_ID, and the cover generators' SLUG_TINT / COVER_KEYS / PAGES;
 *  - first import (or --redraw-cover): writes the cover manifest entry from cover6.json, draws the green square cover
 *    (scripts/theme-guide-draw.py) and the 1200x630 card (scripts/gift-guide-wide-og.py <slug>), and refreshes
 *    COVER_SLUGS, COVER_WEBP_SLUGS and both version files. A re-import keeps the cover and card as they are;
 *  - takes off Kids any Kids pick waiting for this theme (scripts/kids-theme-moves.mjs, giftGuideKidsThemeMoves1124.mjs);
 *  - rewrites the search index with scripts/gift-guide-search-index.mjs (it writes only that file).
 * The research's groups stay in the rows file (its history); the page's chunk has none: it is laid out as For Kids
 * (owner 11-24 ~7 PM), cheapest first in the main guides' price sections with Kids' Filter (scripts/giftGuideThemePicks.mjs).
 * Guard: src/test/giftGuideThemes1124.test.tsx (every live theme: photo + price on every row, sections open, no "shop
 * similar", no Amazon on the cover, a 1200x630 card, a green cover with six photos), giftGuideThemeLayout1124.test.tsx.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants, copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerStyleOff } from "./giftGuideRules.mjs";
import { themeChunkPicks } from "./giftGuideThemePicks.mjs";
import { DEAL_THEME_TITLES_1125 } from "../src/content/giftGuideLive.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.louisianahelpr.com";

/** The file's bytes, or null when it is not there (read-and-handle-ENOENT, not existsSync-then-read). */
function readIfThere(p) {
  try {
    return readFileSync(p);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}
const CUT_DIR = join(ROOT, "public", "gift-guides", "cutouts");
const rel = (...p) => join(ROOT, ...p);
const read = (p) => readFileSync(rel(p), "utf8");
const write = (p, s) => writeFileSync(rel(p), s);

export const slugify = (s) => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** "Walmart" -> "store-walmart", "Kohl's" -> "store-kohls" (the RESEARCHED_STORES keys). */
export const storeKey = (name) => `store-${slugify(name)}`;
const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    // Not a URL: no host (the row is skipped as "no link").
    return "";
  }
};
const isAmazon = (store, href) => store === "store-amazon" || /(^|\.)amazon\.com$/.test(hostOf(href)) || hostOf(href) === "amzn.to";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** The repo's cutout naming: the name's slug (60 characters at most), the store, the first 6 hex of the file's MD5. */
export const cutoutName = (name, store, bytes) =>
  `${slugify(name).slice(0, 60).replace(/-+$/, "")}-${store.replace(/^store-/, "")}-${createHash("md5").update(bytes).digest("hex").slice(0, 6)}.webp`;

/**
 * The name shoppers see: the research's notes to itself come off ("(matching set with MJ87)": any parenthetical naming
 * one of the list's own ids, which share the item's id prefix).
 */
export const publicName = (name, id) => {
  const pre = String(id ?? "").match(/^[A-Za-z]+/)?.[0];
  if (!pre) return String(name).trim();
  return String(name).replace(new RegExp(`\\s*\\([^)]*\\b${pre}\\d+\\b[^)]*\\)`, "g"), "").trim();
};

/**
 * Whether a research row is kept off the page by the owner's style rules (owner 11-20: no neon on any guide). An item
 * the owner sent herself (`ownerAdd`, lead 11-24 on her Hot Wheels Neon Smashers link) is her decision and always goes on
 * (owner-decides-guide-items: she keeps or removes every item). Guard: src/test/giftGuideThemeLayout1124.test.tsx.
 */
export const breaksStyleRule = (slug, it, href) => !it.ownerAdd && ownerStyleOff(slug, { name: it.name, image: it.image, href, line: it.line });

/** The line under a new row's name (a re-import keeps the row's own; the research may give one). */
export const defaultLine = (theme, category) =>
  /stocking/i.test(category) ? `A little ${theme} gift for the stocking.` : `${category.replace(/\s*\$\d.*$/, "")} for a ${theme} fan.`;

/** One `export const NAME = <json>;` line: parse, change, write back (same JSON style). */
function editJsonConst(file, name, fn, { sortKeys = false } = {}) {
  const src = read(file);
  const re = new RegExp(`(export const ${name}(?:: [^=]+)? = )(.*?);\\n`);
  const m = src.match(re);
  if (!m) throw new Error(`${file}: ${name} not found`);
  let val = fn(JSON.parse(m[2]));
  if (sortKeys) val = Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  write(file, src.replace(re, () => `${m[1]}${JSON.stringify(val)};\n`));
}
const isSortedKeys = (o) => Object.keys(o).every((k, i, a) => i === 0 || a[i - 1] <= k);
const sortedInsert = (arr, v) => (arr.includes(v) ? arr : [...arr, v].sort());

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const redrawCover = process.argv.includes("--redraw-cover");
  if (args.length !== 3) {
    console.error('usage: node scripts/theme-guide-import.mjs <slug> "<Theme name>" <research folder> [--redraw-cover]');
    process.exit(2);
  }
  const [slug, theme, folderArg] = args;
  // The cover's and card's title: "<theme> Gift Guide", or a store deals guide's own (Sam's Club Black Friday, owner 11-25).
  const coverTitle = Object.prototype.hasOwnProperty.call(DEAL_THEME_TITLES_1125, slug) ? DEAL_THEME_TITLES_1125[slug] : `${theme} Gift Guide`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`bad slug ${slug}`);
  const folder = resolve(folderArg.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const research = JSON.parse(readFileSync(join(folder, "items.json"), "utf8"));
  const rowsPath = `scripts/gift-guide-themes/${slug}.json`;
  const old = existsSync(rel(rowsPath)) ? JSON.parse(read(rowsPath)) : null;
  const oldById = new Map((old?.rows ?? []).map((r) => [r.id, r]));
  const prefix = old?.sectionPrefix ?? slug;
  // A section's line from the last import (the owner-facing words stay as they were for a new item in an old group).
  const oldLineBySection = new Map();
  for (const r of old?.rows ?? []) if (!oldLineBySection.has(r.section)) oldLineBySection.set(r.section, r.line);

  // 1. The rows.
  const rows = [];
  const skipped = [];
  const storeHosts = new Map(); // store key -> { name, hosts }
  // The link hosts the guides already use (each store's affiliate hosts, Amazon's, ShopMy's ...): a plain store link
  // (www.walmart.com/ip/...) earns nothing and is refused by the guides' link guard, so it waits for its affiliate link.
  const knownHosts = new Set(Object.values(researchedStores()).flatMap((s) => s.hosts));
  for (const g of research.groups ?? []) {
    for (const raw of g.items ?? []) {
      // A store code written into the name ("Slip-On Sneakers (code BFDEALS 30% off)") comes off the name; codes show only on
      // the deals days (owner 11-21: "Codes and deals shouldn't randomly show in sections"), so it is not put on the row.
      const codeInName = String(raw.name).match(/\s*\(code ([A-Z0-9]{3,})[^)]*\)/);
      const it = { ...raw, name: publicName(String(raw.name).replace(codeInName?.[0] ?? "\u0000", ""), raw.id) };
      const store = storeKey(it.store ?? "");
      const href = String(it.href ?? "");
      const why = [];
      // A research row held on purpose (`hold: "<why>"`: the same product as another row, a page rule) stays off.
      if (typeof it.hold === "string" && it.hold) why.push(it.hold);
      if (!(Number(it.price) > 0)) why.push("no price");
      if (!href.startsWith("https://")) why.push("no link");
      else if (!knownHosts.has(hostOf(href))) why.push(`no affiliate link (${hostOf(href)})`);
      // The owner's style rules hold on every guide (owner 11-20: "no neon or chartreuse on any guide";
      // src/test/giftGuideOwner1120d.test.ts), so a research row that breaks one never reaches the page.
      if (breaksStyleRule(slug, it, href)) why.push("owner style rule (neon, boots or black cup)");
      const prev = oldById.get(it.id);
      let image = "";
      let cutBytes = null;
      const cut = join(folder, "cutouts", `${it.id}.webp`);
      if (isAmazon(store, href)) {
        image = String(it.image ?? "").startsWith("https://") ? it.image : ""; // Amazon's own photo, never edited
      } else if ((cutBytes = readIfThere(cut))) {
        const name = cutoutName(it.name, store, cutBytes);
        // Copied only for a row that goes on the page (an unpriced or unlinked item leaves no stray file).
        // COPYFILE_EXCL instead of an existsSync check first (no check-then-act race): an existing copy is kept.
        if (!why.length) {
          try {
            copyFileSync(cut, join(CUT_DIR, name), fsConstants.COPYFILE_EXCL);
          } catch (e) {
            if (e?.code !== "EEXIST") throw e;
          }
        }
        image = `${SITE}/gift-guides/cutouts/${name}`;
      } else if (prev?.image?.startsWith(`${SITE}/`) && existsSync(rel("public", prev.image.slice(SITE.length + 1)))) {
        image = prev.image;
      } else if (String(it.image ?? "").startsWith("https://")) {
        image = it.image;
      }
      if (!image) why.push("no photo");
      if (why.length) {
        skipped.push({ id: it.id, name: it.name, why });
        continue;
      }
      const row = {
        id: it.id,
        name: it.name,
        brand: it.brand ?? prev?.brand ?? theme,
        line: it.line || prev?.line || oldLineBySection.get(g.category) || rows.find((r) => r.section === g.category)?.line || defaultLine(theme, g.category),
        href,
        image,
        store,
        price: Number(it.price),
        priceAt: it.priceAt ?? today(),
        section: g.category,
        sectionId: `${prefix}-${slugify(g.category)}`,
      };
      if (Number(it.was) > Number(it.price)) row.was = Number(it.was);
      if (typeof it.rate === "number" && it.rate > 0) row.commission = it.rate;
      if (it.age) row.age = it.age;
      if (it.ownerAdd) row.ownerAdd = true;
      rows.push(row);
      const s = storeHosts.get(store) ?? { name: it.store, hosts: new Set() };
      s.hosts.add(hostOf(href));
      storeHosts.set(store, s);
    }
  }
  if (!rows.length) throw new Error("no usable rows");
  const builtFrom = `${folderArg}/items.json (${research.builtAt ?? "?"}, ${rows.length + skipped.length} items)`;
  write(rowsPath, `${JSON.stringify({ slug, name: theme, sectionPrefix: prefix, builtFrom, rows, skipped }, null, 1)}\n`);

  // 2. The theme list and the rows registry.
  editLive(slug, theme);
  const names = themeNames();
  const ident = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^(\d)/, "_$1");
  write("scripts/gift-guide-themes/index.mjs", [
    "/**",
    " * GENERATED by scripts/theme-guide-import.mjs: every themed kids guide's rows file in this folder, by slug, in menu",
    " * order (src/content/giftGuideLive.mjs THEME_GUIDE_NAMES_1124). JSON imports (not readFileSync) so the guards can load",
    " * them under jsdom. Do not edit by hand; re-run the import. Guard: src/test/giftGuideThemes1124.test.tsx.",
    " */",
    ...Object.keys(names).map((s) => `import ${ident(s)} from "./${s}.json" with { type: "json" };`),
    "",
    `export const THEME_FILES = { ${Object.keys(names).map((s) => `"${s}": ${ident(s)}`).join(", ")} };`,
    "",
  ].join("\n"));

  // 3. Stores.
  editJsonConst("src/content/giftGuidePicks.ts", "RESEARCHED_STORES", (o) => {
    const sorted = isSortedKeys(o);
    for (const [k, { name, hosts }] of storeHosts) {
      if (!o[k]) o[k] = { name, hosts: [...hosts].sort() };
      else for (const h of hosts) if (!o[k].hosts.includes(h)) o[k].hosts = [...o[k].hosts, h].sort();
    }
    return sorted ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))) : o;
  });

  // 4. The picks chunk and its counts, the chunk list and glob, SEO.
  // Laid out as For Kids (owner 11-24 ~7 PM): cheapest first with priceRank and the age in years, no category sections
  // (the page draws the main guides' price sections and Kids' Filter). ONE rule with the generator: giftGuideThemePicks.mjs.
  const picks = themeChunkPicks(slug, rows);
  write(`src/content/giftGuidePicks/${slug}.json`, `${JSON.stringify({ picks })}\n`);
  editJsonConst("src/content/giftGuidePicks.ts", "CHUNK_PICK_COUNTS", (o) => ({ ...o, [slug]: picks.length }), { sortKeys: true });
  let chunkSlugs = [];
  editJsonConst("src/content/giftGuidePicks.ts", "CHUNK_SLUGS", (a) => (chunkSlugs = sortedInsert(a, slug)));
  {
    const src = read("src/content/giftGuidePicks.ts");
    const re = /(export const PICK_CHUNKS = import\.meta\.glob<PickChunk>\()\[.*?\](, \{ import: "default" \}\);)/;
    if (!re.test(src)) throw new Error("PICK_CHUNKS glob not found");
    write("src/content/giftGuidePicks.ts", src.replace(re, (_, a, b) => `${a}${JSON.stringify(chunkSlugs.map((s) => `./giftGuidePicks/${s}.json`))}${b}`));
  }
  editJsonConst("src/content/giftGuideSeo.mjs", "GIFT_GUIDE_SEO", (o) => ({ ...o, [slug]: `${theme} gift guide` }), { sortKeys: true });

  // 4b. A Kids pick waiting for this theme (scripts/giftGuideKidsThemeMoves1124.mjs) leaves Kids now that the theme is
  // live (its own process, so it reads the rows file and registry written above).
  execFileSync("node", [rel("scripts/kids-theme-moves.mjs")], { stdio: "inherit" });

  // 5. The search index (its own small generator: it reads the picks chunks and writes only that file).
  execFileSync("node", [rel("scripts/gift-guide-search-index.mjs")], { stdio: "inherit" });

  // 6. Sitemap and llms.txt: their own generators (each writes only its file, and check-generated-current checks both),
  // then the share card map, after the last theme already listed.
  const others = Object.keys(names).filter((s) => s !== slug);
  execFileSync("node", [rel("scripts/generate-sitemap.mjs")], { stdio: ["ignore", "ignore", "inherit"] });
  execFileSync("node", [rel("scripts/generate-llms-txt.mjs")], { stdio: "inherit" });
  for (const [f, m] of [["public/sitemap.xml", `<loc>${SITE}/gift-guides/${slug}</loc>`], ["public/llms.txt", `(${SITE}/gift-guides/${slug})`]]) {
    if (!read(f).includes(m)) throw new Error(`${f}: the generator did not list ${slug}`);
  }
  insertOnce("api/share.ts", `"gift-guides/${slug}": "${slug}",`, (src) => afterLastLine(src, others.map((s) => `  "gift-guides/${s}": "${s}",`), `  "gift-guides/${slug}": "${slug}",\n`));

  // 7. The cover generators: green, its cover's six photos on the card.
  insertOnce("scripts/gift-guide-photo-covers.py", `"${slug}": "green"`, (src) => src.replace(/^(SLUG_TINT = \{.*)\}$/m, (_, a) => `${a}, "${slug}": "green"}`));
  insertOnce("scripts/gift-guide-wide-og.py", `    "${slug}": ("/gift-guides/${slug}",`, (src) =>
    afterLastLine(src, others.map((s) => `    "${s}": ("/gift-guides/${s}",`), `    "${slug}": ("/gift-guides/${slug}", "green", "the", "${coverTitle}"),\n`));
  {
    const src = read("scripts/gift-guide-wide-og.py");
    const m = src.match(/^COVER_KEYS = \(([^)]*)\)$/m);
    if (!m) throw new Error("COVER_KEYS not found");
    if (!m[1].includes(`"${slug}"`)) write("scripts/gift-guide-wide-og.py", src.replace(m[0], `COVER_KEYS = (${m[1]}, "${slug}")`));
  }

  // 8. The cover and the card: first import, or --redraw-cover.
  const manifestPath = "scripts/gift-guide-cover-items.json";
  const manifest = JSON.parse(read(manifestPath));
  if (!manifest[slug] || redrawCover) {
    const raw = JSON.parse(readFileSync(join(folder, "cover6.json"), "utf8"));
    const ids = Array.isArray(raw) ? raw : raw.ids ?? (raw.items ?? []).map((x) => x.id ?? x);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = ids.map((id) => {
      const r = byId.get(id);
      if (!r) throw new Error(`cover6.json: ${id} is not on the page`);
      if (isAmazon(r.store, r.href) || !r.image.startsWith(`${SITE}/gift-guides/cutouts/`)) throw new Error(`cover6.json: ${id} has no cutout of ours (Amazon photos never go on a cover)`);
      return { name: r.name, key: `${slug}:${String(id).toLowerCase()}`, image: r.image };
    });
    if (items.length !== 6) throw new Error(`cover6.json: ${items.length} ids, need 6`);
    manifest[slug] = { section: "For kids", items };
    write(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
    execFileSync("python3", [rel("scripts/theme-guide-draw.py"), slug, coverTitle], { stdio: "inherit" });
    execFileSync("python3", [rel("scripts/gift-guide-wide-og.py"), slug], { stdio: "inherit" });
    execFileSync("node", [rel("scripts/gift-guide-cover-versions.mjs")], { stdio: "inherit" });
    editJsonConst("src/content/giftGuideCoverSlugs.ts", "COVER_SLUGS", (a) => sortedInsert(a, slug));
    const share = read("src/lib/giftGuideShareImages.mjs");
    const re = /export const COVER_WEBP_SLUGS = new Set\((\[.*?\])\);/;
    const cur = JSON.parse(share.match(re)[1]);
    write("src/lib/giftGuideShareImages.mjs", share.replace(re, () => `export const COVER_WEBP_SLUGS = new Set(${JSON.stringify(sortedInsert(cur, slug), null, 0).replace(/","/g, '", "')});`));
  }

  // 9. Cutouts a re-import no longer uses, when nothing else in the repo names them.
  const nowUsed = new Set(rows.map((r) => r.image));
  for (const r of old?.rows ?? []) {
    if (nowUsed.has(r.image) || !r.image.startsWith(`${SITE}/gift-guides/cutouts/`)) continue;
    const base = r.image.slice(r.image.lastIndexOf("/") + 1);
    let refs = "";
    try {
      refs = execFileSync("git", ["-C", ROOT, "grep", "-l", "-F", base, "--", "scripts", "src", "api", "public"], { encoding: "utf8" });
    } catch {
      // git grep exits 1 when nothing names the file.
      refs = "";
    }
    if (!refs.trim() && existsSync(join(CUT_DIR, base))) {
      unlinkSync(join(CUT_DIR, base));
      console.log(`removed unused cutout ${base}`);
    }
  }

  const bySection = [...new Set(rows.map((r) => r.section))].map((s) => `${s} ${rows.filter((r) => r.section === s).length}`);
  console.log(`theme ${slug}: ${rows.length} rows, ${skipped.length} skipped (${skipped.map((s) => `${s.id} ${s.why.join("+")}`).join(", ") || "none"})`);
  console.log(`  sections: ${bySection.join(" | ")}`);
}

function researchedStores() {
  const m = read("src/content/giftGuidePicks.ts").match(/export const RESEARCHED_STORES: [^=]+ = (.*?);\n/);
  if (!m) throw new Error("RESEARCHED_STORES not found");
  return JSON.parse(m[1]);
}
function themeNames() {
  const m = read("src/content/giftGuideLive.mjs").match(/export const THEME_GUIDE_NAMES_1124 = (\{.*\});/);
  return JSON.parse(m[1]);
}
function editLive(slug, theme) {
  const names = themeNames();
  if (names[slug] === theme) return;
  names[slug] = theme;
  const src = read("src/content/giftGuideLive.mjs");
  const body = Object.entries(names).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ");
  write("src/content/giftGuideLive.mjs", src.replace(/export const THEME_GUIDE_NAMES_1124 = \{.*\};/, () => `export const THEME_GUIDE_NAMES_1124 = { ${body} };`));
}
function insertOnce(file, marker, fn) {
  const src = read(file);
  if (src.includes(marker)) return;
  const out = fn(src);
  if (!out.includes(marker)) throw new Error(`${file}: could not add ${marker}`);
  write(file, out);
}
function lastIndexOfAny(src, needles) {
  return Math.max(-1, ...needles.map((n) => src.lastIndexOf(n)));
}
function afterLastLine(src, needles, line) {
  const at = lastIndexOfAny(src, needles);
  if (at < 0) throw new Error(`no anchor line for ${line.trim()}`);
  const eol = src.indexOf("\n", at) + 1;
  return src.slice(0, eol) + line + src.slice(eol);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
