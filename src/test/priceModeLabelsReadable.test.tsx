/**
 * Q2611 (Jobs audit 1102b row 25): on Post a job's price step the "Set a price / Get quotes" labels were the shared
 * SegmentedControl's 11 px (text-ds-11) inside a 630 px wide pill. The choice's labels are now the page's body size
 * (text-ds-15), and "Coming soon" under Get quotes is 12 px, not 10.
 * (The jump from "1 of 6" to "3 of 6" for a one-kind group is the owner's 10-21 fixed numbering, postJobScreens.ts.)
 *
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx | optionClassName="text-ds-15" | optionClassName=""
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx | <span className="text-ds-12 font-medium">Coming soon</span> | <span className="text-ds-10 font-medium">Coming soon</span>
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/hideUnopenedInApp", () => ({ hideUnopenedInApp: () => false }));

import { PriceModeChoice } from "@/components/quotes/PostJobQuoteChoice";

describe("Q2611: the price choice's labels are readable", () => {
  for (const soon of [false, true]) {
    it(`both options at body size (quotes ${soon ? "coming soon" : "open"})`, () => {
      render(<PriceModeChoice value="price" onChange={() => {}} quotesComingSoon={soon} />);
      const options = screen.getAllByRole("radio");
      expect(options.length).toBe(2);
      for (const o of options) {
        expect(o.className).toMatch(/\btext-ds-15\b/);
        expect(o.className).not.toMatch(/\btext-ds-11\b/);
      }
      const soonLine = screen.queryByText("Coming soon");
      if (soon) expect(soonLine?.className).toMatch(/\btext-ds-12\b/);
      else expect(soonLine).toBeNull();
    });
  }
});
