// @mutate src/components/declutter/DeclutterItemCard.tsx |       aria-label={cardLinkLabel(item.title, item.current_price_cents)}\n |
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | Meet at a safe spot (a public place, no home address shared), | pickup at the seller's door,
// @mutate src/pages/info/legal/TermsSection.tsx | <strong className="text-foreground">Meet at a safe spot</strong> | <strong className="text-foreground">pickup at the seller&apos;s door</strong>
/**
 * Declutter findings from the UI audit of 11-09 (~/.lh-shots/ui-audit-1109, Builder 2). One describe per finding.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { HANDOVER_TITLE } from "@/components/declutter/handoverCopy";
import { OTHER_WAYS } from "@/lib/declutter/browseFilters";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";
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
