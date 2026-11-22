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
 *   - owner ("remove the circle around visit"): Visit is a plain text link, never an outlined button;
 *   - owner ("add this to the top or bottom of the shop small business"): the Small Business Saturday page and
 *     /shop-small carry the sign-up card at the bottom and a one-line link at the top that opens its form.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideHelpr.tsx | t: "Gift wrapping", d: GIFT_WRAP_DESCRIPTION }) | t: "Gift wrapping" })
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |       () => setCopied(true), |       () => setCopied(false),
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |         select(text);\n      }, |       },
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |         <OpenSite store={store} href={href} /> |         {null}
 * @mutate src/content/giftGuideStorePhotos.ts | (STORE_PHOTO_FILES[store] ? DIR + STORE_PHOTO_FILES[store] : null) | (DIR + "xtratuf.webp")
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |     ...(codes.length ? [{ id: "codes" |     ...(true ? [{ id: "codes"
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       {sections.length > 1 && ( |       {false && (
 * @mutate src/pages/info/giftGuides/GiftGuideSmallBiz.tsx |             <Out href={b.href} className="gg-sb-visit"> |             <Out href={b.href} className="gg-sb-visit rounded-full border">
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   return Local ? <Local sponsors={[]} /> : <FeatureCta />; |   return null;
 * @mutate src/pages/info/ShopSmall.tsx |           <FeatureCtaLink />\n |           \n
 * @mutate src/content/giftGuideDeals.mjs |   runs: (start, end) => (start && end ? | runs: (start, end) => (false ? 
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |         const when = DEALS_WORDS.runs(c.starts, c.expires); |         const when = DEALS_WORDS.runs(null, c.expires);
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       <style>{DEALS_CSS + CARD_CSS}</style> |       <style>{DEALS_CSS + CARD_CSS}</style><p data-gift-deal-day="">{day[eventPhase(day, today)]}</p>
 * @mutate src/pages/info/giftGuides/SmallBizFeatureCta.tsx |     window.dispatchEvent(new Event(OPEN_EVENT)); |     void OPEN_EVENT;
 */
import { existsSync, statSync } from "node:fs";
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
import ShopSmall from "@/pages/info/ShopSmall";

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
    expect(cards.map((c) => c.getAttribute("data-gift-code"))).toEqual(codes.map((c) => c.code));
    for (const card of cards) {
      const code = card.getAttribute("data-gift-code")!;
      expect(card.querySelector("[data-gift-code-shop]")?.getAttribute("href")).toMatch(/^https:\/\//);
      expect(card.querySelector("[data-gift-open-site]")?.getAttribute("target")).toBe("_blank");
      expect(card.querySelector("[data-gift-open-site] .sr-only")?.textContent).toContain(`Open ${card.getAttribute("data-gift-code-store")} site`);
      expect(card.querySelector("[data-gift-code-copy]")?.getAttribute("aria-label")).toBe(`Copy code ${code}`);
      expect(card.querySelector("[data-gift-store-photo]")).not.toBeNull();
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
  it("each photo is that store's own local file; a store with none shows its name, never another store's photo", () => {
    const files = Object.entries(STORE_PHOTO_FILES);
    expect(files.length).toBeGreaterThan(0);
    for (const [store, file] of files) {
      const path = resolve(ROOT, "public/gift-guides/deals/stores", file);
      expect(existsSync(path), store).toBe(true);
      expect(statSync(path).size, store).toBeLessThan(80_000);
    }
    expect(storePhoto("A store we have no photo for")).toBeNull();
    const { container } = render(<MemoryRouter><SaleCards stores={[{ store: "A store we have no photo for", sales: [{ store: "A store we have no photo for", slug: "x", offer: "20% off", ends: "2099-01-01", href: "https://example.com/" }] }]} /></MemoryRouter>);
    expect(container.querySelector("[data-gift-store-photo]")?.getAttribute("data-gift-store-photo")).toBe("name");
    expect(container.querySelector("[data-gift-store-photo] img")).toBeNull();
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
  it("a day with no codes on it has no Discount codes subsection", async () => {
    // Dec 30: every dated code is over, but the owner's undated codes still work; so read a day where codesOn is empty
    // only if one exists, else check the subsection count follows codesOn exactly.
    const day = dealDay("cyber-monday")!;
    const { container } = render(<MemoryRouter><GiftGuideDeals day={day} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector("[data-gift-deal]")).not.toBeNull());
    const codes = codesOn(day.day);
    const sub = container.querySelector("details[data-gift-deal-sub='codes']");
    if (codes.length === 0) expect(sub).toBeNull();
    else expect(sub?.querySelector("[data-gift-deal-sub-count]")?.textContent).toBe(String(codes.length));
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
  it("the day page and /shop-small: a top line that opens the sign-up card's form, the card at the bottom", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    for (const page of ["day", "shop-small"] as const) {
      const { container } = render(<MemoryRouter>{page === "day" ? <GiftGuideDeals day={dealDay("small-business-saturday")!} now={new Date("2026-11-21T18:00:00Z")} /> : <ShopSmall />}</MemoryRouter>);
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
