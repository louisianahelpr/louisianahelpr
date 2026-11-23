/**
 * Guide audits, Mon Nov 23 early (content #1-#7, #11, #20; interactive I1, I2, I6-I8, I11), each from the app's own data:
 *   1. Q&A price counts use the page's own sections (pickPriceShown.mjs priceSectionId): a "~$25" gift is in "$25 to
 *      $50" in both, and on Her, Him and Kids the Q&A's "N gifts under $25" / "N gifts from $25 to $50" equal the
 *      page's sections, counted here by the page's arithmetic (rounded dollars < 25, 25 to 49).
 *   2. The 25 Days sponsors Q&A never claims to be the full lineup, and its "Where can I shop" answer counts the cards'
 *      own links (no "Each sponsor links to its own site" while some go to Facebook); the 10 sponsors whose website
 *      Small Business Saturday already links now link it here too.
 *   3. Bonheur's BLKFRIDAY35 (embargoed to Nov 26) is on no deals page before Nov 26, and never on Cyber Monday.
 *   4. Holiday Hub: an event with gaps (`days`) is listed only on its real days; its .ics has one entry per run and a
 *      readable file name.
 *   5. Search results land on the gift (#gift-... = the row's id), and a price-section link scrolls after the list loads.
 *   6. Swipe: the end title never ends in "for "; a "Me" save goes to My Wish List.
 *   7. Banners page head and llms.txt name both kinds of banner; Her/Him/Kids descriptions lead with real cover picks.
 *
 * @mutate src/lib/guideQa.mjs |   const band = (id) => priced.filter((p) => priceSectionId(p.price) === id); |   const band = (id) => priced.filter((p) => (id === "under-25" ? shownDollars(p.price) <= 25 : shownDollars(p.price) > 25 && shownDollars(p.price) <= 50));
 * @mutate src/lib/guideQa.mjs |       a: own === rows.length |       a: true
 * @mutate src/lib/guideQa.mjs | Its sponsors include the ${plural(brands.length, "business or brand", "businesses and brands")} on this page. | The ${plural(brands.length, "business or brand", "businesses and brands")} on this page are its sponsors.
 * @mutate src/content/giftGuideDealCounts.ts |     .filter((c) => !(c.embargo && c.starts && today < c.starts)) |     .filter(() => true)
 * @mutate src/content/giftGuideDealCounts.ts |     .filter((c) => !namesOther(c.offer)); |     .filter(() => true);
 * @mutate src/content/holidayHub/holidayHub.mjs |   if (Array.isArray(item.days) && item.days.length) return item.days.some((d) => d >= from && d <= to); |   if (false) return false;
 * @mutate src/lib/holidayIcs.ts |   const runs = dayRuns(item.days) ?? [[item.start, last] as const]; |   const runs = [[item.start, last] as const];
 * @mutate src/lib/holidayIcs.ts |   return `${slug \|\| item.id.replace(/[^a-z0-9-]/gi, "-")}.ics`; |   return `${item.id.replace(/[^a-z0-9-]/gi, "-")}.ics`;
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | <Link to={`/gift-guides/${slug}#${pickAnchor(name)}`} | <Link to={`/gift-guides/${slug}`}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   }, [navKey, ready, hash]); |   }, [navKey]);
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | <li data-gift-pick="" id={guide && rank === undefined ? pickAnchor(pick.name) : undefined}> | <li data-gift-pick="">
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx | : forName ? W.swipeSavedFor(saved.length, forName) : W.swipeDoneTitle(saved.length)} | : W.swipeSavedFor(saved.length, forName ?? "")}
 * @mutate src/lib/publicPageMeta.mjs |     title: "Free printable holiday banners — Helpr", |     title: "Free printable Happy Thanksgiving banner — Helpr",
 * @mutate src/lib/giftGuidePageMeta.mjs |     giftGuideDescription(name, lead ?? topNames, count) ?? |     giftGuideDescription(name, topNames, count) ??
 * @mutate src/lib/guideQa.mjs | .replace(/\s*\(([^)]*)\)/g, ", $1"); | ;
 * @mutate src/pages/info/giftGuides/GiftGuideMenuHint.tsx | onClick={closeAndFocusMenu} aria-label={W.close} | onClick={close} aria-label={W.close}
 * @mutate scripts/gift-guide-picks.mjs | ? { ...p, href: SPONSOR_SITES_1123[p.brand] } : p)); | ? p : p));
 * @mutate src/prerender/seoData.ts |       const key = `${p.href} ${p.name}`; |       const key = p.href;
 *
 * 9. The crawler's guide intro and ItemList count one row per gift, as the page does (lead 11-23).
 * 8. Lows: the Holiday Hub Q&A has no nested parentheses (#17); Escape on Sort / Filter returns focus to its button and
 *    the tip box's Close hands focus to the three-line menu button (I3, I4).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/content/giftGuideEarnRank.json", () => ({ default: { ranks: {} } }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadGuidePicks } from "@/content/giftGuideCatalog";
import { catalogGuideQa, holidayHubQa, toQaPick } from "@/lib/guideQa.mjs";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { pickPriceShown, priceSectionId, shownDollars } from "@/lib/pickPriceShown.mjs";
import { codesOn } from "@/content/giftGuideDealCounts";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import { holidayItemsOn, runsBetween } from "@/content/holidayHub/holidayHub.mjs";
import { holidayIcs, holidayIcsName } from "@/lib/holidayIcs";
import { pickAnchor } from "@/content/giftGuidePickAnchor";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { GUIDE_LEAD_PICKS, giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { blankComments } from "./helpers/blankNonCode";
import sponsors from "@/content/giftGuidePicks/25-days-sponsors.json";
import smallBiz from "@/content/giftGuideSmallBiz.json";

const ROOT = resolve(__dirname, "..", "..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const TODAY = "2026-11-23";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("1. Q&A price counts = the page's price sections (content #1)", () => {
  it("a ~$25 gift is in $25 to $50, never under $25", () => {
    expect(priceSectionId(24.6)).toBe("25-to-50");
    expect(priceSectionId(24.4)).toBe("under-25");
    expect(priceSectionId(49.6)).toBe("50-to-75");
    const qa = catalogGuideQa("her", [
      { name: "A", price: 24.6, priceAt: TODAY }, { name: "B", price: 12, priceAt: TODAY }, { name: "C", price: 25, priceAt: TODAY },
    ], TODAY);
    expect(qa[0].a).toMatch(/^This guide has 1 gift under \$25\. B \(~\$12\)\.$/);
    expect(qa[1].a).toContain("2 gifts from $25 to $50");
  });

  it("Her, Him and Kids: the Q&A's counts are the page's section counts", async () => {
    let checked = 0;
    for (const slug of ["her", "him", "kids"]) {
      await loadGuidePicks(slug);
      const picks = guideBySlug(slug)!.picks.filter((p) => p.name);
      // The page's arithmetic (GiftGuideView.tsx priceSections), written out: rounded dollars, at least $1.
      const shown = picks.filter((p) => pickPriceShown(p.price, p.priceAt, TODAY)).map((p) => Math.max(1, Math.round(p.price!)));
      const under25 = shown.filter((d) => d < 25).length;
      const to50 = shown.filter((d) => d >= 25 && d < 50).length;
      expect(under25, slug).toBeGreaterThan(10);
      const qa = catalogGuideQa(slug, picks.map(toQaPick), TODAY);
      expect(qa.find((x) => /under \$25\?$/.test(x.q))!.a, slug).toContain(`This guide has ${under25} gifts under $25.`);
      expect(qa.find((x) => /under \$50\?$/.test(x.q))!.a, slug).toContain(`${to50} gifts from $25 to $50.`);
      checked++;
    }
    expect(checked).toBe(3);
  });
});

describe("2. 25 Days sponsors Q&A says only what the cards show (content #2, #3, #4, #12)", () => {
  const rows = sponsors.picks as { name: string; brand?: string; href: string; price?: number; priceAt?: string }[];
  const qa = catalogGuideQa("25-days-sponsors", rows.map((p) => toQaPick(p)), TODAY);

  it("never claims the page is the whole lineup, nor that every sponsor links its own site when some link Facebook", () => {
    expect(qa[0].a).toMatch(/Its sponsors include the \d+ businesses and brands on this page\./);
    const shop = qa.find((x) => x.q === "Where can I shop the sponsors?")!.a;
    const social = rows.filter((p) => /(^|\.)(facebook|instagram)\.com$/.test(new URL(p.href).hostname)).length;
    expect(social).toBeGreaterThan(0);
    expect(shop).not.toMatch(/^Each sponsor/);
    const own = rows.filter((p) => !/(^|\.)(facebook|instagram|louisianahelpr)\.com$/.test(new URL(p.href).hostname)).length;
    expect(shop).toBe(`Of the ${rows.length} sponsor gifts on this page, ${own} link to the sponsor's own shop or website and ${social} to its Facebook or Instagram page.`);
  });

  it("the under-$25 sponsor answer names no $25 gift (Dupuy's ~$25)", () => {
    const under = qa.find((x) => x.q === "Are there sponsor gifts under $25?")!.a;
    expect(under).not.toMatch(/~\$25\)/);
  });

  it("a sponsor card links the website Small Business Saturday already links for the same business", () => {
    const sites = new Map((smallBiz as { name: string; website?: string }[]).filter((s) => s.website).map((s) => [s.name.toLowerCase(), s.website!]));
    let fixed = 0;
    for (const p of rows) {
      const site = sites.get((p.brand ?? p.name).toLowerCase());
      if (!site || /(^|\.)louisianahelpr\.com$/.test(new URL(site).hostname)) continue;
      expect(/(^|\.)(facebook|instagram)\.com$/.test(new URL(p.href).hostname), `${p.brand}: links ${p.href}, site ${site}`).toBe(false);
      fixed++;
    }
    expect(fixed).toBeGreaterThan(8); // 9 by exact name 2026-11-23 (Britt Creates is "Britt Creates Studio" on SBS)
  });
});

describe("2b. the sponsor website links survive a regeneration (lead 11-23)", () => {
  const map = (JSON.parse(readFileSync(resolve(ROOT, "scripts/gift-guide-sponsor-sites-1123.json"), "utf8")) as { sites: Record<string, string> }).sites;
  it("every brand in the generator's site map has that link on its card, and it is the Small Business Saturday website", () => {
    const entries = Object.entries(map);
    expect(entries.length).toBe(10);
    const sbs = smallBiz as { name: string; website?: string }[];
    for (const [brand, site] of entries) {
      const card = (sponsors.picks as { brand?: string; href: string }[]).find((p) => p.brand === brand);
      expect(card?.href, brand).toBe(site);
      expect(sbs.some((s) => s.website === site && s.name.toLowerCase().startsWith(brand.toLowerCase())), `${brand}: ${site} is not its SBS website`).toBe(true);
    }
  });
  it("scripts/gift-guide-picks.mjs applies the map to the sponsors guide before it writes the chunks", () => {
    const gen = src("scripts/gift-guide-picks.mjs");
    const apply = gen.indexOf("pageList[SPONSORS_GUIDE] = pageList[SPONSORS_GUIDE].map((p) => (Object.hasOwn(SPONSOR_SITES_1123, p.brand ?? \"\") ? { ...p, href: SPONSOR_SITES_1123[p.brand] } : p));");
    const write = gen.indexOf("writeFileSync(new URL(`${slug}.json`, chunkDir)");
    expect(apply).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(apply);
    expect(gen).toContain('new URL("./gift-guide-sponsor-sites-1123.json", import.meta.url)');
  });
});

describe("3. an embargoed code stays off every page until its day (content #5, #11)", () => {
  const has = (day: string, today: string) => codesOn(day, today).some((c) => c.code === "BLKFRIDAY35");
  it("BLKFRIDAY35: hidden on Nov 23-25 though it works on Black Friday; shown from Nov 26; never on Cyber Monday", () => {
    expect(has("2026-11-27", "2026-11-23")).toBe(false);
    expect(has("2026-11-27", "2026-11-25")).toBe(false);
    expect(has("2026-11-27", "2026-11-26")).toBe(true);
    expect(has("2026-11-30", "2026-11-30")).toBe(false);
    // Bonheur's other codes keep showing.
    expect(codesOn("2026-11-27", "2026-11-23").filter((c) => c.store === "Bonheur Jewelry").length).toBe(2);
  });
});

describe("4. Holiday Hub days with gaps (content #20, interactive I1, I7)", () => {
  const byId = (id: string) => HOLIDAY_EVENTS.find((e) => e.id === id)!;
  it("Cookies With Santa is on Sat Nov 21 and Sat Dec 12 only; every gapped event lists on its own days", () => {
    const on = (day: string) => holidayItemsOn(HOLIDAY_EVENTS, day).map((e) => e.id);
    expect(on("2026-11-23")).not.toContain("E163");
    expect(on("2026-12-12")).toContain("E163");
    expect(on("2026-12-24")).not.toContain("E068");
    expect(on("2026-12-23")).toContain("E068");
    const gapped = HOLIDAY_EVENTS.filter((e) => e.days?.length);
    expect(gapped.length).toBeGreaterThan(8);
    for (const e of gapped) {
      expect(e.days![0], e.id).toBe(e.start);
      expect(e.days![e.days!.length - 1], e.id).toBe(e.end);
      for (let d = new Date(`${e.start}T12:00:00Z`); d <= new Date(`${e.end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10);
        expect(runsBetween(e, day, day), `${e.id} ${day}`).toBe(e.days!.includes(day));
      }
    }
  });

  it("the calendar file has one entry per run of days and a readable name", () => {
    const ics = holidayIcs(byId("E007"), new Date("2026-11-23T18:00:00Z"))!;
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261123");
    expect(ics).toContain("DTEND;VALUE=DATE:20261125");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261221");
    expect(ics).toContain("UID:E007-2@louisianahelpr.com");
    expect(holidayIcsName(byId("E007"))).toBe("santa-claus-is-coming-to-town-lafayette-public-library.ics");
    expect(holidayIcsName({ id: "E068", name: "Réveillon at The Grill Room, Windsor Court" })).toBe("reveillon-at-the-grill-room-windsor-court.ics");
  });
});

describe("5. search lands on the gift; a price-section link scrolls once the list is in (I2, I8)", () => {
  const renderAt = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
  const scrolled: string[] = [];
  const spy = () => {
    scrolled.length = 0;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); } as typeof orig;
    return () => { Element.prototype.scrollIntoView = orig; };
  };

  it("/gift-guides/her#25-to-50 scrolls the $25 to $50 section into view after the picks load", async () => {
    const undo = spy();
    try {
      renderAt("/gift-guides/her#25-to-50");
      await waitFor(() => expect(scrolled).toContain("gg-sec-25-to-50"), { timeout: 5000 });
    } finally { undo(); }
  });

  it("a gift row carries its own #link and that link scrolls the row into view", async () => {
    await loadGuidePicks("kids");
    const pick = guideBySlug("kids")!.picks.find((p) => p.name)!;
    const undo = spy();
    try {
      const { container } = renderAt(`/gift-guides/kids#${pickAnchor(pick.name)}`);
      await waitFor(() => expect(scrolled).toContain(pickAnchor(pick.name)), { timeout: 5000 });
      expect(container.querySelectorAll(`[id="${pickAnchor(pick.name)}"]`).length).toBe(1);
    } finally { undo(); }
  });

  it("every Her/Him/Kids gift has a unique #link on its guide (the name is unique there)", async () => {
    for (const slug of ["her", "him", "kids"]) {
      await loadGuidePicks(slug);
      const ids = guideBySlug(slug)!.picks.filter((p) => p.name).map((p) => pickAnchor(p.name));
      expect(new Set(ids).size, slug).toBe(ids.length);
      expect(ids.length, slug).toBeGreaterThan(100);
    }
  });

  it("the search result's link is the guide plus that #link", () => {
    expect(src("src/pages/info/giftGuides/GiftGuideShare.tsx")).toContain("to={`/gift-guides/${slug}#${pickAnchor(name)}`}");
  });
});

describe("6-7. Swipe end title, banners head, guide descriptions (I11, I6 / #6, #7)", () => {
  it("Swipe: no title ends in a bare \"for \", and a Me save writes My Wish List", () => {
    const s = src("src/pages/info/giftGuides/fun/SwipeGifts.tsx");
    expect(s).not.toContain('forName ?? "")');
    expect(s).toContain("W.swipeDoneTitle(saved.length)");
    expect(s).toMatch(/else if \(keep\) \{\s*\n\s*if \(addToWishList\(/);
  });

  it("Banners page title, description, og title and llms.txt name both kinds of banner", () => {
    const m = PUBLIC_PAGE_META["/gift-guides/printables/banners"];
    expect(m.title).toBe("Free printable holiday banners — Helpr");
    for (const text of [m.description, m.ogTitle]) {
      expect(text).toMatch(/Thanksgiving/);
      expect(text).toMatch(/Merry Christmas/);
    }
    const llms = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
    const line = llms.split("\n").find((l) => l.includes("/gift-guides/printables/banners)"))!;
    expect(line).toMatch(/Merry Christmas/);
  });

  it("Her, Him and Kids descriptions name real cover picks, not the three cheapest", async () => {
    for (const slug of ["her", "him", "kids"] as const) {
      await loadGuidePicks(slug);
      const picks = guideBySlug(slug)!.picks;
      for (const n of GUIDE_LEAD_PICKS[slug]) expect(picks.some((p) => p.name === n), `${slug}: ${n}`).toBe(true);
      const cheapest = [...picks].filter((p) => p.price).sort((a, b) => a.price! - b.price!)[0];
      const d = giftGuidePageMeta(slug, guideBySlug(slug)!.title, picks.slice(0, 3).map((p) => p.name), picks.length).description;
      expect(d, slug).toContain(GUIDE_LEAD_PICKS[slug][0].split(",")[0]);
      expect(d, slug).not.toContain(cheapest.name.split(/,| - /)[0]);
      expect(shownDollars(cheapest.price)).toBeLessThan(15);
    }
  });
});

describe("9. the crawler's guide count = the page's (lead 11-23: sponsors crawler 105 vs the page 108)", () => {
  it("every Her/Him/Kids/sponsors gift is one crawler row; the intro count and ItemList size equal the page's rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
    const { buildSeoData } = await import("@/prerender/seoData");
    const data = await buildSeoData();
    for (const slug of ["25-days-sponsors", "her", "him", "kids"]) {
      await loadGuidePicks(slug);
      const rows = guideBySlug(slug)!.picks.filter((p) => p.name && p.href).length;
      expect(data.guides[slug].count, slug).toBe(rows);
      expect(data.guides[slug].picks.length, slug).toBe(rows);
    }
    // The four sponsors with no shop of their own share our /25days link; each is still its own row.
    const ours = (sponsors.picks as { href: string }[]).filter((p) => /^https:\/\/www\.louisianahelpr\.com\/25days(?:[/?#]|$)/.test(p.href)).length;
    expect(ours).toBeGreaterThan(1);
  }, 60_000);
});

describe("8. Lows (#17, I3, I4)", () => {
  it("the Holiday Hub Q&A never nests parentheses (\"(Nov 20-Dec 24 (many dates))\")", () => {
    const qa = holidayHubQa(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, "2026-11-19");
    expect(qa.length).toBeGreaterThan(1);
    expect(HOLIDAY_EVENTS.some((e) => /\(/.test(e.dates ?? ""))).toBe(true);
    for (const { a } of qa) expect(a, a).not.toMatch(/\([^)]*\(/);
  });

  it("Escape on Sort and Filter focuses their button; the tip's Close focuses the menu button", () => {
    const share = src("src/pages/info/giftGuides/GiftGuideShare.tsx");
    expect(share.split('wrap.current?.querySelector<HTMLElement>("button")?.focus();').length - 1).toBe(2);
    expect(src("src/pages/info/giftGuides/GiftGuideMenuHint.tsx")).toContain('document.querySelector<HTMLElement>("[data-gift-head-menu]")?.focus()');
  });
});
