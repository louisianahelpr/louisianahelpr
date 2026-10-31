/**
 * NIGHT-SAVEDS1-SS-8: "Save this search" changed shape: full width on Declutter Browse with no results (its list is
 * a flex column there, which stretches its children), a small pill everywhere else. The pill sizes to its words in
 * any column (self-start). Class-level check (jsdom has no layout); a tester confirms it on screen.
 *
 * @mutate src/components/savedSearches/SaveSearchButton.tsx | className="self-start inline-flex | className="inline-flex
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./SaveSearchSheet", () => ({ SaveSearchSheet: () => null }));

import { SaveSearchButton } from "./SaveSearchButton";

describe("the Save this search pill keeps one shape", () => {
  it("never stretches in a flex column", () => {
    render(
      <div className="flex flex-col">
        <SaveSearchButton userId="u1" draft={{ section: "declutter", query: "chair", category: null, minDollars: null, maxDollars: null, radiusMiles: null }} />
      </div>,
    );
    const pill = screen.getByTestId("save-search");
    expect(pill.className.split(/\s+/)).toContain("self-start");
    expect(pill.className).not.toMatch(/\bw-full\b|\bself-stretch\b/);
  });
});
