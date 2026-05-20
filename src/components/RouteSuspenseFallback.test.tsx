// RouteSuspenseFallback — branded per-route Suspense fallback. Bugs here
// either tear down the persistent shell during a route transition (if it
// renders fullscreen overlays), ignore Reduced Motion (the fade-in still
// plays for users who explicitly disabled animations), or throw during
// loading and surface the route error boundary instead of the skeleton.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { RouteSuspenseFallback } from "./RouteSuspenseFallback";

// Helper to install a controllable matchMedia mock for the
// `(prefers-reduced-motion: reduce)` query useReducedMotion listens to.
function installReducedMotion(reduced: boolean) {
  const mql = {
    matches: reduced,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql),
  });
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("RouteSuspenseFallback", () => {
  it("renders without throwing and exposes a polite live region", () => {
    installReducedMotion(false);
    render(<RouteSuspenseFallback />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("applies the fade-in animation classes by default", () => {
    installReducedMotion(false);
    render(<RouteSuspenseFallback />);
    const region = screen.getByTestId("route-suspense-fallback");
    expect(region.className).toContain("animate-in");
    expect(region.className).toContain("fade-in");
  });

  it("skips the fade-in animation when the user prefers reduced motion", () => {
    installReducedMotion(true);
    render(<RouteSuspenseFallback />);
    const region = screen.getByTestId("route-suspense-fallback");
    expect(region.className).not.toContain("animate-in");
    expect(region.className).not.toContain("fade-in");
  });
});
