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
 *
 * PROVEN ABLE TO FAIL 2026-09-21 (guard burn-down). Dropping the `screen` tag
 * from ErrorState's report call — the tag the prod-errors alert groups on, so
 * the row still arrives and no longer says which screen the user was on — reds
 * BOTH halves: the RENDER test (a real mount, a real report() call, the tag
 * absent) and the source-text inventory. The render half is the one that
 * matters; it is why this guard is .tsx.
 */
// @mutate src/components/ui/ErrorState.tsx | tags: { source: "ErrorState", kind: USER_ERROR_SCREEN, screen: currentScreen(), title }, | tags: { source: "ErrorState", kind: USER_ERROR_SCREEN, title },
//
// Q39 (2026-09-23): every surface also sends tags.kind = "user-error-screen",
// the tag trigger trg_error_logs_zz_user_error_screen keys on to turn a REAL
// person's error screen into an ops alert ledger item. Proven red 2026-09-23:
// dropping the kind tag from ErrorState reds the ErrorState + ProtectedRoute
// renders; removing <ReportErrorScreen> from ChatTimeline reds the inventory.
// @mutate src/components/ui/ErrorState.tsx | kind: USER_ERROR_SCREEN, screen: currentScreen(), title | screen: currentScreen(), title
// @mutate src/components/messages/chatView/ChatTimeline.tsx | <ReportErrorScreen source="ChatTimeline" title="Couldn't load this conversation." /> | {null}
// @mutate src/components/RouteErrorBoundary.tsx | kind: USER_ERROR_SCREEN, route: | route:
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
  isRecoveryReloadInFlight: () => false,
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
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { USER_ERROR_SCREEN } from "@/lib/currentScreen";
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
    expect(tags.kind, "a crashed route is a person looking at an error screen").toBe(USER_ERROR_SCREEN);
    expect(tags.screen).toBe("/messages");
  });

  it("ErrorBoundary", () => {
    silence();
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went sideways/)).toBeTruthy();
    const tags = reportedTags();
    expect(tags.source).toBe("ErrorBoundary");
    expect(tags.kind).toBe(USER_ERROR_SCREEN);
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
    expect(tags.kind).toBe(USER_ERROR_SCREEN);
    expect(tags.section).toBe("recommended jobs");
    expect(tags.screen).toBe("/activity");
  });

  it("ErrorState (the 'We couldn't load this.' card every data failure renders)", () => {
    render(<ErrorState title="We couldn't load your jobs." />);
    expect(screen.getByText(/couldn't load your jobs/)).toBeTruthy();
    const tags = reportedTags();
    expect(tags.source).toBe("ErrorState");
    expect(tags.kind).toBe(USER_ERROR_SCREEN);
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
    // The card itself (ErrorState) is what reaches the ops ledger (Q12/Q39).
    const card = report.mock.calls.find((c) => (c[1] as { tags?: { kind?: string } })?.tags?.kind === USER_ERROR_SCREEN);
    expect(card, "the account-load card must report as a user error screen").toBeTruthy();
    currentUser.isError = false;
  });

  it("ReportErrorScreen (hand-drawn pane error cards)", () => {
    render(<ReportErrorScreen source="ChatTimeline" title="Couldn't load this conversation." />);
    const tags = reportedTags();
    expect(tags.source).toBe("ChatTimeline");
    expect(tags.kind).toBe(USER_ERROR_SCREEN);
    expect(tags.title).toBe("Couldn't load this conversation.");
    expect(tags.screen).toBe("/activity");
  });

  it("ReportErrorScreen does not report while offline", () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReportErrorScreen source="X" title="y" />);
    expect(report).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // The pane cards that carry <ReportErrorScreen> (ChatTimeline,
  // ApplicantsErrorState, SavedSearches, NotificationPanel) are held by the
  // source inventory below; mounting them here drags in their whole trees
  // (ApplicantsStates -> ShareJobButton -> radix popover), which flaked
  // with a react/jsx-runtime interop error under a multi-file run.

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
    expect(block, "the boot failure screen is a user error screen").toMatch(/kind: USER_ERROR_SCREEN/);
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

// ── Q39: every error screen in src reaches the ops alert ledger ───────────
//
// INVENTORY FROM SOURCE: every .tsx file that renders error-screen copy
// ("couldn't load", "This page hit a problem", "Something went sideways",
// "We couldn't verify your access") outside comments / toasts / console /
// report() lines. Each must report with kind "user-error-screen" — by
// rendering <ErrorState> (which does), by rendering <ReportErrorScreen>, or by
// its own report(..., { kind: USER_ERROR_SCREEN }). The only other way out is
// EXCUSED_INLINE, for one-line rows that are not a screen, and that list is
// two-way (an excused file that stops matching is stale).
const ERROR_COPY = /(?:We\s+)?[Cc]ouldn(?:'|&apos;|\u2019)t load\b|This page hit a problem|Something went sideways|We couldn't verify your access/;

function errorCopyLines(src: string): number[] {
  const hits: number[] = [];
  let inBlock = false;
  src.split("\n").forEach((l, i) => {
    const t = l.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      return;
    }
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      if (!t.includes("*/")) inBlock = true;
      return;
    }
    if (t.startsWith("//") || t.startsWith("*")) return;
    if (/toast\.|console\.|\breport\(/.test(l)) return;
    if (ERROR_COPY.test(l)) hits.push(i + 1);
  });
  return hits;
}

const EXCUSED_INLINE: Record<string, string> = {
  "components/InstantPayoutDialog.tsx": "an inline error line inside the payout dialog, not a screen",
  "components/admin/AdminNotifications.tsx": "one admin-only <p> under a settings card",
  "components/profile/ProfileSectionError.tsx": "a one-line row inside a Profile sub-section; the profile itself loaded",
  "components/profile/SecurityTab.tsx": "one line of the session-history list; reported as SecurityTab.sessions",
  "components/profile/profileEditForm/PhotoNameSection.tsx": "a field hint under the avatar picker",
  "components/reviewPanel/ReviewList.tsx": "one line under the review summary; reported as ReviewPanel.load",
  "pages/home/QuickApplyHandler.tsx": "a toast (failWith), not a rendered screen",
};

const tsxFiles = walk(SRC).filter((f) => f.endsWith(".tsx"));
const rel = (f: string) => f.slice(SRC.length + 1);
const reachesLedger = (src: string) =>
  /<ErrorState\b/.test(src) || /<ReportErrorScreen\b/.test(src) || /kind: USER_ERROR_SCREEN/.test(src);

describe("every error screen in src reaches the ops alert ledger (Q39)", () => {
  const withCopy = tsxFiles.filter((f) => errorCopyLines(readFileSync(f, "utf8")).length > 0);

  it("inventory floor: the scan finds the app's error screens", () => {
    expect(withCopy.length).toBeGreaterThan(40);
  });

  it("each one reports with kind user-error-screen (or is an excused inline row)", () => {
    const silent = withCopy
      .filter((f) => !(rel(f) in EXCUSED_INLINE))
      .filter((f) => !reachesLedger(readFileSync(f, "utf8")))
      .map((f) => `${rel(f)}:${errorCopyLines(readFileSync(f, "utf8")).join(",")}`);
    expect(silent, "error screen that never becomes a user-error-screen report — render <ErrorState>, add <ReportErrorScreen>, or excuse it here with a reason").toEqual([]);
  });

  it("EXCUSED_INLINE is two-way: every excused file still renders error copy", () => {
    const stale = Object.keys(EXCUSED_INLINE).filter((k) => !withCopy.some((f) => rel(f) === k));
    expect(stale).toEqual([]);
  });

  it("every error boundary (getDerivedStateFromError) reports with the kind tag", () => {
    const boundaries = tsxFiles.filter((f) => /getDerivedStateFromError/.test(readFileSync(f, "utf8")));
    expect(boundaries.length).toBeGreaterThanOrEqual(3);
    const missing = boundaries.filter((f) => !/kind: USER_ERROR_SCREEN/.test(readFileSync(f, "utf8"))).map(rel);
    expect(missing).toEqual([]);
  });

  it("the kind value is the one the database trigger keys on (newest is_user_error_screen_row)", () => {
    const dir = join(SRC, "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let body = "";
    const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_user_error_screen_row\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;
    for (const f of files) for (const m of readFileSync(join(dir, f), "utf8").matchAll(re)) body = m[2];
    expect(body, "no migration defines public.is_user_error_screen_row").not.toBe("");
    expect(body).toContain(`p_tags ->> 'kind' = '${USER_ERROR_SCREEN}'`);
  });
});
