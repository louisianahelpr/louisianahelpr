/**
 * Holiday gift guides audit 1121, polish batch 7, plus the owner's 2026-11-21 evening deals asks. One guard per class,
 * each shown red on the broken state:
 *   - #42 the gift-wrap job opens with a starter description, so the form never opens on an empty box with the
 *     errands tips ("Which stores or locations?") that do not fit wrapping;
 *   - owner ("how can we clean this up it takes up too much space"; "for discount codes we should do the image for the
 *     place ... and the retailer and code below where they can copy and open site"; "same for sales"): every code and
 *     every store sale is a photo card (the store's own product photo, or its name, never another store's photo), the
 *     store's name links the store, a code card's chip copies the code and says Copied (a refused clipboard selects
 *     it), every card has an open-site button, no dashed code box and no round Copy button;
 *   - owner ("it just needs to be cleaned up ... more organized"): a deals day is in subsections by type, each only
 *     when it has something, the first open, with a jump row;
 *   - owner ("remove this" / "On each card say when the deals start and end"): no day line under a deals day's banner,
 *     and every card says when it starts and ends (both days, else the one we know, never an invented one);
 *   - owner ("coloring book and banner should have their own page"; "remove from her, they already have their own
 *     section"): each printable kind is its own page with its own head, the menu links each and marks the open one, the
 *     old address lands on its anchor's page, no printable on Her, Him or Kids, and a long download label wraps;
 *   - owner ("remove the circle around visit"): Visit is a plain text link, never an outlined button;
 *   - owner ("add this to the top or bottom of the shop small business"): the Small Business Saturday page carries
 *     the sign-up card at the bottom and a one-line link at the top that opens its form.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideHelpr.tsx | t: "Gift wrapping", d: GIFT_WRAP_DESCRIPTION }) | t: "Gift wrapping" })
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | for (const c of codes) if (c.href) byStore.set(c.store, [...(byStore.get(c.store) ?? []), c]); | for (const c of codes) if (c.href) byStore.set(c.code, [c]);
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | const namesOther = (offer: string) => Boolean(here && other!.some((t) => offer.includes(t)) && !offer.includes(here.title)); | const namesOther = (offer: string) => false;
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |       () => setCopied(true), |       () => setCopied(false),
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |         select(text);\n      }, |       },
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |         <OpenSite store={store} href={href} /> |         {null}
 * @mutate src/content/giftGuideStorePhotos.ts | (STORE_PHOTO_FILES[store] ? DIR + STORE_PHOTO_FILES[store] : null) | (DIR + "xtratuf.webp")
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |   if (!src || !ok) return null; |   if (!ok) return null;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | body: <CodeCards codes={codes} /> | body: <CodeCards codes={codes.slice(1)} />
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       {sections.length > 1 && ( |       {false && (
 * @mutate src/pages/info/giftGuides/smallBizCardStyles.ts | min-height:44px;min-width:44px;font-size:14px | min-height:44px;font-size:14px
 * @mutate src/pages/info/giftGuides/GiftGuideSmallBiz.tsx |             <Out href={b.href} className="gg-sb-visit"> |             <Out href={b.href} className="gg-sb-visit rounded-full border">
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   return Local ? <Local sponsors={[]} /> : <FeatureCta />; |   return null;
 * @mutate src/content/giftGuideDeals.mjs |   runs: (start, end) => (start && end ? | runs: (start, end) => (false ? 
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | [c.offer, DEALS_WORDS.runs(c.starts, c.expires)] | [c.offer, DEALS_WORDS.runs(null, c.expires)]
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       <style>{DEALS_CSS + CARD_CSS}</style> |       <style>{DEALS_CSS + CARD_CSS}</style><p data-gift-deal-day="">{day[eventPhase(day, today)]}</p>
 * @mutate src/content/printables.ts | export const printablesOnPage = (key: PrintablePageKey, list: Printable[] = PRINTABLES) => shownPrintables(list).filter((p) => pageOfPrintable(p) === key); | export const printablesOnPage = (key: PrintablePageKey, list: Printable[] = PRINTABLES) => shownPrintables(list).filter(() => Boolean(key));
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <Link to={p.path} {...current(p.path)} data-gift-side-printables={p.key}> | <Link to={p.path} data-gift-side-printables={p.key}>
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-card-btns button{max-width:100%;height:auto;min-height:44px;white-space:normal;text-align:center} | .pr-card-btns button{max-width:100%}
 * @mutate src/content/printables.ts |     guides: ["gift-wrap-and-cards"], |     guides: ["gift-wrap-and-cards", "her"],
 * @mutate src/content/printables.ts |       { label: "Poster size (12x18)", href: "/printables/thanksgiving-banner/happy-thanksgiving-banner-12x18.jpg" },\n |
 * @mutate src/components/giftGuides/PickPrice.tsx | {pick.priceFrom ? G.priceFrom(shownDollars(pick.price)) : G.priceApprox(shownDollars(pick.price))} | {G.priceApprox(shownDollars(pick.price))}
 * @mutate src/content/giftGuideCatalog.ts | ...(p.priceFrom ? { priceFrom: p.priceFrom } : {}) |
 * @mutate src/pages/info/giftGuides/SmallBizFeatureCta.tsx |     window.dispatchEvent(new Event(OPEN_EVENT)); |     void OPEN_EVENT;
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GIFT_WRAP_JOB_PATH } from "@/pages/info/giftGuides/GiftGuideHelpr";
import { readMatchmakerLink } from "@/lib/matchmakerLink";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { DescriptionField } from "@/components/postjob/detailsSection/DescriptionField";
import { CodeCards, SaleCards, codesOn, salesOn } from "@/pages/info/giftGuides/GiftGuideDealCards";
import { STORE_PHOTO_FILES, storePhoto } from "@/content/giftGuideStorePhotos";
import { DEALS_WORDS, dealDay } from "@/content/giftGuideDeals.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));
vi.mock("@/pages/info/giftGuides/SmallBizSubmitForm", () => ({ SmallBizSubmitForm: () => <form data-test-sbs-form="" /> }));
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import { GiftGuidesSidebar } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { PRINTABLES, PRINTABLE_PAGES, printablesForGuide } from "@/content/printables";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import SPONSORS from "@/content/giftGuidePicks/25-days-sponsors.json";
import { PickPrice } from "@/components/giftGuides/PickPrice";

afterEach(cleanup);
const ROOT = resolve(__dirname, "../..");

describe("holiday audit 1121 #42: the gift-wrap job opens with a description that fits it", () => {
  const fields = readMatchmakerLink(new URL(GIFT_WRAP_JOB_PATH, "https://x").searchParams)!;
  it("carries a starter description with no [bracketed] fill-in, long enough to hide the errands tips", () => {
    expect(fields.title).toBe("Gift wrapping");
    expect(fields.description).toMatch(/wrap/i);
    expect(fields.description.length).toBeGreaterThanOrEqual(100);
    expect(hasUnfilledPlaceholders(fields.description)).toBe(false);
  });
  it("the Details form with that description shows no errands store tip", () => {
    const { container } = render(<DescriptionField description={fields.description} setDescription={() => {}} category={fields.category} />);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(fields.description);
    expect(container.textContent).not.toMatch(/Tip:|stores or locations/);
  });
});

describe("owner 11-21: codes and sales are photo cards", () => {
  const BF = dealDay("black-friday")!.day;
  it("one card per code: store link, offer line, a code chip that copies and says Copied, an open-site button", async () => {
    const codes = codesOn(BF);
    expect(codes.length).toBeGreaterThan(5);
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<MemoryRouter><CodeCards codes={codes} /></MemoryRouter>);
    const cards = [...container.querySelectorAll("li[data-gift-code]")];
    // One card per store: Bonheur Jewelry had three codes and three identical cards (audit 1122 #13); its best code leads.
    const stores = [...new Set(codes.map((c) => c.store))];
    expect(cards.map((c) => c.getAttribute("data-gift-code-store"))).toEqual(stores);
    expect(cards.length).toBeLessThan(codes.length);
    const bonheur = container.querySelector("li[data-gift-code-store='Bonheur Jewelry']");
    const mine = codes.filter((c) => c.store === "Bonheur Jewelry");
    const pct = (o: string) => Number(/(\d+)\s*%/.exec(o)?.[1] ?? 0);
    const top = Math.max(...mine.map((c) => pct(c.offer)));
    expect(mine.length).toBeGreaterThan(1);
    expect(pct(mine.find((c) => c.code === bonheur?.getAttribute("data-gift-code"))!.offer)).toBe(top);
    fireEvent.click(bonheur!.querySelector("[data-gift-code-more]")!);
    expect([...bonheur!.querySelectorAll("[data-gift-code-extra]")].length).toBe(mine.length - 1);
    for (const card of cards) {
      const code = card.getAttribute("data-gift-code")!;
      expect(card.querySelector("[data-gift-code-shop]")?.getAttribute("href")).toMatch(/^https:\/\//);
      expect(card.querySelector("[data-gift-open-site]")?.getAttribute("target")).toBe("_blank");
      expect(card.querySelector("[data-gift-open-site] .sr-only")?.textContent).toContain(`Open ${card.getAttribute("data-gift-code-store")} site`);
      expect([...card.querySelectorAll("[data-gift-code-copy]")].map((b) => b.getAttribute("aria-label"))).toContain(`Copy code ${code}`);
      // A store with a cutout shows it; one without shows no tile (guides polish 1122 #14).
      expect(card.querySelector("[data-gift-store-photo]") !== null).toBe(storePhoto(card.getAttribute("data-gift-code-store")!) !== null);
    }
    // No dashed box and no round Copy text button: the code itself is the chip.
    expect(container.querySelector(".gg-code-row, .gg-code-one")).toBeNull();
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Copy")).toEqual([]);
    const chip = cards[0].querySelector<HTMLButtonElement>("[data-gift-code-copy]")!;
    await act(async () => { fireEvent.click(chip); });
    expect(writeText).toHaveBeenCalledWith(codes[0].code);
    await waitFor(() => expect(cards[0].querySelector("[data-gift-code-copied]")?.textContent).toBe("Copied"));
  });
  it("a refused clipboard selects the code so it can be copied by hand", async () => {
    const codes = codesOn(BF);
    Object.assign(navigator, { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    const { container } = render(<MemoryRouter><CodeCards codes={codes} /></MemoryRouter>);
    window.getSelection()?.removeAllRanges();
    await act(async () => { fireEvent.click(container.querySelector("[data-gift-code-copy]")!); });
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(codes[0].code));
    expect(container.querySelector("[data-gift-code-copied]")).toBeNull();
  });
  it("one card per store for the sales, each with its store link and open-site button", () => {
    const stores = salesOn(BF);
    expect(stores.length).toBeGreaterThan(10);
    const { container } = render(<MemoryRouter><SaleCards stores={stores} /></MemoryRouter>);
    const cards = [...container.querySelectorAll("li[data-gift-sale-store]")];
    expect(cards.length).toBe(stores.length);
    expect(new Set(cards.map((c) => c.getAttribute("data-gift-sale-store"))).size).toBe(cards.length);
    for (const c of cards) expect(c.querySelector("[data-gift-open-site]")).not.toBeNull();
  });
  it("each photo is that store's own local file; a store with none shows no tile, never another store's photo", () => {
    const files = Object.entries(STORE_PHOTO_FILES);
    expect(files.length).toBeGreaterThan(0);
    for (const [store, file] of files) {
      const path = resolve(ROOT, "public/gift-guides/deals/stores", file);
      expect(existsSync(path), store).toBe(true);
      expect(statSync(path).size, store).toBeLessThan(80_000);
    }
    expect(storePhoto("A store we have no photo for")).toBeNull();
    const { container } = render(<MemoryRouter><SaleCards stores={[{ store: "A store we have no photo for", sales: [{ store: "A store we have no photo for", slug: "x", offer: "20% off", ends: "2099-01-01", href: "https://example.com/" }] }]} /></MemoryRouter>);
    // Guides polish 1122 #14: no tinted name tile; the store's name is the card's own heading link.
    expect(container.querySelector("[data-gift-store-photo]")).toBeNull();
    expect(container.querySelector(".gg-deal-photo")).toBeNull();
    expect(container.querySelector("[data-gift-code-shop]")?.textContent).toBe("A store we have no photo for");
  });
});

describe("owner 11-21: every card says when it starts and ends; no day line", () => {
  it("runs: both days when both are known, else the one we know, else nothing", () => {
    expect(DEALS_WORDS.runs("2026-11-20", "2026-11-28")).toBe("Nov 20 – Nov 28");
    expect(DEALS_WORDS.runs("2026-11-27", null)).toBe("Starts Nov 27");
    expect(DEALS_WORDS.runs(undefined, "2026-12-17")).toBe("Ends Dec 17");
    expect(DEALS_WORDS.runs(undefined, undefined)).toBe("");
  });
  it("a code with a start and an end shows both; no day line under the banner", async () => {
    const BF = dealDay("black-friday")!;
    const { container } = render(<MemoryRouter><GiftGuideDeals day={BF} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector("[data-gift-deal]")).not.toBeNull());
    expect(container.querySelector("[data-gift-deal-day]")).toBeNull();
    expect(container.textContent).not.toContain(BF.before);
    expect(container.querySelector("li[data-gift-code='TAKE25'] .gg-card-line")?.textContent).toContain("Nov 20 – Nov 28");
    // Every sale line carries its end day.
    const lines = [...container.querySelectorAll("li[data-gift-sale]")];
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(l.textContent).toMatch(/Ends [A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe("owner 11-21: a deals day in subsections by type", () => {
  it("Black Friday: a jump row, then Top deals open, Discount codes and Sales closed; a jump opens its subsection", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("black-friday")!} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector("[data-gift-deal]")).not.toBeNull());
    const jump = container.querySelector("[data-gift-deal-jump]")!;
    expect([...jump.querySelectorAll("button")].map((b) => b.getAttribute("data-gift-deal-jump-to"))).toEqual(["deals", "codes", "sales"]);
    const sales = container.querySelector<HTMLDetailsElement>("details[data-gift-deal-sub='sales']")!;
    expect(sales.open).toBe(false);
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    await act(async () => { fireEvent.click(jump.querySelector("[data-gift-deal-jump-to='sales']")!); });
    expect(sales.open).toBe(true);
  });
  it("the Discount codes subsection holds exactly the codes that work that day (none: no subsection)", async () => {
    // Dec 30: every dated code is over, but the owner's undated codes still work; so read a day where codesOn is empty
    // only if one exists, else check the subsection count follows codesOn exactly.
    const day = dealDay("cyber-monday")!;
    const { container } = render(<MemoryRouter><GiftGuideDeals day={day} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector("[data-gift-deal]")).not.toBeNull());
    const codes = codesOn(day.day);
    const sub = container.querySelector("details[data-gift-deal-sub='codes']");
    if (codes.length === 0) expect(sub).toBeNull();
    else {
      expect(sub?.querySelector("[data-gift-deal-sub-count]")?.textContent).toBe(String(new Set(codes.map((c) => c.store)).size));
      // The count is the cards: one card per store with a code that works that day.
      expect(sub!.querySelectorAll("li[data-gift-code]").length).toBe(new Set(codes.map((c) => c.store)).size);
    }
    // And the subsection list never holds an empty one.
    for (const d of container.querySelectorAll("details[data-gift-deal-sub]")) expect(d.querySelector("li"), d.getAttribute("data-gift-deal-sub") ?? "").not.toBeNull();
  });
});

describe("owner 11-21: Small Business Saturday cards and the sign-up card", () => {
  it("Visit is a plain text link on every card that has a site, never an outlined pill", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("small-business-saturday")!} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll("[data-gift-sb]").length).toBeGreaterThan(20));
    const visits = [...container.querySelectorAll(".gg-sb-visit")];
    expect(visits.length).toBeGreaterThan(20);
    for (const v of visits) {
      expect(v.tagName).toBe("A");
      expect(v.className).not.toMatch(/border|rounded|btn|outline/);
      expect(v.textContent).toMatch(/^Visit/);
    }
  });
  it("the Visit link is at least 44 by 44 px (audit 11-22 #26: it measured 41 wide)", async () => {
    const { SB_CARD_CSS } = await import("../pages/info/giftGuides/smallBizCardStyles");
    const rule = SB_CARD_CSS.match(/\.gg-sb \.gg-sb-visit\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/min-height:44px/);
    expect(rule).toMatch(/min-width:44px/);
  });
  it("the day page: a top line that opens the sign-up card's form, the card at the bottom", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    for (const page of ["day"] as const) {
      const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("small-business-saturday")!} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
      await waitFor(() => expect(container.querySelectorAll("[data-gift-sb]").length).toBeGreaterThan(20));
      const top = container.querySelector<HTMLButtonElement>("[data-gift-sbs-toplink]");
      const card = container.querySelector("[data-gift-sbs-cta]");
      expect(top, page).not.toBeNull();
      expect(card, page).not.toBeNull();
      // The link comes before every business card; the card after all of them.
      const sbs = [...container.querySelectorAll("[data-gift-sb]")];
      expect(top!.compareDocumentPosition(sbs[0]) & Node.DOCUMENT_POSITION_FOLLOWING, page).toBeTruthy();
      expect(sbs[sbs.length - 1].compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING, page).toBeTruthy();
      await act(async () => { fireEvent.click(top!); });
      await waitFor(() => expect(container.querySelector("[data-test-sbs-form]"), page).not.toBeNull());
      expect(container.querySelectorAll("[data-gift-sbs-cta]").length, page).toBe(1);
      cleanup();
    }
  });
});

describe("owner 11-21: each printable kind is its own page; none on Her, Him or Kids", () => {
  it("Gift tags, Coloring books and Banners each show only their own printables, with their own h1 and head", () => {
    expect(PRINTABLE_PAGES.map((x) => x.path)).toEqual(["/gift-guides/printables/gift-tags", "/gift-guides/printables/coloring-books", "/gift-guides/printables/banners"]);
    const seen: string[] = [];
    for (const page of PRINTABLE_PAGES) {
      const { container } = render(<MemoryRouter initialEntries={[page.path]}><Printables /></MemoryRouter>);
      const ids = [...container.querySelectorAll("[data-printable-card], section[id]")].map((x) => x.getAttribute("data-printable-card") ?? x.id).filter(Boolean);
      seen.push(...ids);
      if (page.key === "coloring") expect(ids, page.path).toEqual(["coloring-book"]);
      if (page.key === "banners") expect(ids, page.path).toEqual(["thanksgiving-banner"]);
      if (page.key === "tags") expect(ids, page.path).toEqual(["gift-tags"]);
      expect(PUBLIC_PAGE_META[page.path as keyof typeof PUBLIC_PAGE_META]?.canonical, page.path).toBe(`https://www.louisianahelpr.com${page.path}`);
      cleanup();
    }
    // Every shown printable is on exactly one page.
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("the menu links each page and marks the open one", () => {
    const { container } = render(<MemoryRouter><GiftGuidesSidebar active={null} page="/gift-guides/printables/coloring-books" /></MemoryRouter>);
    const links = [...container.querySelectorAll("[data-gift-side-printables]")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(PRINTABLE_PAGES.map((x) => x.path));
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, "page", null]);
  });
  it("no printable is linked from Her, Him or Kids; a long download label wraps in its button", () => {
    for (const slug of ["her", "him", "kids"]) expect(printablesForGuide(slug), slug).toEqual([]);
    const { container } = render(<MemoryRouter initialEntries={["/gift-guides/printables/banners"]}><Printables /></MemoryRouter>);
    const css = [...container.querySelectorAll("style")].map((x) => x.textContent).join("");
    expect(css).toMatch(/\.pr-card-btns button\{[^}]*white-space:normal/);
  });
  it("the banner prints as a 12x18 Walgreens poster: a 3:2 copy first, the original kept, a Print at Walgreens link", () => {
    // Owner 2026-11-21 (relayed): Walgreens posters have no 12 x 24; the 2:1 design is padded to 3:2 so it is not cropped.
    const banner = PRINTABLES.find((p) => p.id === "thanksgiving-banner") as { blurb: string; files: { href: string }[]; printAt?: { href: string } };
    expect(banner.blurb).toBe("Print it as a 12x18 poster at Walgreens, from about $13, same-day pickup.");
    expect(banner.files.map((f) => f.href)).toEqual(["/printables/thanksgiving-banner/happy-thanksgiving-banner-12x18.jpg", "/printables/thanksgiving-banner/happy-thanksgiving-banner.jpg"]);
    const jpg = readFileSync(resolve(ROOT, "public", banner.files[0].href.slice(1)));
    // JPEG SOF0/SOF2 frame header: height then width, big-endian, after the marker and length.
    let i = 2;
    while (i < jpg.length && !(jpg[i] === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2))) i++;
    const h = jpg.readUInt16BE(i + 5);
    const w = jpg.readUInt16BE(i + 7);
    expect(Math.abs(w / h - 1.5)).toBeLessThan(0.01);
    expect(jpg.length).toBeLessThan(300 * 1024);
    const { container } = render(<MemoryRouter initialEntries={["/gift-guides/printables/banners"]}><Printables /></MemoryRouter>);
    const link = container.querySelector<HTMLAnchorElement>("[data-printable-print-at='thanksgiving-banner']")!;
    expect(link.getAttribute("href")).toBe("https://photo.walgreens.com/store/posters");
    expect(link.target).toBe("_blank");
    expect(link.textContent).toMatch(/^Print at Walgreens/);
  });
});

describe("holiday audit 1121 #66 / #63: the 25 Days sponsors page's photos and prices", () => {
  type SP = { name: string; image?: string; price?: number; priceAt?: string; priceFrom?: true };
  const picks = (SPONSORS as { picks: SP[] }).picks;
  it("every photo is a local optimized file (no multi-MB hotlink), each under 60 KB", () => {
    expect(picks.length).toBeGreaterThan(30);
    for (const p of picks) {
      expect(p.image, p.name).toMatch(/^https:\/\/www\.louisianahelpr\.com\/gift-guides\/sponsor-picks\/[a-z0-9-]+\.webp$/);
      const file = resolve(ROOT, "public", new URL(p.image!).pathname.slice(1));
      expect(existsSync(file), p.name).toBe(true);
      expect(statSync(file).size, p.name).toBeLessThan(60_000);
    }
  });
  it("every price is a captured one with its day; a ticket, gift card or membership reads 'from $N'", () => {
    const priced = picks.filter((p) => typeof p.price === "number");
    // Measured 2026-11-21: 33 of 39 priced (31 read from the brands' pages, K18 and SRI the sum of their two products);
    // Le Petit, the AllWays tote, Dupuy's, Rock Bottom Golf and Timeless show none (no readable price, never guessed), and
    // Felco none (its link is Amazon's: an Amazon price shows only on the owner's saved Her, Him and Kids picks).
    expect(priced.length).toBeGreaterThanOrEqual(33);
    for (const p of priced) expect(p.priceAt, p.name).toMatch(/^2026-\d{2}-\d{2}$/);
    const from = picks.find((p) => p.priceFrom)!;
    expect(from).toBeTruthy();
    const pick = { name: from.name, href: "https://x.test/", store: "other", price: from.price, priceAt: from.priceAt, priceFrom: true } as never;
    const { container } = render(<PickPrice pick={pick} />);
    expect(container.textContent).toMatch(/^from \$\d+$/);
  });
  it("a day's sales never name the other deal day, and the end date sits on its own line (guides audit 1122 #15)", () => {
    const cm = dealDay("cyber-monday")!.day;
    const bf = dealDay("black-friday")!.day;
    const lines = (d: string) => salesOn(d).flatMap((s) => s.sales.map((x) => x.offer));
    expect(lines(cm).filter((o) => /Black Friday/.test(o) && !/Cyber Monday/.test(o))).toEqual([]);
    expect(lines(bf).filter((o) => /Cyber Monday/.test(o) && !/Black Friday/.test(o))).toEqual([]);
    expect(lines(cm).length).toBeGreaterThan(5);
    const { container } = render(<MemoryRouter><SaleCards stores={salesOn(cm).slice(0, 2)} /></MemoryRouter>);
    for (const when of container.querySelectorAll(".gg-card-when")) expect(when.textContent).toMatch(/^Ends /);
  });
});
