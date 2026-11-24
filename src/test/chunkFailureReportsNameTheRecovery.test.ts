/**
 * CLASS GUARD (audit C7, 11-24): a chunk-load failure that reaches error_logs always says why recovery did not
 * reload, whoever reports it, and a chunk load the visitor's own navigation cancelled never reaches error_logs.
 *
 * prod error_logs, read-only SQL 11-24: 07b49ceb (09:00Z, /gift-guides/printables/banners, ScrollToTop-gbNKT-Ic.js,
 * through optionalLazy) carried context.chunkRecovery {reason: "offline"}; 4903ad95 (11:31Z, /gift-guides/him,
 * SaveForSomeone-CaD0KEHR.js, GiftGuides.loadSaveFor, a loadModule caller that calls report() itself) carried no
 * chunkRecovery at all, so it could not be told apart from a real deploy skew. Both rows' release equals the
 * production deployment live at that minute (Vercel list_deployments), so neither was a stale deploy.
 *
 * The class is "a report() of a chunk error built by a caller that forgot the decline context": errorLogger now adds
 * it for every caller, so the test reports exactly as GiftGuides.loadSaveFor does (no context of its own).
 *
 * @mutate src/lib/errorLogger.ts |   return { ...opts, context: { ...opts.context, chunkRecovery: getChunkRecoveryDecline() } }; |   return opts;
 * @mutate src/lib/errorLogger.ts |   if (isPageLeaving()) return null; |
 * @mutate src/lib/chunkReload.ts |   if (pageLeaving) return declined("page_leaving", { count: 0, last: 0 }, Date.now()); |   if (pageLeaving) return false;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })));
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

import { _resetTransportBurstForTests, report } from "@/lib/errorLogger";
import { __resetChunkReloadForTests, recoverFromChunkError, trackPageLeaving } from "@/lib/chunkReload";

type Row = { message: string; severity: string; context: Record<string, unknown> };
const loggedRows = async (): Promise<Row[]> => {
  await new Promise((r) => setTimeout(r, 300));
  return fetchSpy.mock.calls.flatMap((c) => JSON.parse(String(c[1].body)) as Row[]);
};

/** The exact message of error_logs 4903ad95 (Chromium's wording; it names the chunk). */
const STALE = "Failed to fetch dynamically imported module: https://www.louisianahelpr.com/assets/SaveForSomeone-CaD0KEHR.js";
/** WebKit's wording of the same failure (it names no chunk). */
const STALE_WEBKIT = "Importing a module script failed.";

let onLine = true;
beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/gift-guides/him"), writable: true });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });
  onLine = true;
  fetchSpy.mockClear();
  // Chromium's "Failed to fetch dynamically imported module" also reads as a dropped connection (one row per 3 s
  // burst, errorLogger quietTransportFailure); each test starts a fresh burst.
  _resetTransportBurstForTests();
  __resetChunkReloadForTests();
  sessionStorage.clear();
});
afterEach(() => {
  __resetChunkReloadForTests();
  onLine = true;
});

describe("every chunk-failure report names the recovery decision", () => {
  it("callers that report a loadModule failure by hand exist (inventory floor: the rule must live in errorLogger)", () => {
    const callers = walkSource([resolve(__dirname, "..")])
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"))
      .filter((f) => /loadModule\(\s*\(\)\s*=>\s*import\(/.test(blankComments(readSource(f) ?? "")));
    expect(callers.length).toBeGreaterThan(20);
  });

  it.each([
    ["Chromium", STALE],
    ["WebKit", STALE_WEBKIT],
  ])("offline (%s): a hand-built report carries chunkRecovery.reason offline", async (_engine, message) => {
    onLine = false;
    expect(recoverFromChunkError()).toBe(false);
    report(new TypeError(message), { severity: "warning", tags: { source: "GiftGuides.loadSaveFor" } });
    const rows = await loggedRows();
    expect(rows).toHaveLength(1);
    expect((rows[0].context.chunkRecovery as { reason: string } | null)?.reason).toBe("offline");
  });

  it("a caller's own chunkRecovery context is kept, not overwritten", async () => {
    // A different chunk: errorLogger writes one row per message per document.
    report(new TypeError(STALE.replace("SaveForSomeone-CaD0KEHR", "ScrollToTop-gbNKT-Ic")), {
      severity: "warning",
      context: { chunkRecovery: { reason: "attempts_spent", count: 4 } },
    });
    const rows = await loggedRows();
    expect(rows[0].context.chunkRecovery).toEqual({ reason: "attempts_spent", count: 4 });
  });

  it("a non-chunk error gets no chunkRecovery key (the floor: the rule is scoped to chunk errors)", async () => {
    report(new Error("a real bug"), { tags: { source: "floor" } });
    const rows = await loggedRows();
    expect(rows.map((r) => r.message)).toEqual(["a real bug"]);
    expect("chunkRecovery" in rows[0].context).toBe(false);
  });
});

describe("a chunk load cancelled by the visitor leaving the page is not an error", () => {
  it("recovery records page_leaving and the report is dropped; a real error in the same moment still logs", async () => {
    trackPageLeaving();
    window.dispatchEvent(new Event("pagehide"));
    expect(recoverFromChunkError()).toBe(false);
    const { getChunkRecoveryDecline } = await import("@/lib/chunkReload");
    expect(getChunkRecoveryDecline()?.reason).toBe("page_leaving");
    // A chunk no earlier test reported (one row per message per document), so only the leaving rule can drop it.
    report(new TypeError(STALE.replace("SaveForSomeone-CaD0KEHR", "GiftGuideShare-Leaving1")), { severity: "warning", tags: { source: "GiftGuides.loadSaveFor" } });
    report(new Error("a real bug while leaving"), { tags: { source: "floor" } });
    const rows = await loggedRows();
    expect(rows.map((r) => r.message)).toEqual(["a real bug while leaving"]);
    window.dispatchEvent(new Event("pageshow"));
  });
});
