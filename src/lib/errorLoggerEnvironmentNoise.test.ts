/**
 * prod error_logs, the 8 days to 2026-11-14 (read-only SQL): the weekly Sentry report counted 75 errors, most of them
 * the environment's own (src/lib/clientNoise.ts says which and how each was measured), and one dropped connection on a
 * phone wrote a row per read in flight ("TypeError: Load failed", 8 rows in one second from 8 callers on /messages).
 *
 *   · report() drops an environment error outright: no error_logs row, nothing to Sentry.
 *   · a transport failure is a warning, one row per burst, and never goes to Sentry.
 *   · a real error still logs as an error and fans out (the floor).
 *
 * @mutate src/lib/errorLogger.ts |   if (isEnvironmentNoiseMessage(describeUnknownError(err))) return; |
 * @mutate src/lib/clientNoise.ts |   /Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/, |
 * @mutate src/lib/clientNoise.ts |   /evaluating '[a-z]\.themes'/, |
 * @mutate src/lib/errorLogger.ts |   if (!isNetworkFailure(err)) return opts; |   return opts;
 * @mutate src/lib/errorLogger.ts |   if (now - lastTransportRowAt < TRANSPORT_BURST_MS) return null; |
 * @mutate src/lib/errorLogger.ts |   return { ...opts, severity, localOnly: true }; |   return { ...opts, severity };
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })));
const sentrySpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: sentrySpy }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

import { _resetTransportBurstForTests, report } from "./errorLogger";
import { ENVIRONMENT_NOISE_COUNT } from "./clientNoise";

type Row = { message: string; severity: string };
const loggedRows = async (): Promise<Row[]> => {
  await new Promise((r) => setTimeout(r, 300));
  return fetchSpy.mock.calls.flatMap((c) => JSON.parse(String(c[1].body)) as Row[]);
};

beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/sponsor"), writable: true });
  fetchSpy.mockClear();
  sentrySpy.mockClear();
  _resetTransportBurstForTests();
});
afterEach(() => vi.useRealTimers());

describe("environment errors never reach error_logs or Sentry", () => {
  it("there are environment patterns at all (inventory floor)", () => {
    expect(ENVIRONMENT_NOISE_COUNT).toBeGreaterThan(3);
  });

  it.each([
    ["Outlook Safe Links crawler", "Object Not Found Matching Id:2, MethodName:update, ParamCount:4"],
    ["Android in-app WebView", "Error invoking postMessage: Java object is gone"],
    ["refused service worker", "Failed to register a ServiceWorker for scope ('https://www.louisianahelpr.com/') with script ('https://www.louisianahelpr.com/sw.js'): A bad HTTP response code (403) was received when fetching the script."],
    ["injected Safari script", "null is not an object (evaluating 't.themes')"],
  ])("%s is dropped", async (_what, message) => {
    report(new Error(message), { tags: { source: "unhandledrejection" } });
    report(new Error("a real bug"), { tags: { source: "floor" } });
    const rows = await loggedRows();
    expect(rows.map((r) => r.message)).toEqual(["a real bug"]);
    expect(sentrySpy.mock.calls.map((c) => (c[0] as Error).message)).toEqual(["a real bug"]);
  });
});

describe("a dropped connection is one quiet warning", () => {
  it("three Load failed reads in one burst write ONE warning row and nothing to Sentry", async () => {
    for (const source of ["useActivityData.posterNames", "useOnboardingFeeCents", "persistPushToken.upsert"]) {
      report({ message: "TypeError: Load failed", code: "", details: null, hint: null }, { tags: { source } });
    }
    const rows = await loggedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("warning");
    expect(sentrySpy).not.toHaveBeenCalled();
  });

  it("a real error in the same burst still logs as an error and reaches Sentry (the floor)", async () => {
    report(new TypeError("Load failed"));
    report(new Error("permission check returned garbage"));
    const rows = await loggedRows();
    expect(rows.map((r) => [r.message, r.severity])).toEqual([
      ["Load failed", "warning"],
      ["permission check returned garbage", "error"],
    ]);
    expect(sentrySpy).toHaveBeenCalledTimes(1);
  });
});
