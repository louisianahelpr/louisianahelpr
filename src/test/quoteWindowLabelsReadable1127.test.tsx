/**
 * Polish audit 11-27 #116 (~/.lh-shots/polish-audit-1127/FINDINGS.md, jobs/combo-post4.png): with Get quotes picked,
 * the "24 hours / 48 hours / 3 days" switch drew the shared SegmentedControl's 11px labels under the 15px
 * "Set a price / Get quotes" switch (Q2611). Both switches now use the same 15px labels and 44px segments.
 * Inventory: every option of both switches.
 *
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx | const QUOTE_WINDOW_OPTION_TEXT = "text-ds-15"; | const QUOTE_WINDOW_OPTION_TEXT = "";
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/hideUnopenedInApp", () => ({ hideUnopenedInApp: () => false }));

import { PriceModeChoice, QuoteRequestSection } from "@/components/quotes/PostJobQuoteChoice";

const sizeOf = (el: HTMLElement) => (el.className.match(/\btext-ds-\d+\b/g) ?? []).join(" ");

describe("#116: the quote window switch reads like the price switch", () => {
  it("every option of both switches is 15px and 44px tall", () => {
    render(
      <MemoryRouter>
        <PriceModeChoice value="quotes" onChange={() => {}} />
        <QuoteRequestSection stepNumber={3} windowHours={48} onWindowChange={() => {}} />
      </MemoryRouter>,
    );
    const options = screen.getAllByRole("radio");
    expect(options.length).toBeGreaterThan(4);
    for (const o of options) {
      expect(sizeOf(o), o.textContent ?? "").toBe("text-ds-15");
      expect(o.className).toMatch(/\bmin-h-11\b|\bmin-h-12\b/);
    }
    cleanup();
  });
});
