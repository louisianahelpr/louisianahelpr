/**
 * Pre-push a11y-prod sweep, 11-11 (customer-user-profile-self, /user/<id>, phone-light): button geometry
 * siblingMismatch "Free SEED TEST Box of mason jars" 74.0px vs "$18 $19.60 incl. fee SEED TEST T..." 95.6px (same row).
 * A free item has no "incl. fee" line (PriceInclFee renders nothing for $0), so its card link was a line shorter than
 * the priced card beside it: the grid cell stretched, the link inside did not. Each listing card link on the profile
 * screens now fills its grid cell (h-full), so cards in one row are one height whatever their lines.
 *
 * Inventory: every profile-screen listing grid whose card can lose the incl. fee line (SellingNowRow on /user/<id>,
 * PublicProfilePage on /u/<handle>).
 *
 * @mutate src/components/declutter/SellingNowRow.tsx | className="flex h-full items-center gap-2.5 rounded-2xl liquid-glass p-3 | className="flex items-center gap-2.5 rounded-2xl liquid-glass p-3
 * @mutate src/pages/u/PublicProfilePage.tsx | className="block h-full overflow-hidden rounded-xl border | className="block overflow-hidden rounded-xl border
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));

/** The card link opened inside each `<li>` of a grid `<ul>` that also renders <PriceInclFee> (a line a free item drops). */
function gridCardLinks(src: string): string[] {
  const out: string[] = [];
  for (const ul of src.matchAll(/<ul className="grid[^"]*"[\s\S]*?<\/ul>/g)) {
    if (!/<PriceInclFee\b/.test(ul[0])) continue;
    const link = ul[0].match(/<li\b[^>]*>[\s\S]*?<Link\b[\s\S]*?className="([^"]*)"/);
    if (link) out.push(link[1]);
  }
  return out;
}

describe("profile listing cards in one row are one height (a11y-prod siblingMismatch, 11-11)", () => {
  it("each card link fills its grid cell", () => {
    const files = ["src/components/declutter/SellingNowRow.tsx", "src/pages/u/PublicProfilePage.tsx"];
    const links = files.flatMap((f) => gridCardLinks(code(f)).map((cls) => ({ f, cls })));
    expect(links.length).toBeGreaterThan(1);
    for (const { f, cls } of links) expect(cls.split(/\s+/), f).toContain("h-full");
  });
});
