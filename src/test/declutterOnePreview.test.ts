/**
 * LEAD-ONE-PREVIEW (owner 2026-10-31, asked twice): the seller's "View" and "See what buyers see" opened the same thing.
 * They are one action, "Preview", everywhere the seller meets it: the Selling rows (sellingDash.test.tsx), the Manage
 * listing sheet's first row ("Preview / See your listing as buyers do") and the sheet after posting. Each opens the
 * listing as buyers read it (?preview=buyer).
 *
 * @mutate src/components/declutter/DeclutterManageListing.tsx | <RowText title="Preview">See your listing as buyers do</RowText> | <RowText title="See what buyers see">Your listing as a buyer reads it</RowText>
 * @mutate src/components/declutter/ListedWhatNext.tsx | primary={{ label: "Preview", onClick: () => navigate(`/declutter/item/${it.id}?preview=buyer`) }} | primary={{ label: "See my listing", onClick: () => navigate(`/declutter/item/${it.id}`) }}
 * @mutate src/components/declutter/DeclutterHomeView.tsx | aria-label={`Preview ${item.title}`}>Preview</Link> | aria-label={`See what buyers see of ${item.title}`}>See what buyers see</Link>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const DIR = "src/components/declutter";
const read = (f: string) => blankComments(readFileSync(join(process.cwd(), DIR, f), "utf8"));
/** The seller's own-listing surfaces: the Selling tab, Manage listing and the sheet after posting. */
const SELLER_FILES = ["DeclutterHomeView.tsx", "DeclutterManageListing.tsx", "ListedWhatNext.tsx", "SellingNowRow.tsx", "DeclutterMineViews.tsx"];

describe("LEAD-ONE-PREVIEW: one Preview for the seller", () => {
  it("no seller surface says See what buyers see, See my listing or a bare View", () => {
    let read_ = 0;
    for (const f of SELLER_FILES) {
      const src = read(f);
      read_ += 1;
      // A blanked or stubbed surface would pass the two "not" checks below: each one holds real code.
      expect(src.length, f).toBeGreaterThan(400);
      expect(src, f).not.toMatch(/See what buyers see|See my listing|as a buyer reads it/);
      expect(src, f).not.toMatch(/>View<|label: "View"/);
    }
    expect(read_).toBeGreaterThan(4);
  });

  it("Manage listing's first row and the posted sheet say Preview and open the buyer's view", () => {
    const manage = read("DeclutterManageListing.tsx");
    expect(manage).toMatch(/<Link to=\{`\/declutter\/item\/\$\{item\.id\}\?preview=buyer`\}[^>]*data-manage-preview=""[^>]*>\s*<RowText title="Preview">See your listing as buyers do<\/RowText>/);
    expect(read("ListedWhatNext.tsx")).toMatch(/primary=\{\{ label: "Preview", onClick: \(\) => navigate\(`\/declutter\/item\/\$\{it\.id\}\?preview=buyer`\) \}\}/);
    expect(read("DeclutterHomeView.tsx")).toMatch(/\?preview=buyer`\} aria-label=\{`Preview \$\{item\.title\}`\}>Preview<\/Link>/);
  });
});
