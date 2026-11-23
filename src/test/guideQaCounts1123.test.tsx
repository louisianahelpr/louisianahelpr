/**
 * Guide Q&A numbers agree with the page and the guides menu (guide train p 11-23: Black Friday's "Common questions" said
 * "19 deals right now" while the menu showed 61; the 19 was the Top deals cards alone, the 61 also counts the Discount
 * codes and Sales the page lists under them).
 *   1. Black Friday and Cyber Monday, on every day from Nov 22 to Dec 3, the page rendered on that day: the answer to
 *      "What <day> deals are on this page?" names its total and its three parts, the total equals the guides menu's
 *      number (railCounts.ts dealDayCount) and each part equals the page's own section count (Top deals, Discount codes,
 *      Sales). Nov 30 is in the range on purpose: XTRATUF's Top deal ends with its store code (Nov 29), which the Q&A
 *      did not count before (measured 2026-11-23 for Nov 30: it said 19 while the page showed 18).
 *   2. The crawler's copy (api/share.ts, the pre-JS body, from seo-data's deal rows and dealParts) is word for word the
 *      in-page Q&A on each of those days, and its FAQPage JSON-LD the same words.
 *   3. Small Business Saturday: the answer names what its number counts (the 25 Days sponsors; the menu adds the
 *      approved Featured local businesses, a live read the pre-JS body cannot make), and the number is the sponsors'.
 *
 * @mutate src/lib/guideQa.mjs |   const total = live.length + codes + sales; |   const total = live.length;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | listed={{ ...dealDayParts(day.id, deals, today), storeCodes: STORE_CODES }} | listed={{ codes: 0, sales: 0 }}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | listed={{ ...dealDayParts(day.id, deals, today), storeCodes: STORE_CODES }} | listed={{ ...dealDayParts(day.id, deals, today) }}
 * @mutate src/prerender/seoData.ts | deals: dealList, dealParts: dealPartsTable(), dealLists | deals: dealList, dealLists
 * @mutate src/prerender/seoData.ts | dealEnds(d as Deal, STORE_CODES) ?? "" | d.ends ?? ""
 * @mutate api/share.ts | today, dealPartsOn(d.dealParts?.[slug], today)); | today, { codes: 0, sales: 0 });
 * @mutate src/lib/guideQa.mjs | `The ${plural(rows.length, "Louisiana business", "Louisiana businesses")} that sponsor ${TWENTY_FIVE_DAYS.name}, including | `${plural(rows.length, "Louisiana business", "Louisiana businesses")}, including
 */
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { resolve } from "node:path";
import DEALS from "@/content/giftGuideDeals.json";
import SMALL_BIZ from "@/content/giftGuideSmallBiz.json";
import { DEAL_EVENTS, type Deal } from "@/content/giftGuideDeals.mjs";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { dealDayCount } from "@/pages/info/giftGuides/railCounts";
import { buildSeoData } from "@/prerender/seoData";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
let handler: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  // As guideAiSearch1122.test.tsx: the generated data module is a placeholder in a test run, so the handler gets the real
  // data from the builder the build runs.
  ensureOgShellSnapshot(ROOT);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  const data = await buildSeoData();
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
}, 120_000);

afterEach(cleanup);

const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const crawlerQa = async (id: string) => {
  const doc = await (await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`))).text();
  const sec = /<section id="guide-qa"[\s\S]*?<\/section>/.exec(doc)?.[0] ?? "";
  const qa = [...sec.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => ({ q: decode(m[1]), a: decode(m[2]) }));
  const ld = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]) as { "@type"?: string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] })
    .find((b) => b["@type"] === "FAQPage");
  return { qa, ld: (ld?.mainEntity ?? []).map((e) => ({ q: e.name, a: e.acceptedAnswer.text })) };
};
const pageQa = (box: HTMLElement) =>
  [...box.querySelectorAll("[data-guide-qa] [data-guide-qa-item]")].map((x) => ({ q: x.querySelector("dt")!.textContent!, a: x.querySelector("dd")!.textContent! }));
const sectionCount = (box: HTMLElement, sub: string) => {
  const n = box.querySelector(`[data-gift-deal-sub="${sub}"] [data-gift-section-count]`);
  return n ? Number(/\d+/.exec(n.textContent!)![0]) : 0;
};
/** "61 right now: 19 top deals, 14 discount codes and 28 sales." or "9 top deals right now." -> the numbers it names. */
const named = (a: string) => {
  const part = (re: RegExp) => Number(re.exec(a)?.[1] ?? 0);
  const parts = { deals: part(/(\d+) top deals?\b/), codes: part(/(\d+) discount codes?\b/), sales: part(/(\d+) sales?\b/) };
  const total = /^(\d+) right now: /.exec(a) ? Number(/^(\d+)/.exec(a)![1]) : parts.deals + parts.codes + parts.sales;
  return { total, ...parts };
};

describe("guide Q&A numbers agree with the page and the menu (train p 11-23)", () => {
  it("Black Friday and Cyber Monday: total = the menu's number, parts = the page's sections, crawler = page, day by day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => void vi.useRealTimers());
    let checked = 0;
    let partsNamed = 0;
    for (let d = 22; d <= 33; d++) {
      const ymd = d <= 30 ? `2026-11-${d}` : `2026-12-0${d - 30}`;
      // Noon in Louisiana: the page, its Q&A (which reads the clock) and the crawler's copy all see this day.
      vi.setSystemTime(new Date(`${ymd}T18:00:00Z`));
      for (const day of DEAL_EVENTS.filter((e) => e.kind === "deals")) {
        const { container } = render(<MemoryRouter><GiftGuideDeals day={day} now={new Date(`${ymd}T18:00:00Z`)} /></MemoryRouter>);
        await waitFor(() => {
          expect(container.querySelector("[data-gift-deal-sections], [data-gift-deals-none]")).not.toBeNull();
          expect(container.querySelector("[data-guide-qa] [data-guide-qa-item]")).not.toBeNull();
        });
        const qa = pageQa(container);
        const onPage = qa.find((x) => x.q === `What ${day.title} deals are on this page?`);
        expect(onPage, `${day.id} on ${ymd}: no "on this page" question`).toBeTruthy();
        const page = { deals: sectionCount(container, "deals"), codes: sectionCount(container, "codes"), sales: sectionCount(container, "sales") };
        const menu = dealDayCount(day.id, DEALS as Deal[], ymd);
        expect(page.deals + page.codes + page.sales, `${day.id} on ${ymd}: page vs menu`).toBe(menu);
        if (menu > 0) {
          const n = named(onPage!.a);
          expect(n, `${day.id} on ${ymd}: "${onPage!.a}"`).toEqual({ total: menu, ...page });
          if ([page.deals, page.codes, page.sales].filter(Boolean).length > 1) partsNamed++;
          checked++;
        } else {
          expect(onPage!.a).toMatch(/have ended\.$/);
        }
        // The crawler's copy is the same words, and its FAQPage JSON-LD too.
        const crawler = await crawlerQa(`gift-guides/${day.id}`);
        expect(crawler.qa, `${day.id} on ${ymd}: crawler vs page`).toEqual(qa);
        expect(crawler.ld).toEqual(qa);
        cleanup();
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(partsNamed).toBeGreaterThan(10);
  }, 120_000);

  it("Small Business Saturday: the answer says its number counts the 25 Days sponsors", async () => {
    const { qa } = await crawlerQa("gift-guides/small-business-saturday");
    const a = qa.find((x) => x.q === "Which Louisiana small businesses are on this page?")?.a ?? "";
    expect(SMALL_BIZ.length).toBeGreaterThan(10);
    expect(a.startsWith(`The ${SMALL_BIZ.length} Louisiana businesses that sponsor 25 Days of Louisiana Giveaways, including `), a).toBe(true);
    expect(a).toMatch(/Any Featured local businesses are listed after them\.$/);
    // The other answers speak of the sponsors too, never "them" as the whole page.
    expect(qa.find((x) => x.q === "Can I order from these shops online?")?.a).toMatch(/sponsor/);
    expect(qa.find((x) => x.q === "What kinds of businesses are listed?")?.a).toMatch(/^By kind, the sponsors are /);
  });
});
