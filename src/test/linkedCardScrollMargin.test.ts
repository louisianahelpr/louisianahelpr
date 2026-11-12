// @mutate src/components/declutter/DeclutterHandoverViews.tsx | className="scroll-mt-3 rounded-[20px] border | className="rounded-[20px] border
// @mutate src/components/declutter/DeclutterOffersSection.tsx | className={`scroll-mt-3 rounded-[20px] | className={`rounded-[20px]
/**
 * F383 / F359 deep-link half (whole-app audit 11-10; measured B3g 11-12 on a local build against read-only prod data).
 * A notice's ?order= / ?offer= link scrolls its card with scrollIntoView({ block: "start" }) inside the tab's scroller
 * (.page-measure). The section header (title, search, tabs) sits OUTSIDE that scroller: at 375 it ends at y=169 and the
 * scroller starts there; at 1440 the fixed top bar is 70px (--desktop-bar-h) and the scroller starts at y=127. A card
 * scrolled to "start" sat flush against the tab rule with its title touching it (0px). Both linked cards now carry
 * scroll-mt-3, so the jump leaves the shell's 12px gap (--shell-gap) between the tabs and the card's title and price.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("F383: a deep-linked order or offer card keeps a gap under the header", () => {
  it("the order card (useScrollToLinkedOrder target) has scroll-mt-3", () => {
    expect(read("components/declutter/DeclutterHandoverViews.tsx")).toMatch(/<article ref=\{cardRef\}[^>]*className="scroll-mt-3 /);
  });
  it("the offer row (?offer=) has scroll-mt-3", () => {
    expect(read("components/declutter/DeclutterOffersSection.tsx")).toMatch(/<li ref=\{rowRef\}[^>]*className=\{`scroll-mt-3 /);
  });
});
