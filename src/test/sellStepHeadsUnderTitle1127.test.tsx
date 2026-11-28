/**
 * Polish audit 11-27 #62 (11-25 #33 still open; ~/.lh-shots/polish-audit-1127/declutter/sell--in-375--1.png): Sell an
 * item stacked the 28px page title over a step heading as big ("Show it off": 28px computed at 375/390 on live www).
 * Every step question is 20px now, one size under the page title, as Post a job's step question already is (design
 * audit r2 #4, designAuditR2.test.ts).
 *
 * Inventory: every <StepHead> call in the two Sell screens (it renders all six step questions).
 *
 * @mutate src/components/declutter/DeclutterSellSteps.tsx | <h2 id="sell-step" className="font-display font-moment text-ds-20 | <h2 id="sell-step" className="font-display font-moment text-ds-32
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StepHead } from "@/components/declutter/DeclutterSellSteps";
import { blankComments } from "./helpers/blankNonCode";

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("Sell an item: the step headings sit one size under the page title", () => {
  it("inventory: the Sell screens draw their step questions with StepHead", () => {
    const n = ["src/components/declutter/DeclutterSellView.tsx", "src/components/declutter/SellOneScreen.tsx"]
      .map((f) => (src(f).match(/<StepHead\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(4);
  });

  it("StepHead's question is 20px (text-ds-20), not 32px", () => {
    const { container } = render(<StepHead title="Show it off" sub="Add 1 to 3 photos." />);
    const h = container.querySelector("h2#sell-step") as HTMLElement;
    expect(h.textContent).toBe("Show it off");
    expect(h.className).toMatch(/\btext-ds-20\b/);
    expect(h.className).not.toMatch(/\btext-ds-(2[1-9]|3\d)\b/);
  });
});
