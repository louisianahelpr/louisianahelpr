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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ReactElement, ReactNode } from "react";

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
import { __resetChunkReloadForTests, recoverFromChunkError } from "@/lib/chunkReload";

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

  it("any error while a recovery reload is already in flight: quiet on the FIRST render", () => {
    expect(recoverFromChunkError()).toBe(true); // main.tsx's vite:preloadError handler
    render(b.wrap(<PreventedPreloadLazy />));
    expect(screen.queryByText(b.card)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
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
