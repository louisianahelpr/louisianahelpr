/**
 * Every error SURFACE reports, and says which screen it was on.
 *
 * Production watching (2026-09-12): a real user seeing an error screen must
 * reach the owner. That only works if every way a screen can be an error —
 * the list in e2e/errorScreens.ts — calls report() with a `source` and a
 * `screen` tag, because the prod-errors alert (.github/workflows/
 * prod-errors.yml) counts exactly those rows. A surface that renders without
 * reporting is a silent one, and this test fails on it.
 *
 * Two halves, so the check can fail both ways:
 *   1. RENDER: mount each surface with a real failure and assert report()
 *      was called with a screen tag. Proves the code path, not the grep.
 *   2. INVENTORY: every pattern in ERROR_SCREEN_PATTERNS must map to a
 *      surface this file rendered (or be explicitly excused), and every
 *      caller of the money edge function must report on failure. Adding an
 *      error surface without a report here is red, not silent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Computed path on purpose: a static import would pull an e2e file into the
// `src` composite project and break `tsc -b` (see seedDataHeavy.test.ts).
const { ERROR_SCREEN_PATTERNS } = (await import(
  pathToFileURL(resolve(__dirname, "../../e2e/errorScreens.ts")).href
)) as { ERROR_SCREEN_PATTERNS: { name: string; re: RegExp }[] };

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => report(...args),
  installGlobalErrorHandlers: vi.fn(),
}));
vi.mock("@/lib/chunkReload", () => ({
  isChunkLoadError: () => false,
  hardReloadBypassCache: vi.fn(),
  recoverFromChunkError: () => false,
}));

const currentUser = {
  user: { id: "u1" } as { id: string } | null,
  profile: null as Record<string, unknown> | null,
  isLoading: false,
  isError: false,
  refresh: async () => {},
};
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => currentUser }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "x" } }));

import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SectionBoundary } from "@/components/SectionBoundary";
import { ErrorState } from "@/components/ui/ErrorState";
import ProtectedRoute from "@/components/ProtectedRoute";
import { queryClient } from "@/lib/queryClient";

const Boom = (): never => {
  throw new Error("render boom");
};

/** The tags of the one report() call this surface made. */
function reportedTags(): Record<string, unknown> {
  expect(report).toHaveBeenCalled();
  const opts = report.mock.calls[0][1] as { tags?: Record<string, unknown> } | undefined;
  expect(opts?.tags?.source, "report() needs a `source` tag naming the surface").toBeTypeOf("string");
  expect(opts?.tags?.screen, "report() needs a `screen` tag naming the screen").toBeTypeOf("string");
  return opts!.tags!;
}

const silence = () => vi.spyOn(console, "error").mockImplementation(() => {});

/** Pattern names from e2e/errorScreens.ts this file has proven to report. */
const COVERED: Record<string, string> = {
  "route crash (RouteErrorBoundary)": "RouteErrorBoundary",
  "app crash (ErrorBoundary)": "ErrorBoundary",
  "section/data load failure": "SectionBoundary + ErrorState",
  "account load failure (ProtectedRoute)": "ProtectedRoute.profileFetchError",
  "boot watchdog failure": "BootWatchdog (src/main.tsx, checked by source below)",
};
/** Patterns that are not error surfaces of the app's own making. */
const EXCUSED: Record<string, string> = {
  "generic failure copy": "loose copy grep, no single component renders it",
  "retired 'Update ready' screen": "retired; the pattern exists to prove it never returns",
  "404 on a real route": "NotFound reports on its own (tags.source=NotFound) and is not a failure of a loaded screen",
  "admin access gate (AdminRoute unknown)": "AdminRoute reports it (tags.source=AdminRoute.adminStatusUnknown) plus ErrorState's own row; proven in src/components/AdminRoute.test.tsx",
};

beforeEach(() => {
  report.mockReset();
  window.history.replaceState({}, "", "/activity");
});

describe("every error surface reports with a screen tag", () => {
  it("RouteErrorBoundary", () => {
    silence();
    render(
      <MemoryRouter initialEntries={["/messages"]}>
        <Routes>
          <Route path="/messages" element={<RouteErrorBoundary><Boom /></RouteErrorBoundary>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/This page hit a problem/)).toBeTruthy();
    const tags = reportedTags();
    expect(tags.source).toBe("RouteErrorBoundary");
    expect(tags.screen).toBe("/messages");
  });

  it("ErrorBoundary", () => {
    silence();
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went sideways/)).toBeTruthy();
    const tags = reportedTags();
    expect(tags.source).toBe("ErrorBoundary");
    expect(tags.screen).toBe("/activity");
  });

  it("ErrorBoundary with a custom fallback still reports", () => {
    silence();
    render(<ErrorBoundary fallback={<p>custom</p>}><Boom /></ErrorBoundary>);
    expect(screen.getByText("custom")).toBeTruthy();
    expect(reportedTags().source).toBe("ErrorBoundary");
  });

  it("SectionBoundary", () => {
    silence();
    render(<SectionBoundary label="recommended jobs"><Boom /></SectionBoundary>);
    expect(screen.getByText(/Couldn't load recommended jobs/)).toBeTruthy();
    const tags = reportedTags();
    expect(tags.source).toBe("SectionBoundary");
    expect(tags.section).toBe("recommended jobs");
    expect(tags.screen).toBe("/activity");
  });

  it("ErrorState (the 'We couldn't load this.' card every data failure renders)", () => {
    render(<ErrorState title="We couldn't load your jobs." />);
    expect(screen.getByText(/couldn't load your jobs/)).toBeTruthy();
    const tags = reportedTags();
    expect(tags.source).toBe("ErrorState");
    expect(tags.title).toBe("We couldn't load your jobs.");
    expect(tags.screen).toBe("/activity");
  });

  it("ErrorState does not report while offline (no connection is not a defect)", () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ErrorState />);
    expect(report).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ProtectedRoute 'We couldn't load your account.'", () => {
    currentUser.isError = true;
    currentUser.profile = null;
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><div>DASH</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/We couldn't load your account/)).toBeTruthy();
    // ErrorState mounts inside and reports too; the route-level signal is the one asserted.
    const call = report.mock.calls.find((c) => (c[1] as { tags?: { source?: string } })?.tags?.source === "ProtectedRoute.profileFetchError");
    expect(call, "ProtectedRoute must report its own account-load failure").toBeTruthy();
    expect((call![1] as { tags: { screen: string } }).tags.screen).toBe("/dashboard");
    currentUser.isError = false;
  });

  it("a failed query reports through the shared QueryCache", async () => {
    await queryClient
      .fetchQuery({ queryKey: ["jobs", "u1"], queryFn: () => Promise.reject(new Error("rls says no")), retry: 0 })
      .catch(() => {});
    await waitFor(() => expect(report).toHaveBeenCalled());
    const tags = reportedTags();
    expect(tags.source).toBe("QueryCache");
    expect(tags.key).toBe("jobs");
    expect(tags.screen).toBe("/activity");
  });

  it("a failed mutation reports through the shared MutationCache", async () => {
    const m = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["releasePayment"],
      mutationFn: () => Promise.reject(new Error("card declined")),
    });
    await m.execute(undefined).catch(() => {});
    await waitFor(() => expect(report).toHaveBeenCalled());
    const tags = reportedTags();
    expect(tags.source).toBe("MutationCache");
    expect(tags.key).toBe("releasePayment");
  });
});

// ── Inventory: the list minus what was checked must be empty ──────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const SRC = join(__dirname, "..");

describe("error-surface inventory", () => {
  it("every ERROR_SCREEN_PATTERNS entry is either rendered above or explicitly excused", () => {
    const names = ERROR_SCREEN_PATTERNS.map((p) => p.name);
    const unaccounted = names.filter((n) => !(n in COVERED) && !(n in EXCUSED));
    expect(unaccounted, "new error surface in e2e/errorScreens.ts without a report() test here").toEqual([]);
    const stale = [...Object.keys(COVERED), ...Object.keys(EXCUSED)].filter((n) => !names.includes(n));
    expect(stale, "COVERED/EXCUSED names a pattern that no longer exists").toEqual([]);
  });

  it("the boot watchdog record in src/main.tsx is reported with source + screen tags", () => {
    const main = readFileSync(join(SRC, "main.tsx"), "utf8");
    expect(main).toMatch(/helpr_boot_failure/);
    const block = main.slice(main.indexOf("helpr_boot_failure"));
    expect(block).toMatch(/report\(new Error\(`Boot failed/);
    expect(block).toMatch(/source: "BootWatchdog"/);
    expect(block).toMatch(/screen:/);
  });

  it("every caller of the money edge function reports on failure", () => {
    const callers = walk(SRC).filter((f) => readFileSync(f, "utf8").includes('functions.invoke("create-payment"'));
    expect(callers.length).toBeGreaterThan(5);
    const silent = callers.filter((f) => !/\breport\(/.test(readFileSync(f, "utf8")));
    expect(silent.map((f) => f.replace(SRC, "src")), "create-payment caller with a toast but no report()").toEqual([]);
  });

  it("every report() from a boundary/surface/money path carries a screen tag", () => {
    const files = [
      "components/RouteErrorBoundary.tsx",
      "components/ErrorBoundary.tsx",
      "components/SectionBoundary.tsx",
      "components/ui/ErrorState.tsx",
      "components/ProtectedRoute.tsx",
      "lib/queryClient.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(SRC, f), "utf8");
      // Real calls only: `report(err` / `report(new`, not the word in a comment.
      const reports = src.split(/(?<![\w./`])report\((?=\s*(?:err|error|new )\b)/).slice(1);
      expect(reports.length, `${f} has no report() call`).toBeGreaterThan(0);
      for (const r of reports) {
        const tags = r.slice(0, 400);
        expect(tags, `${f}: report() without screen tag`).toMatch(/screen:/);
      }
    }
  });
});
