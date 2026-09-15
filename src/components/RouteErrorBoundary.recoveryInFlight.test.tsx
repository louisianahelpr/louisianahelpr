/**
 * While a stale-chunk recovery reload is on its way, the route shows its quiet
 * reloading state — never the error card, and nothing is reported.
 *
 * nightly-webkit 34924529210 (stale-deploy · /browse and /profile, "warm, guard
 * NOT armed") caught the card BEFORE the automatic reload. Measured on the
 * preview build in WebKit, every run: `vite:preloadError` → recovery starts
 * (main.tsx calls preventDefault) → Vite resolves the import with `undefined`
 * → React.lazy throws "undefined is not an object (evaluating
 * 'e._result.default')" → "This page hit a problem." at +15ms → pagehide at
 * +37ms. That TypeError is not a chunk error by message, so the boundary's
 * existing `recovering` path never saw it. This drives the same sequence with
 * the REAL chunkReload module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => report(...args),
  installGlobalErrorHandlers: vi.fn(),
}));

import RouteErrorBoundary from "./RouteErrorBoundary";
import { __resetChunkReloadForTests, recoverFromChunkError } from "@/lib/chunkReload";

/** What React.lazy throws when a prevented preload resolved the import with `undefined` (WebKit wording). */
const PreventedPreloadLazy = (): never => {
  throw new TypeError("undefined is not an object (evaluating 'e._result.default')");
};

const originalLocation = window.location;

beforeEach(() => {
  report.mockReset();
  sessionStorage.clear();
  __resetChunkReloadForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, href: "http://localhost/browse", pathname: "/browse", replace: vi.fn() },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  __resetChunkReloadForTests();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
});

const renderRoute = () =>
  render(
    <MemoryRouter initialEntries={["/browse"]}>
      <Routes>
        <Route path="/browse" element={<RouteErrorBoundary><PreventedPreloadLazy /></RouteErrorBoundary>} />
      </Routes>
    </MemoryRouter>,
  );

describe("RouteErrorBoundary while a recovery reload is in flight", () => {
  it("shows the quiet reloading state, not the error card, and reports nothing", () => {
    // main.tsx's vite:preloadError handler: the automatic reload starts now.
    expect(recoverFromChunkError()).toBe(true);

    renderRoute();

    expect(screen.queryByText(/This page hit a problem/)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
    expect(report).not.toHaveBeenCalled();
  });

  it("control: the same error with NO reload in flight is a real failure — card and report", () => {
    renderRoute();

    expect(screen.getByText(/This page hit a problem/)).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
