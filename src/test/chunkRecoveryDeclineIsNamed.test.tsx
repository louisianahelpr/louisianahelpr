/**
 * Q2544 — a stale-chunk error that the automatic reload declined says WHY on
 * its report.
 *
 * 2026-10-31 23:30Z (error_logs 553a93b4, release 0f7ef0ce, Chrome 156 on a
 * Mac): /jobs showed "This page hit a problem." for a genuinely stale chunk
 * (SmsPhonePrompt-DdoLsp0o.js answered 200 on the 0f7ef0ce deployment and 404
 * on the ffeb980af4 deployment created 23:14:39Z). recoverFromChunkError()
 * declined, and the report could not tell offline, attempts spent and blocked
 * storage apart. Each reporting boundary now carries context.chunkRecovery.
 */
// @mutate src/lib/chunkReload.ts | return declined("attempts_spent", state, now); | return false;
// @mutate src/lib/chunkReload.ts | if (isOffline()) return declined("offline", { count: 0, last: 0 }, Date.now()); | if (isOffline()) return false;
// @mutate src/lib/chunkReload.ts | if (state.count > 0 \|\| landedFromRecentRecoveryReload()) return declined("storage_blocked_after_reload", state, now); | if (state.count > 0 \|\| landedFromRecentRecoveryReload()) return false;
// @mutate src/lib/chunkReload.ts | export const getChunkRecoveryDecline = (): ChunkRecoveryDecline \| null => lastDecline; | export const getChunkRecoveryDecline = (): ChunkRecoveryDecline \| null => null;
// @mutate src/components/RouteErrorBoundary.tsx | ...(isChunkLoadError(error) ? { chunkRecovery: getChunkRecoveryDecline() } : {}) | ...{}
// @mutate src/components/SectionBoundary.tsx | ...(isChunkLoadError(error) ? { chunkRecovery: getChunkRecoveryDecline() } : {}) | ...{}
// @mutate src/components/ErrorBoundary.tsx | ...(isChunkLoadError(error) ? { chunkRecovery: getChunkRecoveryDecline() } : {}) | ...{}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

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
  CHUNK_RELOAD_MAX_ATTEMPTS,
  getChunkRecoveryDecline,
  recoverFromChunkError,
} from "@/lib/chunkReload";

const ChunkFail = (): never => {
  throw new TypeError("Failed to fetch dynamically imported module: https://x/assets/SmsPhonePrompt-DdoLsp0o.js");
};
const RenderBug = (): never => {
  throw new TypeError("Cannot read properties of undefined (reading 'title')");
};

const BOUNDARIES: { name: string; wrap: (c: ReactNode) => ReactElement }[] = [
  { name: "ErrorBoundary", wrap: (c) => <ErrorBoundary>{c}</ErrorBoundary> },
  { name: "SectionBoundary", wrap: (c) => <SectionBoundary label="recommended jobs">{c}</SectionBoundary> },
  {
    name: "RouteErrorBoundary",
    wrap: (c) => (
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<RouteErrorBoundary>{c}</RouteErrorBoundary>} />
        </Routes>
      </MemoryRouter>
    ),
  },
];

const originalLocation = window.location;
const setHref = (href: string) =>
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, href, pathname: "/jobs", replace: vi.fn() },
    configurable: true,
    writable: true,
  });

beforeEach(() => {
  report.mockReset();
  sessionStorage.clear();
  __resetChunkReloadForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  setHref("http://localhost/jobs");
});
afterEach(() => {
  __resetChunkReloadForTests();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
});

const lastContext = () => (report.mock.calls.at(-1)?.[1] as { context: Record<string, unknown> }).context;

describe("recoverFromChunkError names each way it declines", () => {
  it("offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(recoverFromChunkError()).toBe(false);
    expect(getChunkRecoveryDecline()).toMatchObject({ reason: "offline", onLine: false });
  });

  it("attempts spent this episode", () => {
    sessionStorage.setItem("helpr_chunk_reload_count", String(CHUNK_RELOAD_MAX_ATTEMPTS));
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now() - 2_000));
    expect(recoverFromChunkError()).toBe(false);
    const d = getChunkRecoveryDecline();
    expect(d).toMatchObject({ reason: "attempts_spent", count: CHUNK_RELOAD_MAX_ATTEMPTS, onLine: true });
    expect(d?.lastAttemptAgoMs).toBeGreaterThanOrEqual(2_000);
  });

  it("storage blocked on a page that is itself a recent recovery reload", () => {
    setHref(`http://localhost/jobs?_v=${Date.now() - 1_000}`);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(recoverFromChunkError()).toBe(false);
    expect(getChunkRecoveryDecline()).toMatchObject({ reason: "storage_blocked_after_reload", count: 0 });
  });

  it("a recovery that starts clears the previous reason", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValueOnce(false);
    expect(recoverFromChunkError()).toBe(false);
    expect(getChunkRecoveryDecline()).not.toBeNull();
    expect(recoverFromChunkError()).toBe(true);
    expect(getChunkRecoveryDecline()).toBeNull();
  });
});

describe.each(BOUNDARIES)("$name puts the decline reason on its report", (b) => {
  it("a declined stale chunk: context.chunkRecovery says attempts_spent", () => {
    sessionStorage.setItem("helpr_chunk_reload_count", String(CHUNK_RELOAD_MAX_ATTEMPTS));
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now() - 2_000));
    render(b.wrap(<ChunkFail />));
    expect(report).toHaveBeenCalledTimes(1);
    expect(lastContext().chunkRecovery).toMatchObject({ reason: "attempts_spent", count: CHUNK_RELOAD_MAX_ATTEMPTS });
  });

  it("offline: context.chunkRecovery says offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(b.wrap(<ChunkFail />));
    expect(lastContext().chunkRecovery).toMatchObject({ reason: "offline" });
  });

  it("control: an ordinary render bug carries no chunkRecovery", () => {
    render(b.wrap(<RenderBug />));
    expect(report).toHaveBeenCalledTimes(1);
    expect("chunkRecovery" in lastContext()).toBe(false);
  });
});

describe("inventory", () => {
  it("three reporting boundaries are driven", () => {
    expect(BOUNDARIES.length).toBeGreaterThan(2);
  });
});
