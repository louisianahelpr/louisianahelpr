// @mutate src/components/declutter/DeclutterHandoverViews.tsx | const waitingOnReads = bookings.isLoading \|\| payouts.isLoading; | const waitingOnReads = false as boolean;
// @mutate src/components/declutter/DeclutterTabParts.tsx | {Array.from({ length: Math.min(4, Math.max(1, cards)) }, (_, i) => ( | {Array.from({ length: 1 }, (_, i) => (
// @mutate src/components/declutter/DeclutterMineViews.tsx | if (t.ready && t.live.length > 0 && !t.pickupsSettled) return <DeclutterTabBones />; | void DeclutterTabBones;
/**
 * F409 (whole-app audit 11-10; measured B3g 11-12 on a local build against read-only prod data, 375):
 * - Selling (poster-e2e, a seeded seller with paid sales): CLS 0.42-0.78 -> 0.002. The paid-orders fallback was ONE
 *   112px box however many sales were coming, and each card drew before its pickup booking and payout answered, then
 *   grew; Offers drew under them and were pushed off screen.
 * - Buying (helper-e2e, a seeded buyer with pickups today): CLS 0.33-0.58 -> 0.07-0.09. "Your pickups today" drew at the
 *   TOP once bookings and open problems answered, pushing the chips and cart down 289px.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("F409: Selling and Buying hold card-sized bones until their reads answer", () => {
  it("PaidOrdersSection keeps a card's height per card (first 4) until bookings and payouts answer", () => {
    const s = read("components/declutter/DeclutterHandoverViews.tsx");
    expect(s).toContain("const waitingOnReads = bookings.isLoading || payouts.isLoading;");
    expect(s).toContain("style={waitingOnReads ? { minHeight: `${Math.min(4, shown.length) * 16.75 + 2}rem` } : undefined}");
  });
  it("the lazy fallback holds one h-64 box per card it waits for (up to 4)", () => {
    const s = read("components/declutter/DeclutterTabParts.tsx");
    expect(s).toMatch(/Array\.from\(\{ length: Math\.min\(4, Math\.max\(1, cards\)\) \}, \(_, i\) => \(\s*<div key=\{i\} className="h-64 /);
    expect(s).toMatch(/<PaidOrdersLoading heading=\{paidHeading\} label=\{paidLabel\} cards=\{/);
  });
  it("Buying waits for the pickup card's reads before drawing the tab", () => {
    expect(read("components/declutter/DeclutterMineViews.tsx")).toContain("if (t.ready && t.live.length > 0 && !t.pickupsSettled) return <DeclutterTabBones />;");
    expect(read("components/declutter/BuyingOrders.tsx")).toContain("pickupsSettled: !bookings.isLoading && problemsRead.answered");
    expect(read("components/declutter/useOpenProblems.ts")).toContain("answered: !q.isLoading");
  });
});
