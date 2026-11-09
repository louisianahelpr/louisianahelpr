// @mutate src/components/declutter/DeclutterItemCard.tsx |       aria-label={cardLinkLabel(item.title, item.current_price_cents)}\n |
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | Meet at a safe spot (a public place, no home address shared), | pickup at the seller's door,
// @mutate src/pages/info/legal/TermsSection.tsx | <strong className="text-foreground">Meet at a safe spot</strong> | <strong className="text-foreground">pickup at the seller&apos;s door</strong>
// @mutate src/components/declutter/DeclutterItemCard.tsx |   if (!save && guestSaveTo) { |   if (!save && guestSaveTo && saves === -1) {
// @mutate src/lib/jobIntent.ts |   if (reason === SAVE_ITEM_REASON) return t("signup.saveItemSubtitle"); |
// @mutate src/components/declutter/DeclutterItemCard.tsx |             alt={item.title} |             alt=""
// @mutate src/components/declutter/DeclutterMineViews.tsx | label: "Pickups to do", | label: "Hand over",
// @mutate src/components/declutter/ManagerPanel.tsx |       <h2 id="manager-setup-title" className="text-base font-semibold">Have someone sell for you</h2> |       <h2 id="manager-setup-title" className="text-base font-semibold">Get help selling</h2>
// @mutate src/App.tsx | <Route path="/declutter/wanted/new" element={<Navigate to="/declutter?tab=wanted&post=1" replace />} /> |
// @mutate src/components/declutter/DeclutterListingDefaults.tsx | `Lowers ${draft.dropPct}% each evening, never below your lowest price.` | `It drops ${draft.dropPct}% each evening, to a whole dollar, never below your lowest price.`
// @mutate src/components/declutter/DeclutterListingDefaults.tsx | <ChipGroup label="Lowest price" | <ChipGroup label="Lowest you'll take"
// @mutate src/components/declutter/ItemPickupBlock.tsx |   const others = cities.filter((c) => c && !same(c)); |   const others = cities.filter((c) => !!c);
// @mutate src/components/declutter/itemPhotoFrame.ts | sm:max-h-[max(55dvh,calc(100dvh-400px))] | sm:max-h-none
// @mutate src/lib/largeTitles.ts |     doc.documentElement.classList.toggle("page-scrolled-any", t.scrollTop > 0); |     doc.documentElement.classList.toggle("page-scrolled-any", t.scrollTop > 24);
// @mutate src/components/sections/InlineListSearch.tsx |     if (pinned) return;\n    reopenFocus.current = focusTrigger; |     reopenFocus.current = focusTrigger;
/**
 * Declutter findings from the UI audit of 11-09 (~/.lh-shots/ui-audit-1109, Builder 2). One describe per finding.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fireEvent, render } from "@testing-library/react";
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
import { SAVE_ITEM_REASON, SAVE_ITEM_SIGNUP_SUBTITLE, signupSubtitle } from "@/lib/jobIntent";
import { blankComments } from "@/test/helpers/blankNonCode";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const card = (over: Record<string, unknown> = {}) => ({
  id: "i9", seller_id: "u2", status: "live", title: "Kinetic Sand SquishBlossom Set", category: "toys", condition_stars: 4,
  price_cents: 300, current_price_cents: 300, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, ...over,
}) as never;

describe("F050: every Declutter card link has a name (title and the price the card shows)", () => {
  it("a paid card is named '<title>, $X.XX incl. fee'; a free one '<title>, Free'", () => {
    const paid = render(<MemoryRouter><ItemCard item={card()} miles={null} approximate={false} /></MemoryRouter>);
    expect(paid.getByRole("link").getAttribute("aria-label")).toMatch(/^Kinetic Sand SquishBlossom Set, \$\d+\.\d{2} incl\. fee$/);
    paid.unmount();
    const free = render(<MemoryRouter><ItemCard item={card({ price_cents: 0, current_price_cents: 0 })} miles={null} approximate={false} /></MemoryRouter>);
    expect(free.getByRole("link").getAttribute("aria-label")).toBe("Kinetic Sand SquishBlossom Set, Free");
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
    expect(r.container.querySelector("img")?.getAttribute("alt")).toBe("Kinetic Sand SquishBlossom Set");
    r.unmount();
  });
});

describe("F128: Selling's unclear phrases are plain words", () => {
  it("the sales to hand over are 'Pickups to do'; the helper is 'Have someone sell for you' (they keep a share)", () => {
    const mine = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterMineViews.tsx"), "utf8"));
    const mgr = blankComments(readFileSync(join(SRC, "components/declutter/ManagerPanel.tsx"), "utf8"));
    expect(mine).toContain('{ key: "sold", label: "Pickups to do", count: todo?.salesOpen ?? 0, hot: true },');
    expect(mine).not.toContain('label: "Hand over"');
    expect((mgr.match(/>Have someone sell for you</g) ?? []).length).toBe(2);
    expect(mgr).not.toMatch(/Get help selling|, for a share\./);
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
  });
  it("Browse pins it; Jobs does not", () => {
    const browse = blankComments(readFileSync(join(SRC, "components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(browse).toContain('<InlineListSearch value={query} onChange={setQuery} label="Search items" pinned />');
    const others = walk(join(SRC, "components")).concat(walk(join(SRC, "pages")))
      .filter((f) => !f.endsWith("DeclutterBrowseView.tsx"))
      .map((f) => blankComments(readFileSync(f, "utf8")))
      .filter((t) => /<InlineListSearch\b/.test(t));
    expect(others.length).toBeGreaterThan(0);
    for (const t of others) expect(t).not.toMatch(/<InlineListSearch\b[^>]*\bpinned\b/);
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
