/**
 * LEAD-TOAST3 (lead 10-31; owner rule: every member-facing toast.success/info is a bug): toast.success, toast.info
 * and toast.message render NOTHING unless the payload carries an `action` (src/lib/toastPolicy.ts). 60 member
 * confirmations on the Declutter, Jobs, quotes, refund, schedule-change and series screens went through them, so the
 * tap looked dead ("Offer accepted", "Pickup times saved", "Quote sent", "Arrival confirmed", ...). They now use the
 * bare toast(), which always renders.
 *
 * The class: no source file under the member screens below calls toast.success/info/message, except the exact list
 * of calls that carry an `action` (those render). The list is exact both ways. Source scan, comments blanked; the
 * walk is the shared walkSource (tracked files only). EndSeriesControl's was missed by the toast inventory (its
 * options are a conditional, never an action), which is why this reads the source and not the inventory.
 *
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | setCounter("");\n      toast(\n | setCounter("");\n      toast.success(\n
 * @mutate src/components/series/EndSeriesControl.tsx |       toast(\n        result.action === "left" |       toast.success(\n        result.action === "left"
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | toast("Arrival confirmed."); | toast.success("Arrival confirmed.");
 * @mutate src/pages/quotes/SendQuotePage.tsx | toast("Quote sent", | toast.info("Quote sent",
 */
import { describe, expect, it } from "vitest";
import { relative, resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MEMBER_ROOTS = [
  "src/components/declutter",
  "src/components/job-card",
  "src/components/quotes",
  "src/components/refund",
  "src/components/schedule",
  "src/components/series",
  "src/pages/quotes",
];
/** Calls that carry an `action` (the toast is the way to what was done), so toastPolicy lets them render. Exact. */
const ACTIONABLE: Record<string, number> = {
  "src/components/declutter/DeclutterDeliveryViews.tsx": 1,
};

function suppressedCalls(): { files: number; hits: Record<string, number> } {
  const files = walkSource(MEMBER_ROOTS.map((r) => resolve(ROOT, r))).filter((f) => !/\.test\.tsx?$/.test(f));
  const hits: Record<string, number> = {};
  for (const f of files) {
    const src = readSource(f);
    if (src === null) continue;
    const n = blankComments(src).match(/\btoast\.(success|info|message)\(/g)?.length ?? 0;
    if (n) hits[relative(ROOT, f)] = n;
  }
  return { files: files.length, hits };
}

describe("member confirmations are shown (bare toast, never a suppressed channel)", () => {
  const { files, hits } = suppressedCalls();

  it("reads the member screens (floor)", () => {
    expect(files).toBeGreaterThan(150);
  });

  it("only the exact actionable calls use toast.success/info/message", () => {
    expect(hits).toEqual(ACTIONABLE);
  });
});
