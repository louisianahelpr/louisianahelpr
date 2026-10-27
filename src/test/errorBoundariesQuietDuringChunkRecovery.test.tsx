/**
 * Q286 — EVERY error boundary shows the quiet reloading state, never its error
 * card, while a stale-chunk recovery reload is starting or scheduled.
 *
 * Since Q199, recoverFromChunkError() returns true while a retry WAITS on
 * CHUNK_RELOAD_SCHEDULE_MS (up to 40 s). RouteErrorBoundary was quiet in that
 * wait; the page-level ErrorBoundary and SectionBoundary skipped the report but
 * still rendered "Something went sideways." / "Couldn't load <section>." for
 * the whole wait — a false error the visitor reads during a deploy.
 *
 * Two halves, so the check fails both ways:
 *   1. RENDER, with the REAL chunkReload module: a chunk error while recovery
 *      starts → role=status "Loading…", no card, no report. Plus the in-flight
 *      case (the TypeError a prevented preload leaves behind), and a control
 *      (offline: recovery declines → the card and a report).
 *   2. INVENTORY: every class in src/ with getDerivedStateFromError must be in
 *      BOUNDARIES below, so a fourth boundary cannot ship without its quiet state.
 */
// @mutate src/components/ErrorBoundary.tsx | if (this.state.recovering) return <ChunkRecoveringState />; | if (false) return <ChunkRecoveringState />;
// @mutate src/components/SectionBoundary.tsx | if (this.state.recovering) return <ChunkRecoveringState compact />; | if (false) return <ChunkRecoveringState compact />;
// @mutate src/components/SectionBoundary.tsx | return { hasError: true, error, recovering: isRecoveryReloadInFlight() }; | return { hasError: true, error };
// @mutate src/components/ErrorBoundary.tsx | return { hasError: true, error, recovering: isRecoveryReloadInFlight() }; | return { hasError: true, error };
// @mutate src/lib/chunkReload.ts | /undefined is not an object \(evaluating '[\w$.]*\.default'\)/i.test(msg) \|\| | /never-matches-webkit/i.test(msg) \|\|
// @mutate src/lib/chunkReload.ts | /Cannot read propert(y\|ies) of undefined \(reading 'default'\)/i.test(msg) \|\| | /never-matches-v8/i.test(msg) \|\|
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { lazy, Suspense, type ComponentType, type ReactElement, type ReactNode } from "react";

import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => report(...args),
  installGlobalErrorHandlers: vi.fn(),
}));

import ErrorBoundary from "@/components/ErrorBoundary";
import SectionBoundary from "@/components/SectionBoundary";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import {
  __resetChunkReloadForTests,
  cancelPendingChunkRetry,
  isChunkLoadError,
  isRecoveryReloadInFlight,
  recoverFromChunkError,
} from "@/lib/chunkReload";

const ChunkFail = (): never => {
  throw new TypeError("Failed to fetch dynamically imported module: https://x/assets/Page-abc123.js");
};
const PreventedPreloadLazy = (): never => {
  throw new TypeError("undefined is not an object (evaluating 'e._result.default')");
};

type Boundary = { file: string; card: RegExp; wrap: (child: ReactNode) => ReactElement };
const BOUNDARIES: Boundary[] = [
  {
    file: "src/components/ErrorBoundary.tsx",
    card: /Something went sideways|You're offline/,
    wrap: (c) => <ErrorBoundary>{c}</ErrorBoundary>,
  },
  {
    file: "src/components/SectionBoundary.tsx",
    card: /Couldn't load recommended jobs/,
    wrap: (c) => <SectionBoundary label="recommended jobs">{c}</SectionBoundary>,
  },
  {
    file: "src/components/RouteErrorBoundary.tsx",
    card: /This page hit a problem|You're offline/,
    wrap: (c) => (
      <MemoryRouter initialEntries={["/browse"]}>
        <Routes>
          <Route path="/browse" element={<RouteErrorBoundary>{c}</RouteErrorBoundary>} />
        </Routes>
      </MemoryRouter>
    ),
  },
];

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

describe.each(BOUNDARIES)("$file during stale-chunk recovery", (b) => {
  it("a chunk error that starts recovery: quiet state, no card, no report", () => {
    render(b.wrap(<ChunkFail />));
    expect(screen.queryByText(b.card)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
    expect(report).not.toHaveBeenCalled();
  });

  it("any error while a recovery reload is already in flight: quiet on the FIRST render", async () => {
    expect(recoverFromChunkError()).toBe(true); // main.tsx's vite:preloadError handler
    // Every node ever committed, including a card that a later setState in
    // componentDidCatch removes before paint: the owner saw that one frame.
    const committed: string[] = [];
    const mo = new MutationObserver((recs) => {
      for (const r of recs) r.addedNodes.forEach((n) => committed.push(n.textContent ?? ""));
    });
    mo.observe(document.body, { childList: true, subtree: true });
    render(b.wrap(<PreventedPreloadLazy />));
    await Promise.resolve();
    mo.disconnect();
    expect(committed.filter((t) => b.card.test(t)), "the error card was committed").toEqual([]);
    expect(screen.queryByText(b.card)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
    expect(report).not.toHaveBeenCalled();
  });

  // /messages 2026-10-25 22:13Z (error_logs 2328bb32, release 3caabd851f, mid
  // deploy): a nav lazy in App.tsx's shell Suspense, poisoned by a prevented
  // preload, surfaced with NO recovery in flight, so the top-level boundary
  // showed "Something went sideways", reported it, and "Try Again" re-threw.
  // A REAL React.lazy whose import resolved undefined, exactly as Vite 8's
  // preload helper resolves it after preventDefault().
  it("a lazy poisoned by a prevented preload, no recovery in flight: recovers like a chunk error", async () => {
    const Poisoned = lazy(() => Promise.resolve(undefined as unknown as { default: ComponentType }));
    render(b.wrap(<Suspense fallback={null}><Poisoned /></Suspense>));
    expect((await screen.findByRole("status")).textContent).toMatch(/Loading/);
    expect(screen.queryByText(b.card)).toBeNull();
    expect(report).not.toHaveBeenCalled();
    expect(isRecoveryReloadInFlight()).toBe(true); // the reload has started

  });

  it("the same poisoned lazy after a scheduled retry was cancelled (the visitor navigated): recovery restarts", async () => {
    // Attempt 1 already reloaded this page; attempt 2 was scheduled, then dropped.
    sessionStorage.setItem("helpr_chunk_reload_count", "1");
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now() - 1_000));
    expect(recoverFromChunkError()).toBe(true);
    expect(cancelPendingChunkRetry()).toBe(true);
    expect(isRecoveryReloadInFlight()).toBe(false);
    const Poisoned = lazy(() => Promise.resolve(undefined as unknown as { default: ComponentType }));
    render(b.wrap(<Suspense fallback={null}><Poisoned /></Suspense>));
    expect((await screen.findByRole("status")).textContent).toMatch(/Loading/);
    expect(screen.queryByText(b.card)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("control: offline, recovery declines — the honest card and a report", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(b.wrap(<ChunkFail />));
    expect(screen.getByText(b.card)).toBeTruthy();
    expect(screen.queryByTestId("chunk-recovering")).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("inventory: every error boundary class in src/ is driven above", () => {
  it("the set of files with getDerivedStateFromError equals BOUNDARIES", () => {
    const root = resolve(__dirname, "../..");
    const found = walkSource([resolve(root, "src")])
      .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f))
      .filter((f) => /\bgetDerivedStateFromError\b/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(root, f))
      .sort();
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found).toEqual(BOUNDARIES.map((b) => b.file).sort());
  });
});

describe("a lazy poisoned by a prevented preload is a chunk failure, in every engine's wording", () => {
  const WORDINGS = [
    // The prod row itself (error_logs 2328bb32, iPhone Safari, /messages).
    "undefined is not an object (evaluating 'e._result.default')",
    "undefined is not an object (evaluating 'n._result.default')",
    "Cannot read properties of undefined (reading 'default')",
    'can\'t access property "default", e._result is undefined',
    "e._result is undefined",
  ];
  it.each(WORDINGS)("%s", (m) => {
    expect(isChunkLoadError(new TypeError(m))).toBe(true);
  });
  it("control: an ordinary render bug is not a chunk failure", () => {
    expect(WORDINGS.length).toBeGreaterThan(4);
    expect(isChunkLoadError(new TypeError("undefined is not an object (evaluating 'job.title')"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'title')"))).toBe(false);
  });
});
