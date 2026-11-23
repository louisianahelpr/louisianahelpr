#!/usr/bin/env node
/**
 * public/llms.txt (owner pop-up 2026-11-22 9:40 PM: "llms.txt", so AI assistants can find the gift guides): a plain,
 * factual map of the site in the llmstxt.org format (an H1, a one-paragraph summary in a blockquote, then sections of
 * links, each with a one-line description). Built from public/sitemap.xml (itself generated from the routes) and each
 * page's own search description (src/lib/giftGuidePageMeta.mjs, src/lib/publicPageMeta.mjs), so a guide that goes live
 * or comes down changes this file the next time the generators run (check-generated-current). No marketing, no words
 * addressed to an AI.
 *
 *   node scripts/generate-llms-txt.mjs            # rewrite public/llms.txt
 *   node scripts/generate-llms-txt.mjs --check    # exit 1 if it has drifted
 *
 * Guard: src/test/guideAiSearch1122.test.tsx (two-way with the sitemap's gift guide and holiday URLs).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicOrGiftGuidePageMetaFor } from "../src/lib/giftGuidePageMeta.mjs";
import { LANDING_PAGE_META } from "../src/lib/publicPageMeta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://www.louisianahelpr.com";
const OUT = "public/llms.txt";

/** The sitemap's paths on our host, in its order. */
export function sitemapPaths(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(`${ORIGIN}/`))
    .map((u) => u.slice(ORIGIN.length));
}

/** The paths llms.txt must list (two-way with the sitemap): the gift guides, the Holiday Hub and 25 Days. */
export const isHolidayPath = (p) => p === "/gift-guides" || p.startsWith("/gift-guides/") || p === "/holidays" || p.startsWith("/holidays/") || p === "/25days";

const ABOUT = ["/", "/browse", "/declutter", "/help", "/fees", "/safety"];

function line(p) {
  const meta = p === "/" ? { title: LANDING_PAGE_META.title, description: LANDING_PAGE_META.description } : publicOrGiftGuidePageMetaFor(p);
  if (!meta?.title || !meta?.description) throw new Error(`generate-llms-txt: no title or description for ${p}`);
  const title = meta.title.replace(/\s+—\s+(Louisiana )?Helpr$/, "").replace(/\s+—\s+Louisiana's local partner\.$/, "");
  return `- [${title}](${ORIGIN}${p === "/" ? "/" : p}): ${meta.description}`;
}

export function buildLlmsTxt(xml) {
  const paths = sitemapPaths(xml);
  const holiday = paths.filter(isHolidayPath);
  const tool = (p) => /^\/gift-guides\/(swipe|planner|draw-names|printables)(\/|$)/.test(p);
  // The landing, then Her, Him and Kids, then the rest in the sitemap's order.
  const FIRST = ["/gift-guides", "/gift-guides/her", "/gift-guides/him", "/gift-guides/kids"];
  const rank = (p) => (FIRST.includes(p) ? FIRST.indexOf(p) : FIRST.length);
  const guides = holiday.filter((p) => p.startsWith("/gift-guides") && !tool(p)).sort((a, b) => rank(a) - rank(b));
  const tools = holiday.filter(tool);
  const season = holiday.filter((p) => !p.startsWith("/gift-guides"));
  const about = ABOUT.filter((p) => paths.includes(p));
  if (guides.length === 0) throw new Error("generate-llms-txt: the sitemap lists no gift guide");
  return [
    "# Louisiana Helpr",
    "",
    `> Louisiana Helpr is a website and app for Louisiana: people hire local help for everyday jobs, find work, and buy and sell used things (Declutter). For the 2026 holidays it also publishes gift guides (for her, for him, for kids), Black Friday, Small Business Saturday and Cyber Monday deal pages, a Holiday Hub of Christmas lights and events across Louisiana, and 25 Days of Louisiana Giveaways (December 1 to 25, 2026).`,
    "",
    "Every gift guide pick links to the store that sells it and shows a recently checked price, rounded to the dollar. The Louisiana Helpr team picks every gift. Each guide page ends with common questions answered from its own list and the day it was last updated.",
    "",
    "## Holiday gift guides",
    "",
    ...guides.map(line),
    "",
    "## Holiday Hub and 25 Days of Louisiana Giveaways",
    "",
    ...season.map(line),
    "",
    "## Gift tools and printables",
    "",
    ...tools.map(line),
    "",
    "## About Louisiana Helpr",
    "",
    ...about.map(line),
    "",
    "## Optional",
    "",
    `- [Sitemap](${ORIGIN}/sitemap.xml): every public page, including the hire pages for each service and town`,
    "",
  ].join("\n");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const text = buildLlmsTxt(readFileSync(path.join(root, "public", "sitemap.xml"), "utf8"));
  const file = path.join(root, OUT);
  if (process.argv.includes("--check")) {
    // Read once, no exists-then-read check (noCheckThenActInTooling, CodeQL js/file-system-race): missing reads as stale.
    let current = null;
    try {
      current = readFileSync(file, "utf8");
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
    }
    if (current !== text) {
      console.error(`generate-llms-txt: ${OUT} is stale; run node scripts/generate-llms-txt.mjs`);
      process.exit(1);
    }
    console.log(`generate-llms-txt: ${OUT} is current`);
  } else {
    writeFileSync(file, text);
    console.log(`generate-llms-txt: wrote ${OUT}`);
  }
}
