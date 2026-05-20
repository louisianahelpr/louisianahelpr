// RouteSuspenseFallback — structural placeholder rendered while a lazy
// route chunk resolves. Bugs here either re-introduce a full-surface
// loading overlay (which tears down the perception of the persistent
// shell during a route transition — the exact regression TestFlight
// feedback flagged), drop the accessible live region (silent loading
// for screen readers), or throw and surface the route error boundary
// instead of the placeholder.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RouteSuspenseFallback } from "./RouteSuspenseFallback";

describe("RouteSuspenseFallback", () => {
  it("renders a polite live region with an aria-busy status role", () => {
    render(<RouteSuspenseFallback />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("exposes a screen-reader-only Loading label", () => {
    render(<RouteSuspenseFallback />);
    const label = screen.getByText("Loading…");
    expect(label).toBeInTheDocument();
    // Visually hidden — visible UI should NOT show a "Loading…" caption;
    // the persistent shell remains the user's visual context.
    expect(label.className).toContain("sr-only");
  });

  it("does not paint a full-surface background over the persistent shell", () => {
    // Regression guard against the PR #276 design that filled the route
    // slot with a parchment-colored card and centered logo. The new
    // placeholder is intentionally transparent so the shell shows
    // through during route swaps.
    render(<RouteSuspenseFallback />);
    const region = screen.getByTestId("route-suspense-fallback");
    expect(region.className).not.toMatch(/bg-\[hsl\(var\(--parchment\)\)\]/);
    expect(region.className).not.toContain("items-center");
    expect(region.className).not.toContain("justify-center");
    // No <img> (brand mark) inside the placeholder.
    expect(region.querySelector("img")).toBeNull();
  });
});
