// @mutate src/hooks/useActivityBadgeCounts.ts | filter: `customer_id=eq.${userId}` },\n      () => scheduleLoad(), | filter: `customer_id=eq.${userId}` },\n      () => loadCounts(),
// @mutate src/hooks/useActivityBadgeCounts.ts | onRecovered: scheduleLoad } | onRecovered: loadCounts }
// @mutate src/hooks/useActivityBadgeCounts.ts | same way the schedule-time path above does.\n      if (isHidden()) { | same way the schedule-time path above does.\n      if (false) {
// @mutate src/hooks/useActivityBadgeCounts.ts | let store = stores.get(userId); | let store = undefined as BadgeStore \| undefined;
// @mutate src/hooks/useActivityBadgeCounts.ts | const BADGE_REFRESH_DEBOUNCE_MS = 400; | const BADGE_REFRESH_DEBOUNCE_MS = 0;
// @mutate src/components/admin/AdminBroadcasts.tsx | refetchInterval: 15_000, | refetchInterval: 2_000,
// @mutate src/hooks/useActivityBadgeCounts.ts |       if (isHidden()) {\n        dirtyWhileHidden = true;\n        return;\n      }\n      loadCounts(); |       loadCounts();
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";

/*
 * Behavioural rig for the visibility-at-fire-time test below. Mirrors the
 * chainable-builder pattern already used in
 * cancelledThreadClosesBeforeTheTap.test.tsx: `.then()` resolves synchronously
 * so the test does not need to flush microtasks, and the realtime channel's
 * `.on(...)` handlers are captured so the test can fire a wake-up itself
 * instead of needing a live socket.
 */
const rig = vi.hoisted(() => ({
  applicationsReads: 0,
  offerReads: 0,
  jobsHandler: null as (() => void) | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const applicationsBuilder: Record<string, unknown> = {};
  Object.assign(applicationsBuilder, {
    select: () => applicationsBuilder,
    eq: () => applicationsBuilder,
    is: () => applicationsBuilder,
    then: (resolve: (r: { count: number; error: null }) => unknown) => {
      rig.applicationsReads++;
      return resolve({ count: 0, error: null });
    },
  });
  return {
    supabase: {
      from: () => applicationsBuilder,
      rpc: () => ({
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
          rig.offerReads++;
          return resolve({ data: [], error: null });
        },
      }),
      channel: () => {
        const chan = {
          on: (_event: string, cfg: { table?: string }, handler: () => void) => {
            if (cfg.table === "jobs") rig.jobsHandler = handler;
            return chan;
          },
        };
        return chan;
      },
    },
  };
});
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: (factory: (name: string) => unknown) => {
    factory("test-badge-channel");
    return { close: vi.fn() };
  },
}));
vi.mock("@/lib/safeStorage", () => ({
  safeStorage: { getItem: () => null, setItem: () => {} },
}));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

/**
 * CLASS CHECK (docs/OPEN.md Q53): client code must not multiply database load.
 *
 * The 2026-09-22 outage was the instance starving with no real users on it.
 * Measured afterwards (pg_stat_statements, 17.5 h after the 15:23Z restart,
 * plus edge logs): the nav badge pair — an applications count (40,481 calls,
 * 422 s, #2 statement by total time) and get_my_pending_direct_offers (43,560
 * calls) — ran TWICE per page load because MobileNav and DesktopSidebarNav
 * both mount on every page and each ran its own copy of useActivityBadgeCounts
 * (1.89 offer requests per page-load marker request). Nothing was on a timer;
 * the multiplier was duplicate mounts and un-coalesced realtime wake-ups.
 *
 * So this pins, from source:
 *  1. The hot badge hook shares ONE store per user (every consumer beyond the
 *     first is free), coalesces realtime wake-ups through `scheduleLoad`, and
 *     holds them while the page is hidden. Every `.on(...)` realtime handler
 *     and `onRecovered` must go through `scheduleLoad`, never `loadCounts`.
 *  2. The inventory of client POLLERS (React Query `refetchInterval`, and
 *     `setInterval` whose callback reaches the network) is exact: each one is
 *     listed with its period and why it is acceptable, every period is at or
 *     above POLL_FLOOR_MS unless it is a short-lived gate screen, and
 *     `refetchIntervalInBackground: true` (poll while hidden) never appears.
 *     A new poller fails here until someone writes down its cost.
 */

const SRC = resolve(__dirname, "..");
const POLL_FLOOR_MS = 15_000;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC);
const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}

/** Numeric value of an expression: a literal, or a same-file `const NAME = <literal>`. */
function numeric(sf: ts.SourceFile, e: ts.Expression): number | null {
  if (ts.isNumericLiteral(e)) return Number(e.text.replace(/_/g, ""));
  if (ts.isIdentifier(e)) {
    let v: number | null = null;
    visit(sf, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text && n.initializer && ts.isNumericLiteral(n.initializer)) {
        v = Number(n.initializer.text.replace(/_/g, ""));
      }
    });
    return v;
  }
  return null;
}

interface Poller { file: string; kind: "refetchInterval" | "setInterval"; ms: number | null; network: boolean }

function pollers(): Poller[] {
  const out: Poller[] = [];
  for (const file of files) {
    const sf = parse(file);
    const rel = relative(SRC, file);
    visit(sf, (n) => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "refetchInterval") {
        out.push({ file: rel, kind: "refetchInterval", ms: numeric(sf, n.initializer), network: true });
      }
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(sf);
        if (callee === "setInterval" || callee === "window.setInterval") {
          const [cb, period] = n.arguments;
          let body = cb ? cb.getText(sf) : "";
          // A named callback: read its declaration's text too.
          if (cb && ts.isIdentifier(cb)) {
            visit(sf, (d) => {
              if ((ts.isVariableDeclaration(d) || ts.isFunctionDeclaration(d)) && d.name && ts.isIdentifier(d.name) && d.name.text === cb.text) body += d.getText(sf);
            });
          }
          const network = /supabase|refresh\(|invalidateQueries|refetch|fetch\(|\.rpc\(|\.from\(/.test(body);
          out.push({ file: rel, kind: "setInterval", ms: period ? numeric(sf, period) : null, network });
        }
      }
    });
  }
  return out;
}

/**
 * Every client poller that reaches the network, with its period and why it
 * is acceptable. EXACT: a new one, a changed period or a removed one fails.
 */
// @two-way src/test/hotQueryLoad.test.ts:expect(seen).toEqual(
const KNOWN_NETWORK_POLLERS: Record<string, { ms: number; why: string }> = {
  "components/admin/AdminBroadcasts.tsx refetchInterval": { ms: 15_000, why: "admin console only; React Query pauses it while the tab is hidden" },
  "pages/AccountPending.tsx setInterval": { ms: 15_000, why: "pending-approval gate screen; one user, only while on that screen" },
  "pages/SignupPending.tsx setInterval": { ms: 5_000, why: "email-verification gate screen; stops on navigate, below the floor on purpose (the user is waiting on it)" },
  "pages/CompleteProfile.tsx setInterval": { ms: 2_500, why: "profile-row retry while a brand-new profile is being created; stops as soon as it exists" },
};
const BELOW_FLOOR_ALLOWED = new Set(["pages/SignupPending.tsx setInterval", "pages/CompleteProfile.tsx setInterval"]);

describe("hot-query load (Q53)", () => {
  it("scans a real source tree", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("every network poller is inventoried, exactly, with its period", () => {
    const found = pollers().filter((p) => p.network);
    expect(found.length).toBeGreaterThan(2);
    const seen: Record<string, number | null> = {};
    for (const p of found) seen[`${p.file} ${p.kind}`] = p.ms;
    expect(seen).toEqual(Object.fromEntries(Object.entries(KNOWN_NETWORK_POLLERS).map(([k, v]) => [k, v.ms])));
    for (const [k, ms] of Object.entries(seen)) {
      if (!BELOW_FLOOR_ALLOWED.has(k)) expect(ms, `${k} polls every ${ms} ms, below the ${POLL_FLOOR_MS} ms floor`).toBeGreaterThanOrEqual(POLL_FLOOR_MS);
    }
  });

  it("nothing polls while the page is hidden (refetchIntervalInBackground: true)", () => {
    const hits: string[] = [];
    for (const file of files) {
      const sf = parse(file);
      visit(sf, (n) => {
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "refetchIntervalInBackground" && n.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
          hits.push(relative(SRC, file));
        }
      });
    }
    expect(hits).toEqual([]);
  });

  describe("useActivityBadgeCounts (the #2 statement by DB time)", () => {
    const file = join(SRC, "hooks/useActivityBadgeCounts.ts");
    const sf = parse(file);

    it("is mounted by more than one component, which is why it must share", () => {
      const callers = files.filter((f) => f !== file && /\buseActivityBadgeCounts\(/.test(readFileSync(f, "utf8")));
      expect(callers.length).toBeGreaterThanOrEqual(2);
    });

    it("reuses one store per user instead of opening a new one per consumer", () => {
      let reuses = false;
      visit(sf, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "store" && n.initializer?.getText(sf) === "stores.get(userId)") reuses = true;
      });
      expect(reuses, "useActivityBadgeCounts must look up the shared store before opening one").toBe(true);
    });

    it("routes every realtime wake-up and recovery through scheduleLoad", () => {
      const handlers: string[] = [];
      let onRecovered = "";
      visit(sf, (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "on" && n.arguments[0]?.getText(sf) === '"postgres_changes"') {
          handlers.push(n.arguments[2]?.getText(sf) ?? "");
        }
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "onRecovered") onRecovered = n.initializer.getText(sf);
      });
      expect(handlers.length).toBeGreaterThanOrEqual(3);
      const direct = handlers.filter((h) => !/^\(\)\s*=>\s*scheduleLoad\(\)$/.test(h));
      expect(direct, "a realtime handler that loads directly skips the coalescing and the hidden-hold").toEqual([]);
      expect(onRecovered).toBe("scheduleLoad");
    });

    it("scheduleLoad holds a wake-up while hidden and coalesces over a non-zero window", () => {
      let body = "";
      visit(sf, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "scheduleLoad" && n.initializer) body = n.initializer.getText(sf);
      });
      expect(body).toMatch(/if \(isHidden\(\)\) \{\s*dirtyWhileHidden = true;\s*return;/);
      expect(body).toMatch(/if \(timer\) return;/);
      expect(body).toMatch(/setTimeout\([\s\S]*BADGE_REFRESH_DEBOUNCE_MS\)/);
      let debounce: number | null = null;
      visit(sf, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "BADGE_REFRESH_DEBOUNCE_MS" && n.initializer) debounce = numeric(sf, n.initializer);
      });
      expect(debounce).toBeGreaterThanOrEqual(200);
    });

    /*
     * BEHAVIOURAL, not source-text: a wake-up can start the 400 ms timer
     * while the page is visible, then the tab is hidden before the timer
     * fires. The source-text test above only pins that scheduleLoad checks
     * isHidden() at SCHEDULE time — it says nothing about the timer callback
     * itself, which is exactly where Q109 found the gap (loadCounts() ran
     * unconditionally when the timer fired, even while hidden).
     */
    it("re-checks visibility when the timer fires, not just when it was scheduled (Q109)", () => {
      vi.useFakeTimers();
      setVisibility("visible");
      rig.applicationsReads = 0;
      rig.offerReads = 0;
      rig.jobsHandler = null;

      const { unmount } = renderHook(() => useActivityBadgeCounts("q109-test-user"));
      // Mount fires one immediate loadCounts() (openStore's own initial read) —
      // not the case under test. Drain it before touching the counters below.
      expect(rig.jobsHandler, "the jobs postgres_changes handler was never captured").toBeTruthy();
      rig.applicationsReads = 0;
      rig.offerReads = 0;

      // A realtime wake-up arrives while the page is visible — starts the
      // 400 ms debounce timer via scheduleLoad(), same as a live jobs UPDATE.
      act(() => rig.jobsHandler!());
      // The tab is hidden before the timer fires.
      setVisibility("hidden");
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(
        rig.applicationsReads,
        "the debounce timer fired loadCounts() while the page was hidden — it must re-check " +
          "isHidden() at fire time and defer, the same way scheduleLoad() does when the wake-up arrives",
      ).toBe(0);
      expect(rig.offerReads).toBe(0);

      // Now the page becomes visible again — the deferred wake-up must run.
      setVisibility("visible");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(rig.applicationsReads).toBe(1);
      expect(rig.offerReads).toBe(1);

      unmount();
      vi.useRealTimers();
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });
});
