/**
 * Homes -> Buy says no negotiating and no commission (owner 2026-10-18 ~03:30Z:
 * "verified owners, no commission / no negotiating, title company / attorney
 * closes"). Every word a member reads on the Buy screens (string literals,
 * template text and JSX text, through the TypeScript AST; comments and
 * identifiers are not copy) is checked: no offers, no bargaining, no agents or
 * realtors, and "commission" only in "No commission". The Buy list and the
 * for-sale page must also SAY how it works (verified owner, no commission, a
 * title company or attorney closes). Behaviour (the server flags seller text
 * like "OBO"): src/test/pglite/homesSaleListings.pglite.mjs.
 *
 * @mutate src/components/rentals/listings/SaleListingEditor.tsx | One price, shown as you set it. | One price, negotiable with buyers.
 * @mutate src/lib/rentals/listingCopy.ts | No commission. A title company or attorney handles the closing."; | A title company handles the closing.";
 * @mutate src/components/rentals/HomesBrowse.tsx | Homes listed by their verified owners. No commission. | Homes listed by owners and agents. No commission.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { RENTALS_ERROR_COPY } from "@/lib/rentals/errorCopy";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const ROOT = path.resolve(__dirname, "../..");
const BUY_FILES = [
  "src/components/rentals/HomesBrowse.tsx",
  "src/components/rentals/listings/RentBrowse.tsx",
  "src/components/rentals/listings/SaleListingEditor.tsx",
  "src/components/rentals/listings/ListingView.tsx",
  "src/components/rentals/listings/editorParts.tsx",
  "src/lib/rentals/listingCopy.ts",
];
/** The Buy error words (errorCopy.ts is shared with the rest of Homes, so only these keys are Buy copy). */
const BUY_ERROR_KEYS = ["property_already_listed", "property_not_found", "listing_fee_not_ready", "sale_wording_flagged"];
const BARGAIN = /\b(negotia\w*|haggl\w*|bargain\w*|best\s+offer|offers?|counter-?offers?|obo|realtors?|agents?|brokers?|commissions?)\b/i;

/** Every piece of copy in a source file. */
export function copyStrings(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The bargaining words in a copy string ("No commission" itself is the promise, not a breach). */
export const bargainHits = (text: string): string | null => {
  const m = BARGAIN.exec(text.replace(/\bNo commission\b/g, ""));
  return m ? m[0] : null;
};

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Homes -> Buy copy: no negotiating, no commission", () => {
  it("the detector sees bargaining words and lets 'No commission' through", () => {
    expect(bargainHits("Price negotiable")).toBe("negotiable");
    expect(bargainHits("Make an offer today")).toBe("offer");
    expect(bargainHits("Talk to our agent")).toBe("agent");
    expect(bargainHits("3% commission")).toBe("commission");
    expect(bargainHits("No commission. A title company or attorney handles the closing.")).toBeNull();
    expect(copyStrings("a.tsx", 'const a = <p>Make an offer</p>; const b = "x"; // offer')).toEqual(["Make an offer", "x"]);
  });

  it("reads every Buy file (inventory floor)", () => {
    const n = BUY_FILES.reduce((acc, f) => acc + copyStrings(f, read(f)).length, 0);
    expect(n).toBeGreaterThan(100);
  });

  it.each(BUY_FILES)("%s: no copy invites bargaining or names an agent or a commission", (f) => {
    const hits = copyStrings(f, read(f))
      .map((s) => [s, bargainHits(s)] as const)
      .filter(([, h]) => h)
      .map(([s, h]) => `${h}: ${s.trim().slice(0, 100)}`);
    expect(hits).toEqual([]);
  });

  it("the Buy error words carry no bargaining word either", () => {
    const words = [
      ...BUY_ERROR_KEYS.map((k) => RENTALS_ERROR_COPY[k]),
      ...Object.values(RPC_ERROR_COPY.rentals_save_sale_listing ?? {}),
    ];
    expect(words.filter((w) => typeof w === "string").length).toBeGreaterThan(10);
    expect(words.filter((w) => bargainHits(String(w)))).toEqual([]);
  });

  it("the Buy list and the for-sale page say how it works: verified owner(s), no commission, a title company or attorney closes", () => {
    const how = /verified owners?\. No commission\. A title company or attorney handles the closing\./;
    expect(copyStrings("HomesBrowse.tsx", read("src/components/rentals/HomesBrowse.tsx")).some((s) => how.test(s))).toBe(true);
    expect(copyStrings("listingCopy.ts", read("src/lib/rentals/listingCopy.ts")).some((s) => how.test(s))).toBe(true);
    expect(read("src/components/rentals/listings/ListingView.tsx")).toMatch(/\{sale && <p[^>]*>\{SALE_HOW_IT_WORKS\}<\/p>\}/);
  });
});
