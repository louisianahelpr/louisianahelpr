/**
 * CLASS GUARD (lead walkthrough 2026-10-28): Declutter's money, handover and delivery moments ask in an in-app sheet
 * (DeclutterConfirmSheet, DeclutterReserveSheet, the handover sheets), never the browser's window.confirm (a grey
 * system box with no total, no app styling, and on iOS the page's address as its title).
 *
 * Inventory from source: every non-test .ts/.tsx file under src/components/declutter and src/pages/declutter,
 * comments blanked. ZERO window.confirm in every file except the two the sell-flow builder owns (lead 2026-10-28:
 * "leave seller-listing ones to the sell-flow builder"), whose count is EXACT (two-way): moving one of them to a sheet
 * lowers it in the same commit.
 *
 * Deep audit 2026-10-28 #59 (one confirm style): no Declutter screen uses the generic BrandConfirmDialog either; every
 * "are you sure" is the ConfirmSheet (or the handover / reserve sheets built from the same parts).
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | import { ConfirmSheet } from "./DeclutterConfirmSheet";\n | import { ConfirmSheet } from "./DeclutterConfirmSheet";\nimport { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";\nvoid BrandConfirmDialog;\n
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const confirmBuy = () => setReserve("ask"); |   const confirmBuy = () => { if (window.confirm("Buy?")) buy.mutate(); };
 * @mutate src/components/declutter/DeclutterSalesWaiting.tsx |               onClick={() => setAsking(l.item_id)} |               onClick={() => { if (window.confirm("Cancel?") && l.item_id) cancel.mutate(l.item_id); }}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([join(ROOT, "src/components/declutter"), join(ROOT, "src/pages/declutter")])
  .filter((f) => !/\.test\.tsx?$/.test(f));

/** The sell-flow builder's files and how many each still has: none now (the moving sale's end moved to a sheet; the Selling tab's take-down moved to ConfirmSheet, #18). */
const SELL_FLOW_CONFIRMS: Record<string, number> = {
};

const sites = () =>
  files.flatMap((f) => {
    const n = (blankComments(readFileSync(f, "utf8")).match(/\bwindow\.confirm\s*\(/g) ?? []).length;
    return n ? [{ file: relative(ROOT, f), n }] : [];
  });

describe("Declutter asks in the app, not with window.confirm", () => {
  it("reads a real Declutter source tree", () => {
    expect(files.length).toBeGreaterThan(60);
    for (const f of ["DeclutterOfferPanel.tsx", "DeclutterDeliveryViews.tsx", "SellerDeliveryOrder.tsx", "DeclutterSalesWaiting.tsx", "DeclutterTradeViews.tsx"]) {
      expect(files.some((x) => x.endsWith(`/${f}`)), f).toBe(true);
    }
  });

  it("no buyer, delivery or sale screen uses window.confirm", () => {
    expect(sites().filter((s) => !(s.file in SELL_FLOW_CONFIRMS))).toEqual([]);
  });

  it("#59: one confirm style, no BrandConfirmDialog in any Declutter screen", () => {
    const generic = files.flatMap((f) => (/\bBrandConfirmDialog\b/.test(blankComments(readFileSync(f, "utf8"))) ? [relative(ROOT, f)] : []));
    expect(generic).toEqual([]);
    // The inventory sees the sheet it asks for.
    expect(files.filter((f) => /\bConfirmSheet\b/.test(readFileSync(f, "utf8"))).length).toBeGreaterThan(4);
  });

  it("the sell-flow builder's files hold exactly their listed count (lower it when one moves to a sheet)", () => {
    const left = Object.fromEntries(sites().filter((s) => s.file in SELL_FLOW_CONFIRMS).map((s) => [s.file, s.n]));
    expect(left).toEqual(SELL_FLOW_CONFIRMS);
  });
});
