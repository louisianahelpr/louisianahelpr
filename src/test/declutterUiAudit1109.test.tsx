// @mutate src/components/declutter/DeclutterItemCard.tsx |       data-item-card=""\n      className="group block rounded-2xl | aria-label="Item" data-item-card=""\n      className="group block rounded-2xl
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | Meet at a safe spot (a public place, no home address shared), | pickup at the seller's door,
// @mutate src/pages/info/legal/TermsSection.tsx | <strong className="text-foreground">Meet at a safe spot</strong> | <strong className="text-foreground">pickup at the seller&apos;s door</strong>
// @mutate src/components/declutter/DeclutterItemCard.tsx |   if (!save && guestSaveTo) { |   if (!save && guestSaveTo && saves === -1) {
// @mutate src/lib/jobIntent.ts |   if (reason === SAVE_ITEM_REASON) return t("signup.saveItemSubtitle"); |
// @mutate src/components/declutter/DeclutterItemCard.tsx |             alt={photoLoaded ? item.title : ""} |             alt=""
// @mutate src/lib/i18n/enDeclutter.ts | "decl.mv.pickups": "Pickups to do", | "decl.mv.pickups": "Hand over",
// @mutate src/components/declutter/ManagerPanel.tsx |       <h2 id="manager-setup-title" className="text-base font-semibold">Let a friend sell for you</h2> |       <h2 id="manager-setup-title" className="text-base font-semibold">Get help selling</h2>
// @mutate src/App.tsx | <Route path="/declutter/wanted/new" element={<Navigate to="/declutter?tab=wanted&post=1" replace />} /> |
// @mutate src/components/declutter/DeclutterListingDefaults.tsx | t("lp.ld.dropsOn", { pct: draft.dropPct }) | `It drops ${draft.dropPct}% each evening, to a whole dollar, never below your lowest price.`
// @mutate src/components/declutter/DeclutterListingDefaults.tsx | <ChipGroup label={t("lp.ld.lowest")} | <ChipGroup label="Lowest you'll take"
// @mutate src/components/declutter/ItemPickupBlock.tsx |   const others = cities.filter((c) => c && !same(c)); |   const others = cities.filter((c) => !!c);
// @mutate src/components/declutter/itemPhotoFrame.ts | sm:max-h-[max(55dvh,calc(100dvh-400px))] | sm:max-h-none
// @mutate src/lib/largeTitles.ts |     doc.documentElement.classList.toggle("page-scrolled-any", t.scrollTop > 0); |     doc.documentElement.classList.toggle("page-scrolled-any", t.scrollTop > 24);
// @mutate src/components/sections/InlineListSearch.tsx |     if (pinned) return;\n    reopenFocus.current = focusTrigger; |     reopenFocus.current = focusTrigger;
// @mutate src/components/declutter/DeclutterItemRows.tsx | .sort((a, b) => a.d - b.d \|\| a.i - b.i) | .sort((a, b) => a.i - b.i)
// @mutate src/components/ui/StickyActionBar.tsx | className={pinWide ? "space-y-1 lg:sticky lg:top-2 | className={pinWide ? "space-y-1 lg:static lg:top-2
/**
 * Declutter findings from the UI audit of 11-09 (~/.lh-shots/ui-audit-1109, Builder 2). One describe per finding.
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { HANDOVER_TITLE } from "@/components/declutter/handoverCopy";
import { OTHER_WAYS } from "@/lib/declutter/browseFilters";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";
import { guestSaveHref } from "@/lib/declutter/guestSave";
import { wantedAskHref } from "@/lib/declutter/sellChooser";
import { ListingChoiceFields } from "@/components/declutter/DeclutterListingDefaults";
import { SELLER_DEFAULTS } from "@/lib/declutter/sellerDefaults";
import { townsWords } from "@/components/declutter/ItemPickupBlock";
import { ITEM_PHOTO_ASPECT } from "@/components/declutter/itemPhotoFrame";
import { installLargeTitles } from "@/lib/largeTitles";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { nearestOf } from "@/components/declutter/DeclutterItemRows";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { SAVE_ITEM_REASON, SAVE_ITEM_SIGNUP_SUBTITLE, signupSubtitle } from "@/lib/jobIntent";
import { blankComments } from "@/test/helpers/blankNonCode";

const SRC = resolve(__dirname, "..");

/** Every non-test .tsx under `dir` (absolute), from the tracked-file list (trackedFiles, Q1142), as absolute paths. */
function walk(dir: string): string[] {
  const repo = resolve(SRC, "..");
  return trackedFiles(relative(repo, dir))
    .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
    .map((f) => resolve(repo, f));
}

const card = (over: Record<string, unknown> = {}) => ({
  id: "i9", seller_id: "u2", status: "live", title: "Kinetic Sand SquishBlossom Set", category: "toys", condition_stars: 4,
  price_cents: 300, current_price_cents: 300, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, ...over,
}) as never;

describe("F050 / L008: every Declutter card link is named by what it shows (title and both prices)", () => {
  // L008 (landing audit 11-09): an aria-label of "<title>, $X.XX incl. fee" hid the card's other visible words (axe
  // label-content-name-mismatch on /declutter, the item page's rows and the landing strip). The card is named by its own
  // text, which holds the title, the list price and the incl.-fee price, so the name and what a sighted person reads agree.
  it("a paid card's name holds the title, the list price and the incl.-fee price; a free one says Free", () => {
    const paid = render(<MemoryRouter><ItemCard item={card()} miles={null} approximate={false} /></MemoryRouter>);
    const link = paid.getByRole("link", { name: /Kinetic Sand SquishBlossom Set.*\$3.*\$\d+\.\d{2} incl\. fee/ });
    expect(link.hasAttribute("aria-label")).toBe(false);
    paid.unmount();
    const free = render(<MemoryRouter><ItemCard item={card({ price_cents: 0, current_price_cents: 0 })} miles={null} approximate={false} /></MemoryRouter>);
    const fl = free.getByRole("link", { name: /Kinetic Sand SquishBlossom Set.*Free/ });
    expect(fl.hasAttribute("aria-label")).toBe(false);
    free.unmount();
  });

  it("the rows under an item (More from this seller, Similar) and Browse use that one card", () => {
    const users = walk(join(SRC, "components")).concat(walk(join(SRC, "pages")))
      .filter((f) => /<ItemCard\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(users.length).toBeGreaterThan(1);
    expect(users.some((f) => f.endsWith("DeclutterItemRows.tsx"))).toBe(true);
  });
});

describe("F056: every card photo's alt text is the item's title", () => {
  it("the photo is described by the title", () => {
    const r = render(<MemoryRouter><ItemCard item={card()} photoPath="u2/declutter/i9/a.png" miles={null} approximate={false} firstRow /></MemoryRouter>);
    const img = r.container.querySelector("img") as HTMLImageElement;
    // Until it loads, no alt (a broken or slow photo never paints the glyph and the title over the tile).
    expect(img.getAttribute("alt")).toBe("");
    fireEvent.load(img);
    expect(r.container.querySelector("img")?.getAttribute("alt")).toBe("Kinetic Sand SquishBlossom Set");
    r.unmount();
  });
});

describe("F128: Selling's unclear phrases are plain words", () => {
  it("the sales to hand over are 'Pickups to do'; the helper is 'Let a friend sell for you' (they keep a share)", () => {
    // Audit 11-10 F323: "Have someone sell for you" read like "How a Helpr helps you list" (paid by the hour, no share).
    const mine = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterMineViews.tsx"), "utf8"));
    const mgr = blankComments(readFileSync(join(SRC, "components/declutter/ManagerPanel.tsx"), "utf8"));
    expect(mine).toContain('{ key: "sold", label: t("decl.mv.pickups"), count: todo?.salesOpen ?? 0, hot: true },');
    expect(readFileSync(join(SRC, "lib/i18n/enDeclutter.ts"), "utf8")).toContain('"decl.mv.pickups": "Pickups to do",');
    expect((mgr.match(/>Let a friend sell for you</g) ?? []).length).toBe(2);
    expect(mgr).not.toMatch(/Get help selling|Have someone sell for you|, for a share\./);
    expect(mgr).toContain("keeps a share of each sale.");
  });
});

describe("F130: /declutter/wanted/new opens the Wanted composer, never the 404", () => {
  it("the route sends it to Browse's own Wanted-composer address", () => {
    const app = blankComments(readFileSync(join(SRC, "App.tsx"), "utf8"));
    const m = /<Route path="\/declutter\/wanted\/new" element=\{<Navigate to="([^"]+)" replace \/>\} \/>/.exec(app);
    expect(m?.[1]).toBe(wantedAskHref(""));
  });
});

describe("F125: the selling choices read in plain words", () => {
  it("'Lowers 5% each evening', 'Lowest price: 50% of your asking price', and no 'nothing to do with price drops'", () => {
    const r = render(<MemoryRouter><ListingChoiceFields draft={{ ...SELLER_DEFAULTS }} change={() => {}} /></MemoryRouter>);
    const text = r.container.textContent ?? "";
    expect(text).toContain("Lowers 5% each evening, never below your lowest price.");
    expect(r.container.querySelector("[data-floor-words]")?.textContent).toMatch(/^Lowest price: 50% of your asking price\./);
    expect(text).not.toMatch(/to a whole dollar|Lowest you'll take|nothing to do with price drops/);
    r.unmount();
  });
});

describe("F120: one pickup area (the top line names the item's area; Pickup names only a different town)", () => {
  it("the item's own area is not repeated; other towns are named, with 'also' beside it", () => {
    expect(townsWords(["New Iberia"], "New Iberia")).toBe("");
    expect(townsWords(["New Iberia", "Delcambre"], "New Iberia")).toBe(" · also Delcambre");
    expect(townsWords(["Delcambre"], "New Iberia")).toBe(" · Delcambre");
    expect(townsWords(["new iberia "], "New Iberia")).toBe("");
  });
});

describe("F079: the item photo never fills a short screen (200% zoom)", () => {
  it("from sm the photo is capped at the larger of 55% of the screen and the screen less 400px", () => {
    expect(ITEM_PHOTO_ASPECT.item).toContain("sm:max-h-[max(55dvh,calc(100dvh-400px))]");
    expect(ITEM_PHOTO_ASPECT.item).not.toContain("sm:max-h-none");
    // A phone keeps its own cap.
    expect(ITEM_PHOTO_ASPECT.item).toMatch(/(^| )max-h-\[52dvh\]/);
  });
});

describe("F074: the pinned title row is opaque from the first pixel scrolled, at once", () => {
  it("one pixel of scroll marks the page (page-scrolled-any); back at the top it clears", () => {
    const off = installLargeTitles(document);
    const box = document.createElement("div");
    box.setAttribute("data-app-page-scroll", "");
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 800 });
    document.body.appendChild(box);
    box.scrollTop = 1;
    box.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.classList.contains("page-scrolled-any")).toBe(true);
    expect(document.documentElement.classList.contains("page-scrolled")).toBe(false);
    box.scrollTop = 0;
    box.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.classList.contains("page-scrolled-any")).toBe(false);
    box.remove();
    off();
  });
  it("the row's background does not fade in (only the title inside it does)", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toContain("html:not(.web-desktop).page-scrolled-any .sticky-title-row {");
    expect(css).not.toMatch(/\.sticky-title-row,\s*\.sticky-title-row-name\s*\{\s*transition/);
  });
});

describe("F073: Declutter's desktop Browse shows a visible search field (Jobs keeps its square)", () => {
  it("a pinned search is open on arrival, never takes focus by itself, and its X clears without folding away", () => {
    const onChange = vi.fn();
    const r = render(<InlineListSearch value="lamp" onChange={onChange} label="Search items" pinned />);
    const box = r.getByRole("searchbox", { name: "Search items" });
    expect(document.activeElement).not.toBe(box);
    fireEvent.click(r.getByRole("button", { name: "Close search" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(r.getByRole("searchbox", { name: "Search items" })).toBeTruthy();
    r.unmount();
    // Empty, there is nothing to close: no X (seen in the 1440 after-shot).
    const empty = render(<InlineListSearch value="" onChange={() => {}} label="Search items" pinned />);
    expect(empty.queryByRole("button", { name: "Close search" })).toBeNull();
    empty.unmount();
  });
  it("Browse pins it; Jobs does not", () => {
    const browse = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(browse).toContain('<InlineListSearch value={query} onChange={setQuery} label={t("decl.searchItems")} pinned />');
    const others = walk(join(SRC, "components")).concat(walk(join(SRC, "pages")))
      .filter((f) => !f.endsWith("DeclutterBrowseView.tsx"))
      .map((f) => blankComments(readFileSync(f, "utf8")))
      .filter((t) => /<InlineListSearch\b/.test(t));
    expect(others.length).toBeGreaterThan(0);
    for (const t of others) expect(t).not.toMatch(/<InlineListSearch\b[^>]*\bpinned\b/);
  });
});

describe("F121: Similar near you (same category, nearest first when we know where you are)", () => {
  it("orders the row by distance, keeping order for ties and putting unplaced items last", () => {
    const at = (id: string, lat: number | string, lng: number | string) => card({ id, area_lat: lat, area_lng: lng }) as unknown as { id: string };
    const rows = [at("far", 32.5, -92.1), at("none", "x", "y"), at("near", 30.46, -91.15), at("mid", 30.9, -91.5)];
    expect(nearestOf(rows as never, { lat: 30.45, lng: -91.15 }).map((r) => r.id)).toEqual(["near", "mid", "far", "none"]);
  });
  it("the row is titled 'Similar near you' with a position, 'Similar items' without", () => {
    const rowsSrc = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterItemRows.tsx"), "utf8"));
    expect(rowsSrc).toContain('title={from ? "Similar near you" : "Similar items"}');
    expect(rowsSrc).toContain("const similarRows = from ? nearestOf(notMine(similar.data), from) : notMine(similar.data);");
  });
});

describe("L024 (landing audit 11-09): the phone's fixed action bar is a landmark", () => {
  // Portaled to <body>, the bar sat outside every landmark (axe "region"); it is a labelled region of its own.
  // @mutate src/components/ui/StickyActionBar.tsx |           role="region"\n          aria-label="Actions" |
  it("on a phone the bar is a region named Actions holding its buttons", () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === "(max-width: 639px)", media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const r = render(<StickyActionBar label="Buy or make an offer"><button type="button">Buy now</button></StickyActionBar>);
      const region = screen.getByRole("region", { name: "Actions" });
      expect(region.getAttribute("data-sticky-action-bar")).toBe("fixed");
      expect(region.textContent).toContain("Buy now");
      r.unmount();
    } finally {
      window.matchMedia = real;
    }
  });
});

describe("F119: on a computer the item page's Make offer / Buy now stay pinned while the page scrolls", () => {
  it("a pinWide bar's row is sticky from lg under the top row; without it, plain inline", () => {
    const pinned = render(<StickyActionBar label="Buy or make an offer" pinWide><button type="button">Buy now</button></StickyActionBar>);
    const row = pinned.container.querySelector("[data-sticky-action-bar='inline'][data-pin-wide]") as HTMLElement;
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["lg:sticky", "lg:top-2", "lg:bg-background"]));
    pinned.unmount();
    const plain = render(<StickyActionBar label="x"><button type="button">Go</button></StickyActionBar>);
    expect((plain.container.querySelector("[data-sticky-action-bar='inline']") as HTMLElement).className).toBe("space-y-1");
    plain.unmount();
  });
  it("the item page's member and guest bars pin, and their panels are lg:contents (sticky stays inside its parent)", () => {
    const offer = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterOfferPanel.tsx"), "utf8"));
    const guest = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterGuest.tsx"), "utf8"));
    expect(offer).toContain('className="space-y-3 scroll-mt-4 focus:outline-none lg:contents" aria-label={t("decl.buy.bar")}');
    expect(guest).toContain('<section data-guest-join="" aria-label={label} className="space-y-3 lg:contents">');
    expect(offer).toContain('<StickyActionBar label={t("decl.buy.bar")} data-declutter-buybar="" spacer={false} pinWide>');
    expect(guest).toContain('<StickyActionBar label={label} spacer={false} data-guest-buttons="" pinWide>');
  });
});

describe("F052: a guest sees the heart and count on every card; pressing it opens sign-up", () => {
  it("the heart is a link to sign-up with the save reason, coming back to Browse; the count shows beside it", () => {
    const href = guestSaveHref("/declutter?free=1");
    expect(href).toBe("/signup?reason=save_item&redirect=%2Fdeclutter%3Ffree%3D1");
    const r = render(<MemoryRouter><ItemCard item={card()} miles={null} approximate={false} saves={3} guestSaveTo={href} /></MemoryRouter>);
    const heart = r.getByRole("link", { name: "Sign up to save Kinetic Sand SquishBlossom Set, saved by 3" });
    expect(heart.getAttribute("href")).toBe(href);
    expect(heart.textContent).toBe("3");
    r.unmount();
    // No saves yet: the heart still shows (a guest learns saving exists).
    const none = render(<MemoryRouter><ItemCard item={card()} miles={null} approximate={false} saves={0} guestSaveTo={href} /></MemoryRouter>);
    expect(none.getByRole("link", { name: "Sign up to save Kinetic Sand SquishBlossom Set" })).toBeTruthy();
    none.unmount();
  });
  it("sign-up says why: 'Sign up to save items.'", () => {
    expect(signupSubtitle(SAVE_ITEM_REASON, "/declutter")).toBe(SAVE_ITEM_SIGNUP_SUBTITLE);
    expect(SAVE_ITEM_SIGNUP_SUBTITLE).toMatch(/^Sign up to save items\./);
  });
  it("Browse hands a guest's cards the heart (a member keeps the real save)", () => {
    const browse = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(browse).toContain("const guestSaveTo = member ? undefined : guestSaveHref(location.pathname + location.search);");
    expect(browse).toContain("guestSaveTo={guestSaveTo}");
  });
});

describe("F054: Help and the Terms name the same ways to get an item as the Filters", () => {
  const filterWays = ["porch" as const, ...OTHER_WAYS].map((w) => HANDOVER_TITLE[w]);
  it("the Filters offer porch pickup plus the other ways (the inventory)", () => {
    expect(filterWays.length).toBeGreaterThan(2);
  });
  it("Help's 'How do I get the item?' names every way the Filters offer, in the Filters' words", () => {
    const a = FAQ_SECTIONS.flatMap((s) => s.items).find((i) => i.q === "How do I get the item?")?.a ?? "";
    for (const w of filterWays) expect(a).toContain(w);
  });
  // Owner 11-09: the Terms' Declutter card uses the same names (wording only, no version bump, no re-accept).
  it("the Terms' Declutter card names every one of them the same way", () => {
    const terms = blankComments(readFileSync(join(SRC, "pages/info/legal/TermsSection.tsx"), "utf8")).replace(/&apos;/g, "'");
    for (const w of filterWays) expect(terms).toContain(`<strong className="text-foreground">${w}</strong>`);
  });
});
