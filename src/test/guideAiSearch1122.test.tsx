/**
 * AI search for the gift guides (owner pop-up 2026-11-22 9:40 PM, all three chosen: "Bing + IndexNow", "Q&A + updated
 * date + byline", "llms.txt"), so assistants that read the web (ChatGPT and Copilot through Bing, Perplexity, Google's
 * AI answers) can find and quote the guides. IndexNow already ships (scripts/indexnow-ping.mjs, guard
 * indexNowPing.test.ts); this guards the other two.
 *
 * 1. Every Q&A page (Her, Him, Kids, 25 Days sponsors, Black Friday, Small Business Saturday, Cyber Monday, Holiday
 *    Hub), as api/share.ts serves it to a crawler, ends its body with a "Common questions" section of 3 to 5 questions,
 *    an "Updated <day>" from src/content/guideUpdated.mjs and the "we" byline (owner 11-22 10:22 PM: never Lexi, founder or nurse),
 *    and carries FAQPage JSON-LD with exactly the same questions and answers.
 * 2. The answers come from the page's own rows: every "Name (~$N)" in a catalog guide's answer is a pick in that guide
 *    whose card shows ~$N today (rounded to the dollar); the under-$25 / under-$50 answers name only picks in band.
 * 3. Owner wording rules: no "mom", "y'all", "cher", affiliate or commission words, nothing addressed to an AI.
 * 4. The Updated day is generated from the data (scripts/guide-updated.mjs): the committed table matches every page's
 *    data fingerprint, and a changed page moves only its own day.
 * 5. public/llms.txt is current and two-way with the sitemap's gift guide, Holiday Hub and 25 Days URLs.
 * 6. Off the first load: the guide route's modules reach the Q&A code only through LazyGuideQa's import().
 *
 * @mutate api/share.ts | return { kind: "page", body: withQaSection(giftGuideBody(slug, g), qa.section), | return { kind: "page", body: giftGuideBody(slug, g),
 * @mutate api/share.ts | section: qaSectionHtml(qa, hasOwn(GUIDE_UPDATED, page) ? GUIDE_UPDATED[page].day : undefined, byline), ld: ld ? [ld] : [] }; | section: qaSectionHtml(qa, hasOwn(GUIDE_UPDATED, page) ? GUIDE_UPDATED[page].day : undefined, byline), ld: [] };
 * @mutate src/lib/guideQa.mjs |   if (!section) return body; |   return body;
 * @mutate src/lib/guideQa.mjs |   return p.priceFrom ? `from $${d}` : `~$${d}`; |   return p.priceFrom ? `from $${p.price}` : `~$${p.price}`;
 * @mutate src/lib/guideQa.mjs |   const to50 = band("25-to-50"); |   const to50 = priced;
 * @mutate src/lib/guideQa.mjs |   other: "We put this list together.", |   other: "Put together by our founder, a Louisiana nurse.",
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | QA_CATALOG_GUIDES.includes(guide.slug) && ( | false && (
 * @mutate scripts/generate-llms-txt.mjs |     ...guides.map(line), |     ...guides.slice(1).map(line),
 * @mutate scripts/guide-updated.mjs |     "cyber-monday": day("cyber-monday"), |     "cyber-monday": day("black-friday"),
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GiftGuides from "@/pages/info/GiftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { blankComments } from "./helpers/blankNonCode";
import { buildSeoData } from "@/prerender/seoData";
import type { SeoData } from "@/lib/seoBodies.mjs";
import { QA_PAGES, catalogGuideQa, shortDate } from "@/lib/guideQa.mjs";
import { pickPriceShown, shownDollars } from "@/lib/pickPriceShown.mjs";
import { GUIDE_UPDATED } from "@/content/guideUpdated.mjs";
import { QA_CATALOG_GUIDES } from "@/pages/info/giftGuides/LazyGuideQa";
import { nextUpdated, pageInputs, parseUpdated, moduleText } from "../../scripts/guide-updated.mjs";
import { buildLlmsTxt, isHolidayPath, sitemapPaths } from "../../scripts/generate-llms-txt.mjs";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
let handler: { fetch: (req: Request) => Promise<Response> };
let data: SeoData;

beforeAll(async () => {
  // As seoPageBodies.test.ts: the build's generated data module is a placeholder in a test run, so the handler gets the
  // real data from the same builder the build runs.
  ensureOgShellSnapshot(ROOT);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  data = await buildSeoData();
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
}, 120_000);

/** Each Q&A page and the id vercel.json's rewrite sends for it. */
const PAGE_IDS: Record<string, string> = {
  her: "gift-guides/her",
  him: "gift-guides/him",
  kids: "gift-guides/kids",
  "25-days-sponsors": "gift-guides/25-days-sponsors",
  "black-friday": "gift-guides/black-friday",
  "small-business-saturday": "gift-guides/small-business-saturday",
  "cyber-monday": "gift-guides/cyber-monday",
  holidays: "holidays",
};

const page = async (id: string) => (await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`))).text();
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const section = (doc: string) => /<section id="guide-qa"[\s\S]*?<\/section>/.exec(doc)?.[0] ?? "";
const pairs = (sec: string) => [...sec.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => ({ q: decode(m[1]), a: decode(m[2]) }));
const faq = (doc: string) =>
  [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]) as { "@type"?: string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] })
    .filter((b) => b["@type"] === "FAQPage");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

describe("guide Q&A in the HTML a crawler reads", () => {
  it("every Q&A page has a page id here, and every one is in the Updated table (two-way)", () => {
    expect(Object.keys(PAGE_IDS).sort()).toEqual([...QA_PAGES].sort());
    expect(Object.keys(GUIDE_UPDATED).sort()).toEqual([...QA_PAGES].sort());
    expect([...QA_CATALOG_GUIDES].sort()).toEqual(["25-days-sponsors", "her", "him", "kids"]);
    expect(QA_PAGES.length).toBeGreaterThan(7);
  });

  for (const [slug, id] of Object.entries(PAGE_IDS)) {
    it(`${id}: 3-5 questions inside <main>, Updated day + byline, and the same Q&A as FAQPage JSON-LD`, async () => {
      const doc = await page(id);
      const sec = section(doc);
      expect(sec, `${id} has no Q&A section`).not.toBe("");
      // Inside the page's own body, before </main>.
      const main = /<main id="seo-page"[\s\S]*?<\/main>/.exec(doc)?.[0] ?? "";
      expect(main).toContain('id="guide-qa"');
      const qa = pairs(sec);
      expect(qa.length).toBeGreaterThanOrEqual(slug.endsWith("-friday") || slug === "cyber-monday" ? 2 : 3);
      expect(qa.length).toBeLessThanOrEqual(5);
      const text = decode(sec);
      expect(text).toContain(`Updated ${shortDate(GUIDE_UPDATED[slug].day)}`);
      expect(text).toMatch(/We picked every gift on this list\.|We put this list together\./);
      expect(text).not.toMatch(/\bLexi\b|founder|nurse/i);
      // Owner wording rules.
      expect(text).not.toMatch(/\bmom\b|y'all|\bcher\b|affiliate|commission|\bAI\b|assistant|recommend/i);
      const ld = faq(doc);
      expect(ld).toHaveLength(1);
      expect(ld[0].mainEntity!.map((e) => ({ q: e.name, a: e.acceptedAnswer.text }))).toEqual(qa);
    });
  }

  it("a catalog guide's answers name its own picks at the price the card shows (~$N, whole dollars), each in its band", async () => {
    let checked = 0;
    for (const slug of ["her", "him", "kids"]) {
      const picks = data.guides[slug].qa ?? [];
      expect(picks.length, `${slug} has no Q&A picks in the SEO data`).toBeGreaterThan(20);
      const qa = pairs(section(await page(PAGE_IDS[slug])));
      expect(qa).toEqual(catalogGuideQa(slug, picks, today()));
      for (const { q, a } of qa) {
        // The page's own price sections (guide audit 1123 #1): "Under $25" = shown dollars below 25, "$25 to $50" = 25 to 49.
        const band = /under \$25/.test(q) ? [0, 25] : /under \$50/.test(q) ? [25, 50] : null;
        // Each named pick: "Name (~$N)". The name is the text before " (~$" back to the list separator.
        for (const m of a.matchAll(/(?:: |, | and )([^,:]+?) \((~|from )\$(\d+(?:\.\d+)?)\)/g)) {
          const [, name, , dollars] = m;
          expect(dollars, `${slug}: "${name}" price is not whole dollars`).toMatch(/^\d+$/);
          const pick = picks.find((p) => p.name === name || p.name.endsWith(name));
          expect(pick, `${slug}: "${name}" is not a pick in the guide`).toBeTruthy();
          expect(pickPriceShown(pick!.price, pick!.priceAt, today())).toBe(true);
          expect(shownDollars(pick!.price)).toBe(Number(dollars));
          if (band) {
            expect(Number(dollars)).toBeGreaterThanOrEqual(Math.max(1, band[0]));
            expect(Number(dollars)).toBeLessThan(band[1]);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("Updated day is generated from the data (scripts/guide-updated.mjs)", () => {
  it("the committed table matches every page's data fingerprint (a stale table would move a day)", () => {
    const committed = readFileSync(resolve(ROOT, "src/content/guideUpdated.mjs"), "utf8");
    // A far-off "today": any page whose data changed since the table was written would take it.
    expect(moduleText(nextUpdated(parseUpdated(committed), pageInputs(), "1999-01-01"))).toBe(committed);
    for (const v of Object.values(GUIDE_UPDATED)) expect(v.day).toMatch(/^2026-\d{2}-\d{2}$/);
  });

  it("each page has its own inputs, and a change to one page moves only that page's day", () => {
    const inputs = pageInputs();
    expect(new Set(Object.values(inputs)).size).toBe(Object.keys(inputs).length);
    const before = parseUpdated(readFileSync(resolve(ROOT, "src/content/guideUpdated.mjs"), "utf8"));
    const after = nextUpdated(before, { ...inputs, kids: `${inputs.kids} ` }, "2030-01-01");
    for (const k of Object.keys(inputs)) expect(after[k].day).toBe(k === "kids" ? "2030-01-01" : before[k].day);
  });
});

describe("public/llms.txt", () => {
  const sitemap = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
  const llms = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");

  it("is current (regenerated from the sitemap and each page's description)", () => {
    expect(buildLlmsTxt(sitemap)).toBe(llms);
  });

  it("follows llmstxt.org: H1, a blockquote summary, H2 sections of described links; plain words", () => {
    const lines = llms.split("\n");
    expect(lines[0]).toBe("# Louisiana Helpr");
    expect(lines.find((l) => l.startsWith("> "))).toBeTruthy();
    expect(lines.filter((l) => l.startsWith("## ")).length).toBeGreaterThan(3);
    for (const l of lines.filter((x) => x.startsWith("- "))) expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/www\.louisianahelpr\.com\/[^)]*\): \S/);
    expect(llms).not.toMatch(/\bAI\b|assistant|recommend|best in|y'all|\bcher\b|\bmom\b|\bLexi\b|founder|nurse/i);
  });

  it("is two-way with the sitemap's gift guide, Holiday Hub and 25 Days URLs", () => {
    const want = sitemapPaths(sitemap).filter(isHolidayPath);
    expect(want.length).toBeGreaterThan(10);
    const linked = [...llms.matchAll(/\]\(https:\/\/www\.louisianahelpr\.com(\/[^)]*)\)/g)].map((m) => m[1]);
    for (const p of want) expect(linked, `llms.txt is missing ${p}`).toContain(p);
    const inSitemap = new Set(sitemapPaths(sitemap));
    for (const p of linked.filter((x) => x !== "/sitemap.xml")) expect(inSitemap.has(p), `llms.txt links ${p}, not in the sitemap`).toBe(true);
    for (const slug of ["her", "him", "kids", "black-friday", "cyber-monday", "small-business-saturday", "25-days-sponsors"]) expect(linked).toContain(`/gift-guides/${slug}`);
    expect(linked).toContain("/holidays");
  });
});

describe("the page draws the same Q&A, open (no accordion)", () => {
  it("For Him: 'Common questions' after the list, the same questions the crawler HTML has, Updated day and byline", async () => {
    await loadAllGuidePicks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    try {
      const { container } = render(
        <MemoryRouter initialEntries={["/gift-guides/him"]}>
          <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
        </MemoryRouter>,
      );
      await screen.findByText("Common questions", undefined, { timeout: 10_000 });
      const sec = container.querySelector("[data-guide-qa='him']")!;
      const shown = [...sec.querySelectorAll("dt")].map((dt) => ({ q: dt.textContent, a: dt.nextElementSibling?.textContent }));
      expect(shown).toEqual(catalogGuideQa("him", data.guides.him.qa ?? [], "2026-11-22"));
      expect(shown.length).toBeGreaterThanOrEqual(3);
      expect(sec.querySelector("details, [aria-expanded='false'], [hidden]")).toBeNull();
      expect(sec.querySelector("[data-guide-qa-byline]")!.textContent).toBe(`Updated ${shortDate(GUIDE_UPDATED.him.day)} · We picked every gift on this list.`);
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });
});

describe("the Q&A stays off the guide route's first load", () => {
  const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));
  const FIRST_LOAD = ["src/pages/info/GiftGuides.tsx", "src/pages/info/giftGuides/GiftGuideView.tsx", "src/pages/info/giftGuides/LazyGuideQa.tsx"];

  it("the guide route's modules never import guideQa.mjs, guideUpdated.mjs or GuideQa statically", () => {
    for (const f of FIRST_LOAD) {
      // A type-only import is erased from the build, so it is no load.
      const src = code(f).replace(/^import type [^;]+;$/gm, "");
      expect(src, f).not.toMatch(/from\s+["'][^"']*(guideQa\.mjs|guideUpdated\.mjs|\/GuideQa)["']/);
    }
    expect(code("src/pages/info/giftGuides/LazyGuideQa.tsx")).toMatch(/import\(\s*["']\.\/GuideQa["']\s*\)/);
  });

  it("each page renders the lazy Q&A with its own kind", () => {
    expect(code("src/pages/info/giftGuides/GiftGuideView.tsx")).toMatch(/<LazyGuideQa[^>]*kind="catalog"/);
    const deals = code("src/pages/info/giftGuides/GiftGuideDeals.tsx");
    expect(deals).toMatch(/<LazyGuideQa[^>]*kind="deals"/);
    expect(deals).toMatch(/<LazyGuideQa[^>]*kind="small-biz"/);
    expect(code("src/pages/info/holidays/HolidayHub.tsx")).toMatch(/<LazyGuideQa[^>]*kind="holidays"/);
  });
});
