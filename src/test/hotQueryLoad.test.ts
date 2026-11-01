// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | subscribeUserRealtime(uid, "jobs:customer", schedule, { onRecovered: schedule }), | subscribeUserRealtime(uid, "jobs:customer", refresh, { onRecovered: schedule }),
// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | subscribeUserRealtime(uid, "applications:helper", schedule, { onRecovered: schedule }), | subscribeUserRealtime(uid, "applications:helper", schedule, { onRecovered: refresh }),
// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | const TODO_REFRESH_DEBOUNCE_MS = 400; | const TODO_REFRESH_DEBOUNCE_MS = 0;
// @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         if (hidden()) {\n          dirtyWhileHidden = true;\n          return;\n        }\n        refresh(); |         refresh();
// @mutate src/pages/home/homeDashboard/needsYouTodos.ts |     const schedule = () => {\n      if (hidden()) { |     const schedule = () => {\n      if (false) {
// @mutate src/components/NeedsYouBridge.tsx | useNeedsYouTodos(user, { live: true }) | useNeedsYouTodos(user)
// @mutate src/components/mobileNav/useNavUnreadCount.ts | let store = stores.get(userId); | let store = undefined as UnreadStore \| undefined;
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { renderHook, cleanup, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import { readdirSync } from "./helpers/trackedFiles";

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
  coreReads: 0,
  jobsHandler: null as (() => void) | null,
}));
// The to-do badge's two activity cores, counted (badge = To-do, owner 2026-10-20).
vi.mock("@/hooks/useActivityData", () => ({
  CORE_STALE: 60_000,
  fetchPostedActivity: async () => {
    rig.coreReads++;
    return { postedJobs: [], applicantCounts: {}, pendingApplicantCounts: {}, closedApplicantSummaries: {} };
  },
  fetchAppliedActivity: async () => {
    rig.coreReads++;
    return { appliedApps: [], declinedJobIds: new Set(), helperReviewedJobIds: new Set() };
  },
}));
vi.mock("@/lib/backoutNotices", () => ({
  backoutNoticeApplies: () => false,
  backoutNoticesKey: (u: string) => ["activity", "backout", u],
  useBackoutNotices: () => new Map(),
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

vi.mock("@/integrations/supabase/client", () => {
  const applicationsBuilder: Record<string, unknown> = {};
  Object.assign(applicationsBuilder, {
    select: () => applicationsBuilder,
    eq: () => applicationsBuilder,
    is: () => applicationsBuilder,
    or: () => applicationsBuilder,
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
 * both mount on every page and each ran its own copy of the badge hook
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
  // `cond ? X : false`: a poller that is on only while `cond` holds polls every X.
  if (ts.isConditionalExpression(e) && e.whenFalse.kind === ts.SyntaxKind.FalseKeyword) return numeric(sf, e.whenTrue);
  // `(q) => (cond ? X : false)`: React Query's function form, read through its (parenthesised) returned expression.
  if (ts.isParenthesizedExpression(e)) return numeric(sf, e.expression);
  if (ts.isArrowFunction(e) && !ts.isBlock(e.body)) return numeric(sf, e.body);
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
  "pages/auth/SignupPending.tsx setInterval": { ms: 5_000, why: "email-verification gate screen; stops on navigate, below the floor on purpose (the user is waiting on it)" },
  "pages/auth/CompleteProfile.tsx setInterval": { ms: 2_500, why: "profile-row retry while a brand-new profile is being created; stops as soon as it exists" },
  "pages/jobs/jobPage/useJobPage.ts refetchInterval": { ms: 30_000, why: "only for a party to a job under way with its page open; this page has no live channel" },
  "components/notificationPreferences/SmsAlertsCard.tsx refetchInterval": { ms: 3_000, why: "only while a confirmation text is waiting (pending_phone set, sms_opt_in still false), capped at 10 min after it was sent (smsConfirmWaitingFresh): re-reads the member's own SMS row so the phone's YES flips the card to On before a stale Cancel can turn it off (owner-reported 2026-10-28); stops at opted in, at 10 min, or when the card unmounts" },
  "components/declutter/DeclutterPaySettling.tsx refetchInterval": { ms: 2_000, why: "back from Stripe (?paid=1, B-1 deep audit 2026-10-28): re-reads the cart until the paid checkout leaves it, so Pay can never be pressed twice; on only while settling and SETTLE_SLOW_MS (60 s) ends it, so at most ~30 reads" },
  "components/declutter/DeclutterHandoverTalk.tsx refetchInterval": { ms: 15_000, why: "the Declutter handover chat (#3730): re-reads the open chat so the other side's message shows; on only while the chat sheet is open (?talk=<id>), at the floor, never in the background" },
  "components/declutter/DeliveryTalk.tsx refetchInterval": { ms: 15_000, why: "the delivery chat (BUY-36, 20261031231948): re-reads the open chat so another side's message shows; on only while the chat sheet is open, and the sheet unmounts when it closes" },
  "components/declutter/DeclutterOrderTalk.tsx refetchInterval": { ms: 15_000, why: "the paid-order chat (D2-1, 20261030004216): re-reads the open chat so the other side's message shows; on only while the chat sheet is open (?order_talk=<order id>), at the floor, never in the background" },
  "components/declutter/DeclutterOfferPanel.tsx refetchInterval": { ms: 1_500, why: "back from saving a card for Buy now / Make an offer: re-reads the saved card until Stripe's webhook files it; on only while resuming, and CARD_WAIT_MS (10 s) ends it, so at most ~7 reads" },
};
const BELOW_FLOOR_ALLOWED = new Set(["pages/auth/SignupPending.tsx setInterval", "pages/auth/CompleteProfile.tsx setInterval", "components/declutter/DeclutterOfferPanel.tsx refetchInterval", "components/declutter/DeclutterPaySettling.tsx refetchInterval", "components/notificationPreferences/SmsAlertsCard.tsx refetchInterval"]);

describe("hot-query load (Q53)", () => {
  it("scans a real source tree", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("every network poller is inventoried, exactly, with its period", () => {
    const found = pollers().filter((p) => p.network);
    expect(found.length).toBeGreaterThan(1);
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

  describe("useNavUnreadCount (the unread-messages badge, Q103)", () => {
    const file = join(SRC, "components/mobileNav/useNavUnreadCount.ts");
    const sf = parse(file);

    it("is mounted by more than one nav, which is why it must share", () => {
      const callers = files.filter((f) => f !== file && /\buseNavUnreadCount\(/.test(readFileSync(f, "utf8")));
      expect(callers.length).toBeGreaterThanOrEqual(2);
    });

    it("reuses one store per user instead of opening a new one per consumer", () => {
      let reuses = false;
      visit(sf, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "store" && n.initializer?.getText(sf) === "stores.get(userId)") reuses = true;
      });
      expect(reuses, "useNavUnreadCount must look up the shared store before opening one").toBe(true);
    });

    it("no other non-test file runs its own unread `messages` badge query", () => {
      const own = files.filter((f) => f !== file && /from\("messages"\)[\s\S]{0,200}\.eq\("read", false\)/.test(readFileSync(f, "utf8"))
        && /unread/i.test(readFileSync(f, "utf8")) && /Nav/.test(f));
      expect(own.map((f) => relative(SRC, f))).toEqual([]);
    });
  });

  describe("the To-do badge (badge = To-do, owner 2026-10-20; was the #2 statement by DB time)", () => {
    const file = join(SRC, "pages/home/homeDashboard/needsYouTodos.ts");
    const sf = parse(file);

    it("has ONE live caller (the bridge App mounts once), never a nav of its own", () => {
      const live = files.filter((f) => /\buseNeedsYouTodos\([^)]*live:\s*true/.test(readFileSync(f, "utf8")));
      expect(live.map((f) => relative(SRC, f))).toEqual(["components/NeedsYouBridge.tsx"]);
      const mounts = files.filter((f) => /<NeedsYouMount\s*\/>/.test(readFileSync(f, "utf8")));
      expect(mounts.map((f) => relative(SRC, f))).toEqual(["App.tsx"]);
      // The navs read the published counts only, never the activity reads.
      for (const nav of ["components/MobileNav.tsx", "components/DesktopSidebarNav.tsx"]) {
        const src = readFileSync(join(SRC, nav), "utf8");
        expect(src, nav).not.toMatch(/useActivityData|useNeedsYouTodos|needsYouTodos/);
        expect(src, nav).toMatch(/useNeedsYouCounts\(/);
      }
    });

    it("routes every realtime wake-up and recovery through schedule", () => {
      // It rides the shared per-user channel (Q105): the handler is the 3rd
      // argument of each subscribeUserRealtime(...) call and the recovery the
      // `onRecovered` in the 4th. A raw `.on("postgres_changes", ...)` here
      // would be a second channel for rows the shared one already carries.
      const handlers: string[] = [];
      const recovered: string[] = [];
      let rawBindings = 0;
      visit(sf, (n) => {
        if (ts.isCallExpression(n) && n.expression.getText(sf) === "subscribeUserRealtime") {
          handlers.push(n.arguments[2]?.getText(sf) ?? "");
          const opts = n.arguments[3];
          let r = "";
          if (opts && ts.isObjectLiteralExpression(opts)) {
            for (const p of opts.properties) if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "onRecovered") r = p.initializer.getText(sf);
          }
          recovered.push(r);
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "on" && /postgres_changes/.test(n.arguments[0]?.getText(sf) ?? "")) rawBindings++;
      });
      expect(handlers.length).toBeGreaterThanOrEqual(3);
      expect(rawBindings, "the badge opened a channel of its own again").toBe(0);
      expect(handlers, "a realtime handler that refreshes directly skips the coalescing and the hidden-hold").toEqual(handlers.map(() => "schedule"));
      expect(recovered).toEqual(handlers.map(() => "schedule"));
    });

    it("schedule holds a wake-up while hidden and coalesces over a non-zero window", () => {
      let body = "";
      visit(sf, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "schedule" && n.initializer) body = n.initializer.getText(sf);
      });
      expect(body).toMatch(/^\(\) => \{\s*if \(hidden\(\)\) \{\s*dirtyWhileHidden = true;\s*return;/);
      expect(body).toMatch(/if \(timer\) return;/);
      expect(body).toMatch(/setTimeout\([\s\S]*TODO_REFRESH_DEBOUNCE_MS\)/);
      let debounce: number | null = null;
      visit(sf, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "TODO_REFRESH_DEBOUNCE_MS" && n.initializer) debounce = numeric(sf, n.initializer);
      });
      expect(debounce).toBeGreaterThanOrEqual(200);
    });

    /*
     * BEHAVIOURAL (Q109): a wake-up can start the timer while the page is
     * visible, then the tab is hidden before it fires. The refresh must
     * re-check visibility at fire time and wait for the page to come back.
     */
    it("re-checks visibility when the timer fires, not just when it was scheduled (Q109)", async () => {
      vi.useFakeTimers();
      setVisibility("visible");
      rig.coreReads = 0;
      rig.jobsHandler = null;
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
      const user = { id: "q109-test-user" } as SupaUser;
      const { unmount } = renderHook(() => useNeedsYouTodos(user, { live: true }), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(rig.jobsHandler, "the jobs realtime handler was never captured").toBeTruthy();
      // The two cores on mount: not the case under test.
      expect(rig.coreReads).toBe(2);
      rig.coreReads = 0;

      act(() => rig.jobsHandler!());
      setVisibility("hidden");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(rig.coreReads, "the debounce timer refreshed while the page was hidden").toBe(0);

      setVisibility("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(rig.coreReads, "the held wake-up never ran once the page was visible").toBe(2);

      unmount();
      qc.clear();
      vi.useRealTimers();
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });
});
