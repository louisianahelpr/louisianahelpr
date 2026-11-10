/**
 * Q2558: the four /shops/* loading placeholders reserve what the 2026-11-02
 * 01:07Z loading-states refresh measured (bot PR #3963, 375, both test
 * accounts; src/test/loadingStateShape.test.ts refused all four):
 *   /shops/orders    two 144px order bones (300px) -> the 98px "No orders yet." card
 *   /shops/dashboard two 144px order bones (300px) -> the 154px "no shop yet" card
 *   /shops/mine      224px of bones -> the 1472px "Open a shop" form
 *   /shops/test      296px of bones -> 345px (the unavailable card)
 * loadingStateShape reads a measurement only a browser run can make, so until
 * the next refresh this pins each placeholder to those numbers in source.
 * jsdom has no layout; the heights are Tailwind arbitrary values read from the
 * code (comments blanked).
 * 2026-11-10 (shops audit F16): /shops/orders no longer pins a number. Its
 * placeholder IS the "No orders yet." card, rendered invisible under one bone,
 * so it equals that card at every width (the fixed 98px went stale the moment
 * the card gained its "Browse shops" button).
 * 2026-11-10 (Builder 1, F12): the other three follow the same rule. Each
 * placeholder IS the screen's shorter loaded shape rendered invisible under one
 * bone: /shops/dashboard the "no shop yet" card, /shops/mine the "Open a shop"
 * form (1472px went stale at 1760px once the form grew), /shops/:id the
 * unavailable card (345px went stale at 369px). No number left to go stale.
 */
// @mutate src/components/shops/ShopMyOrdersView.tsx |           <div className="invisible" aria-hidden>\n            <NoOrdersYet />\n          </div> |           <div className="h-36" aria-hidden />
// @mutate src/components/shops/ShopDashboardView.tsx |             <NoShopYet embedded={embedded} placeholder />\n | \n
// @mutate src/components/shops/ShopEditView.tsx |         <div className="invisible" aria-hidden>\n          {children}\n        </div> |         <div className="h-56" aria-hidden />
// @mutate src/components/shops/ShopView.tsx |         <div className="invisible" aria-hidden>\n          <ShopUnavailable />\n        </div> |         <div className="h-[296px]" aria-hidden />
// @mutate src/components/shops/ShopEditView.tsx | return <ShopEditSkeleton>{formEl}</ShopEditSkeleton>; | return <ShopEditSkeleton>{null}</ShopEditSkeleton>;
// @mutate src/components/shops/ShopDashboardView.tsx |   if (myId.isLoading \|\| (!!myId.data && (orders.isLoading \|\| !payoutSettled))) { |   if (myId.isLoading \|\| (!!myId.data && orders.isLoading)) {
// @mutate src/components/shops/ShopPayoutRow.tsx |   return sw.settled && (!sw.on \|\| hire.settled); |   return true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(process.cwd(), p), "utf8"));

/** The status block a placeholder renders, from its aria-label to the block's end (whitespace collapsed). */
const statusBlock = (src: string, label: string): string => {
  const at = src.indexOf(`aria-label="${label}"`);
  expect(at, `no loading block labelled "${label}"`).toBeGreaterThan(0);
  const start = src.lastIndexOf("<", at);
  return src.slice(start, src.indexOf("<Skeleton", at) + 200).replace(/\s+/g, " ");
};

/** The one shape every /shops placeholder takes: the loaded shape, invisible, under one bone that covers it. */
const HIDDEN_UNDER_ONE_BONE = (label: string, inner: string) =>
  new RegExp(
    `^<div className="relative" role="status" aria-label="${label}"> <div className="invisible" aria-hidden> ${inner} </div> <Skeleton className="absolute inset-0 rounded-[\\w-]+" /> </div>`,
  );

const CASES = [
  { file: "src/components/shops/ShopMyOrdersView.tsx", label: "Loading your orders", inner: "<NoOrdersYet />", loaded: /\.length === 0 \? \(\s*<NoOrdersYet \/>/ },
  { file: "src/components/shops/ShopDashboardView.tsx", label: "Loading your shop's orders", inner: "<NoShopYet embedded=\\{embedded\\} placeholder />", loaded: /<NoShopYet embedded=\{embedded\} \/>/ },
  { file: "src/components/shops/ShopEditView.tsx", label: "Loading your shop", inner: "\\{children\\}", loaded: /<ShopEditSkeleton>\{formEl\}<\/ShopEditSkeleton>/ },
  { file: "src/components/shops/ShopView.tsx", label: "Loading the shop", inner: "<ShopUnavailable />", loaded: /<ShopUnavailable body=/ },
] as const;

describe("Q2558: each /shops placeholder is its screen's shorter loaded shape, hidden under one bone", () => {
  it("checks every case (never passes on an empty list)", () => {
    expect(CASES.length).toBeGreaterThan(3);
  });

  for (const c of CASES) {
    it(`${c.file}: "${c.label}" hides the real shape, which the loaded screen also renders`, () => {
      const src = read(c.file);
      expect(statusBlock(src, c.label)).toMatch(HIDDEN_UNDER_ONE_BONE(c.label, c.inner));
      expect(src).toMatch(c.loaded);
      // No fixed pixel height left to go stale.
      expect(statusBlock(src, c.label)).not.toMatch(/(min-)?h-\[\d+px\]/);
    });
  }

  // Builder 1 2026-11-10: a tester's "Finish setting up" row popped in above the orders (142px at 375, CLS 0.137).
  // The dashboard's one loading gate waits for the row's "is setup offered" answer (fast reads, never Stripe).
  it("the Shop dashboard's loading gate waits for the payout row's answer", () => {
    const dash = read("src/components/shops/ShopDashboardView.tsx");
    expect(dash).toContain("const payoutSettled = useShopPayoutRowSettled();");
    expect(dash).toContain("if (myId.isLoading || (!!myId.data && (orders.isLoading || !payoutSettled))) {");
    const row = read("src/components/shops/ShopPayoutRow.tsx");
    const settled = row.slice(row.indexOf("export function useShopPayoutRowSettled"), row.indexOf("export default function ShopPayoutRow"));
    expect(settled).toContain("return sw.settled && (!sw.on || hire.settled);");
    expect(settled).not.toContain("useStripeConnectStatus");
  });
});
