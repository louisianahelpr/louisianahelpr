#!/usr/bin/env node
/**
 * "Our 25 Days sponsors" (owner 11-20 ~8:40 AM): the swipeable logo row on the gift-guides landing. Reads the public
 * lineup (src/content/sponsorPage.ts: every brand on the tracker's calendar, and its Facebook link) and the logo files
 * the lead saved (~/Desktop/25 Days Logos/INDEX.md; logos come from each sponsor's own socials or site, owner rule
 * logos-from-socials), and writes:
 *   - public/gift-guides/sponsors/<slug>.webp: each logo at 160 px (shown at 72-80 px), small so the landing stays fast;
 *   - src/content/giftGuideSponsorLogos.json: [{ name, slug, logo?, href, external? }], A to Z. A sponsor with a spot
 *     on a guide links to it (/gift-guides/<guide>#<section>); else to its Facebook page; else to the sponsors guide.
 *     A sponsor with no logo file shows its initials.
 * Never a giveaway day (owner rule: don't tell sponsors their day until it is final).
 * Not in CI (it reads the lead's folder): registered in scripts/check-generated-current.mjs (gift-guide-sponsor-logos).
 * Run it after scripts/gift-guide-picks.mjs (the guide spots come from its chunks).
 *   node scripts/gift-guide-sponsor-logos.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isLiveGuide } from "../src/content/giftGuideLive.mjs";

const REPO = resolve(import.meta.dirname, "..");
const LOGOS = process.env.SPONSOR_LOGOS_DIR ?? join(homedir(), "Desktop", "25 Days Logos");
const OUT_DIR = join(REPO, "public/gift-guides/sponsors");
const OUT = join(REPO, "src/content/giftGuideSponsorLogos.json");
const PICKS = join(REPO, "src/content/giftGuidePicks");
/** Our own Christmas Day giveaway is no sponsor. */
const NOT_A_SPONSOR = new Set(["Louisiana Helpr"]);
/**
 * Sponsors the owner dropped (owner 11-20: R&R Wedding Co.): no logo, no guide card, no name, even while the public
 * lineup still lists them (holiday audit B, scripts/gift-guide-holiday-b-1120.json droppedSponsors).
 */
export const DROPPED_SPONSORS = new Set(["R&R Wedding Co."]);
/** Logos drawn white on clear (INDEX.md: "use on a dark background"): their circle is dark. */
const DARK_LOGOS = new Set(["Everyday Dose", "3 Redneck Tenors"]);
/**
 * Logos read from the sponsor's own site instead of the saved file (the saved SVGs draw cropped or tiny through Quick
 * Look): their site's own logo or share image (logos-from-socials rule).
 */
const LOGO_URLS = {
  Saranoni: "https://saranoni.com/cdn/shop/files/Saranoni_Luxury_Blankets_Logo_5584eeef-5700-4adf-850f-cd4b8b5da02a.png?v=1606150694",
  "Cat Lady / CatLadyBox": "https://catlady.com/cdn/shop/files/CatLady.gif?v=1744824334",
  Tushbaby: "https://cdn.shopify.com/s/files/1/0060/9982/8802/files/Webp.net-resizeimage_1_827c0eee-5b50-4271-9658-e919e73bec43.jpg?v=1628493680",
};
/** Downloads a logo URL to a temp file and returns its path (null on any failure: the saved file or initials stand). */
function fetchLogo(url) {
  const tmp = mkdtempSync(join(tmpdir(), "gg-logo-dl-"));
  const ext = /\.(png|gif|jpe?g|webp)(\?|$)/i.exec(url)?.[1] ?? "png";
  const file = join(tmp, `logo.${ext}`);
  try {
    execFileSync("curl", ["-fsSL", "--max-time", "30", "-o", file, url], { stdio: "ignore" });
    return file;
  } catch {
    return null; // offline or moved: fall back to the saved file
  }
}

export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)" -> "grand-kyiv-ballet"; "Cat Lady / CatLadyBox" -> "cat-lady". */
export const sponsorSlug = (name) => String(name).split(/[:(/·]/)[0].trim().toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** The name shown under a logo: the business name without the event or the town ("Le Petit Theatre (New Orleans)" -> "Le Petit Theatre"). */
export const shortName = (name) => String(name).split(/\s*[:(·]\s*/)[0].replace(/\s*\/.*$/, "").trim();

/** The lineup's brands (every `brand: "..."` in the days list) and its Facebook links. */
export function readLineup(src) {
  const brands = [...new Set([...src.matchAll(/\{ brand: "([^"]+)", prize:/g)].map((m) => m[1]))].filter((b) => !NOT_A_SPONSOR.has(b) && !DROPPED_SPONSORS.has(b));
  const links = {};
  for (const m of src.matchAll(/^\s+"([^"]+)": "(https:\/\/[^"]+)",$/gm)) links[m[1]] = m[2];
  return { brands, links };
}

/** INDEX.md rows ("- Dec 01 | homerunPET | Dec01-homerunPET.png ...") -> { foldedName: file }; MISSING rows are left out. */
export function readIndex(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const cells = line.replace(/^- /, "").split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    const file = /([A-Za-z0-9][A-Za-z0-9._ -]*\.(png|jpe?g|svg|webp))/i.exec(cells[2])?.[1];
    if (!file || /^UNCONFIRMED/i.test(file)) continue;
    const k = fold(shortName(cells[1]));
    if (k && !out[k]) out[k] = file;
  }
  return out;
}

/** The logo file for a brand: its own row, else a row whose name starts the same way (HOTWORX studios share one). */
export const logoFor = (brand, index, files = []) => {
  const k = fold(shortName(brand));
  if (index[k]) return index[k];
  const hit = Object.keys(index).find((n) => n.length >= 5 && (n.startsWith(k) || k.startsWith(n)));
  if (hit) return index[hit];
  // A file saved outside INDEX.md ("le-petit-theatre-logo.jpg", "crab-man-plus.png"): its name, day prefix and "logo" dropped.
  const stem = (f) => fold(f.replace(/\.[a-z]+$/i, "").replace(/^(Dec\d\d(-\d\d)*|NotPlaced)-/i, "").replace(/-?(logo|site-image)$/i, ""));
  const k6 = k.slice(0, 8);
  return files.find((f) => !/^(UNCONFIRMED|NotPlaced)/i.test(f) && /\.(png|jpe?g|svg|webp)$/i.test(f) && stem(f).length >= 5 && (stem(f).startsWith(k6) || k.startsWith(stem(f))));
};

/** Where a sponsor's logo links: its guide spot (a sponsor pick outside the sponsors guide and the store pages). */
export function spotFor(brand, chunks) {
  const k = fold(shortName(brand));
  if (k.length < 3) return undefined;
  for (const [slug, picks] of Object.entries(chunks)) {
    // Owner 11-21: a retired guide (src/content/giftGuideLive.mjs) is no spot; its sponsor links to Facebook or the sponsors page.
    if (slug.startsWith("store-") || slug === "25-days-sponsors" || !isLiveGuide(slug)) continue;
    const p = picks.find((x) => x.sponsor && (fold(x.brand).startsWith(k) || fold(x.name).startsWith(k) || (fold(x.brand).length >= 4 && k.startsWith(fold(x.brand)))));
    if (p) return `/gift-guides/${slug}${p.sectionId && p.sectionId !== "top-picks" ? `#${p.sectionId}` : ""}`;
  }
  return undefined;
}

function toWebp(src, dest) {
  const tmp = mkdtempSync(join(tmpdir(), "gg-logo-"));
  try {
    let png = join(tmp, "logo.png");
    if (/\.svg$/i.test(src)) {
      // macOS Quick Look draws SVGs to PNG (sips cannot read SVG).
      execFileSync("qlmanage", ["-t", "-s", "320", "-o", tmp, src], { stdio: "ignore" });
      png = join(tmp, readdirSync(tmp).find((f) => f.endsWith(".png")));
    } else {
      execFileSync("sips", ["-s", "format", "png", "-Z", "160", src, "--out", png], { stdio: "ignore" });
    }
    execFileSync("cwebp", ["-quiet", "-q", "82", "-resize", "160", "0", png, "-o", dest], { stdio: "ignore" });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { brands, links } = readLineup(readFileSync(join(REPO, "src/content/sponsorPage.ts"), "utf8"));
  const index = readIndex(readFileSync(join(LOGOS, "INDEX.md"), "utf8"));
  const chunks = Object.fromEntries(readdirSync(PICKS).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(PICKS, f), "utf8")).picks ?? []]));
  const logoFiles = readdirSync(LOGOS);
  const smallBiz = JSON.parse(readFileSync(join(REPO, "src/content/giftGuideSmallBiz.json"), "utf8"));
  const smallLogos = readdirSync(join(REPO, "public/gift-guides/small-biz"));
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  const noLogo = [];
  for (const brand of brands) {
    const slug = sponsorSlug(brand);
    if (rows.some((r) => r.slug === slug)) continue; // HOTWORX Baton Rouge + Denham Springs: one logo, one tile.
    const file = logoFor(brand, index, logoFiles);
    // Else the Small Business Saturday page's own logo for that sponsor (public/gift-guides/small-biz/<slug>.*).
    const small = smallBiz.find((b) => fold(shortName(b.name)).startsWith(fold(shortName(brand)).slice(0, 8)) || fold(shortName(brand)).startsWith(fold(shortName(b.name))));
    const smallFile = small && smallLogos.find((f) => f.replace(/\.[a-z]+$/i, "") === small.slug);
    let logo;
    const remote = LOGO_URLS[brand] ? fetchLogo(LOGO_URLS[brand]) : null;
    const src = remote ? remote : file && existsSync(join(LOGOS, file)) ? join(LOGOS, file) : smallFile ? join(REPO, "public/gift-guides/small-biz", smallFile) : null;
    if (process.env.LOGO_DEBUG) console.log(`  ${brand} <- ${src ?? "-"}`);
    if (src) {
      toWebp(src, join(OUT_DIR, `${slug}.webp`));
      logo = `/gift-guides/sponsors/${slug}.webp`;
    } else noLogo.push(brand);
    const spot = spotFor(brand, chunks);
    const fb = links[brand];
    rows.push({ name: shortName(brand), slug, ...(logo ? { logo } : {}), href: spot ?? fb ?? "/gift-guides/25-days-sponsors", ...(!spot && fb ? { external: true } : {}), ...(logo && DARK_LOGOS.has(brand) ? { dark: true } : {}) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  writeFileSync(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
  console.log(`gift-guide-sponsor-logos: ${rows.length} sponsors, ${rows.length - noLogo.length} logos; no logo file: ${noLogo.join(", ") || "none"}`);
}
