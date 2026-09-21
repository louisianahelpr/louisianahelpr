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
import {
  __resetChunkReloadForTests,
  CHUNK_RELOAD_MAX_ATTEMPTS,
  isRecoveryReloadInFlight,
  recoverFromChunkError,
} from "@/lib/chunkReload";

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

  // IT MUST RELEASE, NOT JUST ENGAGE. The flag silences the card AND the
  // report, so a path that arms it without a reload actually arriving would
  // swallow every subsequent route crash in the session with no trace at all.
  // The two ways recovery declines to start:
  it("does not arm the flag when recovery declines to start — offline", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(recoverFromChunkError()).toBe(false);
    expect(isRecoveryReloadInFlight()).toBe(false);
    onLine.mockRestore();

    renderRoute();
    // Offline changes the wording, not the fact that this is a reported failure.
    expect(screen.getByText(/This page hit a problem|You're offline/)).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("does not arm the flag when the automatic attempts are already spent", () => {
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
    sessionStorage.setItem("helpr_chunk_reload_count", String(CHUNK_RELOAD_MAX_ATTEMPTS));
    expect(recoverFromChunkError()).toBe(false);
    expect(isRecoveryReloadInFlight()).toBe(false);

    renderRoute();
    expect(screen.getByText(/This page hit a problem/)).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

// Arming the flag is what turns the error card and the Sentry report off. If
// hardReloadBypassCache stops setting it, the WebKit stale-deploy sequence is
// back: card at +15ms, pagehide at +37ms, one bogus Sentry event per reload.
// @mutate src/lib/chunkReload.ts | recoveryReloadInFlight = true; | recoveryReloadInFlight = false;
// And the boundary must read it on the FIRST fallback render, not only in
// componentDidCatch — otherwise the card commits for a frame before the quiet
// state replaces it, which is the thing the owner saw.
// @mutate src/components/RouteErrorBoundary.tsx | if (isRecoveryReloadInFlight()) { | if (false) {
