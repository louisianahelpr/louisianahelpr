// RouteSuspenseFallback — structural placeholder rendered while a lazy
// route chunk resolves. Bugs here either re-introduce a full-surface
// loading overlay (which tears down the perception of the persistent
// shell during a route transition — the exact regression TestFlight
// feedback flagged), drop the accessible live region (silent loading
// for screen readers), or throw and surface the route error boundary
// instead of the placeholder.

// @mutate src/components/RouteSuspenseFallback.tsx | <span className="sr-only">Loading…</span>\n  </div> | <span className="sr-only">Loading…</span>\n    <div aria-hidden="true" className="h-6 rounded-ds-sm motion-safe:animate-pulse" />\n  </div>
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
    //
    // Pinned as "NO fill of ANY kind" rather than "not this one token": the
    // original assertion named a single spelling of one colour, so the same
    // regression written `bg-parchment`, `bg-white`, or an inline
    // `style={{ background }}` would have walked straight past it. jsdom
    // resolves no Tailwind, so this reads the class STRING and the inline
    // style object — neither is a painted pixel, but between them they are
    // every way this element can acquire a surface.
    render(<RouteSuspenseFallback />);
    const region = screen.getByTestId("route-suspense-fallback");

    const fills = region.className.split(/\s+/).filter((c) => /^(bg-|backdrop-)/.test(c));
    expect(fills, "the route fallback must not paint its own surface").toEqual([]);
    expect(region.getAttribute("style"), "no inline fill either").toBeNull();

    // Nor centre its content like a brand card: the bones align to the
    // route's normal body column, top-aligned, so the shell keeps its shape.
    expect(region.className).not.toContain("items-center");
    expect(region.className).not.toContain("justify-center");
    // No <img> (brand mark) inside the placeholder.
    expect(region.querySelector("img")).toBeNull();
    // No <svg> either — a centred logo is just as often inline SVG.
    expect(region.querySelector("svg")).toBeNull();
  });

  it("draws nothing but the page background: no placeholder shapes", () => {
    render(<RouteSuspenseFallback />);
    const region = screen.getByTestId("route-suspense-fallback");
    expect(region.querySelectorAll("[aria-hidden='true']")).toHaveLength(0);
    expect(region.innerHTML).not.toMatch(/animate-pulse|shimmer|rounded/);
    expect(region.children).toHaveLength(1); // only the sr-only label
  });
});
