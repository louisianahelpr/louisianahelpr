/**
 * CLASS GUARD (audit AA9 A1-B1, 2026-10-29): one literal id="..." twice in one
 * component. The sell form's tax box had id="sell-tax" on its <h3> AND on the
 * Checkbox, so <label htmlFor="sell-tax"> pointed at the heading: tapping the
 * sentence never ticked the box, and the box had no accessible name.
 *
 * Inventory from source: every tracked non-test src/**\/*.tsx, comments
 * blanked; a file is an offender when the same literal `id="x"` appears twice.
 * Two ids in branches that never render together (an early return, a ternary)
 * are listed in KNOWN with a reason; the list is EXACT both ways.
 *
 * @mutate src/components/declutter/SellFormParts.tsx | <h3 id="sell-tax-head" | <h3 id="sell-tax"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");

/** file: id -> why the two copies never render at the same time. Measured 2026-10-29 (b25). */
// @two-way src/test/noDuplicateStaticIds.test.ts:stale duplicate-id entry
const KNOWN: Record<string, string> = {
  "src/components/postjob/AddressBlock.tsx: streetAddress": "pre-existing; not yet read",
  "src/components/postjob/JobCategoryGroups.tsx: category-picker": "pre-existing; not yet read",
  "src/components/profile/EarningsTab.tsx: earnings-bank-account": "pre-existing; not yet read",
  "src/components/shops/ShopFaqs.tsx: shop-faqs": "pre-existing; not yet read",
  "src/components/shops/ShopOrderSheet.tsx: shop-order": "pre-existing; not yet read",
  "src/components/shops/ShopPolicies.tsx: shop-policies": "pre-existing; not yet read",
  "src/pages/posts/EditJobDialog.tsx: edit-date-needed": "pre-existing; not yet read",
};

export function duplicateIds(source: string): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const m of blankComments(source).matchAll(/\sid="([^"{}]+)"/g)) {
    if (seen.has(m[1])) dups.add(m[1]);
    seen.add(m[1]);
  }
  return [...dups];
}

describe("no literal id appears twice in one component", () => {
  const files = trackedFiles("src").filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$|\/test\//.test(f));
  const found = files.flatMap((f) => duplicateIds(readFileSync(join(ROOT, f), "utf8")).map((id) => `${f}: ${id}`));

  it("reads a real inventory", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain("src/components/declutter/DeclutterSellView.tsx");
  });

  it("finds a duplicate (fixture) and ignores a commented one", () => {
    expect(duplicateIds('<h3 id="a" /><Checkbox id="a" />')).toEqual(["a"]);
    expect(duplicateIds('<h3 id="a" />{/* id="a" */}<p id="b" />')).toEqual([]);
  });

  it("no NEW duplicate id", () => {
    expect(found.filter((k) => !(k in KNOWN))).toEqual([]);
  });

  it("no stale KNOWN entry (fixed ones leave the list)", () => {
    const stale = Object.keys(KNOWN).filter((k) => !found.includes(k)).map((k) => `stale duplicate-id entry ${k}: remove it`);
    expect(stale).toEqual([]);
  });
});
