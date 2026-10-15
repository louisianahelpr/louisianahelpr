import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { triggerInventory, triggersOn } from "./helpers/migrationTriggers";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q?analytics-test-traffic: a test robot's analytics event is TAGGED, and never
 * reaches PostHog, so the owner's sign-up funnel counts people.
 *
 * MEASURED 2026-10-15 on prod analytics_events (30 days): signup_started 4573
 * rows (4556 anonymous), payment_made 2284, first_payment_collected 929, with
 * ~35 non-seed profiles. The nightly journeys, press-every-control and the
 * local harnesses run the real app against prod; track() sent their events
 * as if they were people, and fanned them out to PostHog.
 *
 * Two layers, both pinned here:
 *  - client (src/lib/automatedBrowser.ts automationReason, used by track()
 *    and initPostHog): webdriver, the lh_automation flag, a test-profile session;
 *  - database (tag_automated_analytics_event, BEFORE INSERT): seed user,
 *    local-preview Origin, headless user agent. analytics_events_real leaves
 *    tagged and seed rows out. Its behaviour is proven in PGlite by
 *    src/test/pglite/analyticsTagAutomated.pglite.mjs (ALL PASS; RED with
 *    NEW_MIGRATION=skip).
 *
 * @mutate src/lib/analytics.ts |     properties: automation ? { ...base, automated: true, automation } : base, |     properties: base,
 * @mutate src/lib/analytics.ts |   if (!automation) void fanOutToPostHog(event, props); |   void fanOutToPostHog(event, props);
 * @mutate src/lib/automatedBrowser.ts |     if (typeof localStorage !== "undefined" && localStorage.getItem(AUTOMATION_FLAG_KEY) === "1") return "flag"; |     if (false) return "flag";
 * @mutate src/lib/automatedBrowser.ts |   return testProfileSession ? "seed_user" : null; |   return null;
 * @mutate src/lib/posthog.ts |   if (automationReason() \|\| isLocalDevOrigin()) return; |   if (isLocalDevOrigin()) return;
 * @mutate src/lib/posthog.ts |   markTestProfileSession(true); |   markTestProfileSession(false);
 * @mutate supabase/migrations/20261015022106_analytics_tag_automated.sql |       v_reason := 'local_origin'; |       v_reason := NULL;
 * @mutate supabase/migrations/20261015022106_analytics_tag_automated.sql |   BEFORE INSERT ON public.analytics_events |   AFTER INSERT ON public.analytics_events
 */

const captureEvent = vi.fn();
vi.mock("@/lib/posthog", () => ({ captureEvent }));

const inserted: Record<string, unknown>[][] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: string, init: { body: string }) => {
    inserted.push(JSON.parse(init.body) as Record<string, unknown>[]);
    return { ok: true, status: 201 } as Response;
  }),
);

function setWebdriver(on: boolean | undefined) {
  if (on === undefined) delete (navigator as { webdriver?: boolean }).webdriver;
  else Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => on });
}

async function fresh() {
  vi.resetModules();
  const analytics = await import("@/lib/analytics");
  const automated = await import("@/lib/automatedBrowser");
  return { ...analytics, ...automated };
}

async function flushedRow(): Promise<Record<string, unknown>> {
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.resolve();
  const rows = inserted.flat();
  expect(rows.length, "expected exactly one queued event").toBe(1);
  return rows[0];
}

beforeEach(() => {
  inserted.length = 0;
  captureEvent.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setWebdriver(undefined);
  try {
    localStorage.removeItem("lh_automation");
  } catch {
    /* jsdom storage always present; nothing to clear otherwise */
  }
});

describe("track() tags robot sessions and keeps them out of PostHog", () => {
  it("a person's event is untagged and fans out to PostHog (the control)", async () => {
    const { track } = await fresh();
    track("signup_started", { source: "web" });
    const row = await flushedRow();
    expect(row.properties).toEqual({ source: "web" });
    await vi.waitFor(() => expect(captureEvent).toHaveBeenCalledTimes(1));
  });

  it("a webdriver browser (Playwright, Selenium) is tagged 'webdriver' and skips PostHog", async () => {
    setWebdriver(true);
    const { track } = await fresh();
    track("signup_started", { source: "web" });
    const row = await flushedRow();
    expect(row.properties).toEqual({ source: "web", automated: true, automation: "webdriver" });
    await vi.advanceTimersByTimeAsync(50);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("the lh_automation flag (a CDP-attached harness, webdriver false) is tagged 'flag'", async () => {
    setWebdriver(false);
    localStorage.setItem("lh_automation", "1");
    const { track } = await fresh();
    track("payment_made", { job_id: null });
    expect((await flushedRow()).properties).toMatchObject({ automated: true, automation: "flag" });
  });

  it("a caller cannot clear the tag through its own props", async () => {
    setWebdriver(true);
    const { track } = await fresh();
    track("signup_started", { automated: false, automation: "person" });
    expect((await flushedRow()).properties).toMatchObject({ automated: true, automation: "webdriver" });
  });

  it("a test-profile session is tagged 'seed_user' after the boot path's is_seed read, and not after sign-out", async () => {
    const mod = await fresh();
    const posthog = await vi.importActual<typeof import("@/lib/posthog")>("@/lib/posthog");
    posthog.optOutTestProfile();
    mod.track("job_posted");
    expect((await flushedRow()).properties).toMatchObject({ automated: true, automation: "seed_user" });
    inserted.length = 0;
    posthog.resetUser();
    mod.track("job_posted");
    expect((await flushedRow()).properties).toEqual({});
  });

  it("PostHog never starts for a robot or on a dev/preview build served from http://localhost", async () => {
    const { isLocalDevOrigin, automationReason } = await fresh();
    // jsdom serves the tests from http://localhost: exactly the preview case.
    expect(window.location.protocol + "//" + window.location.hostname).toBe("http://localhost");
    expect(isLocalDevOrigin()).toBe(true);
    setWebdriver(true);
    expect(automationReason()).toBe("webdriver");
    const src = readFileSync(join(__dirname, "../lib/posthog.ts"), "utf8");
    expect(src).toMatch(/if \(automationReason\(\) \|\| isLocalDevOrigin\(\)\) return;/);
  });
});

describe("the database tags robot rows and the funnel view leaves them out", () => {
  const dir = join(__dirname, "../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  it("tag_automated_analytics_event (newest definition) tags seed users, local origins and headless agents", () => {
    const def = effectiveDefs(dir).get("tag_automated_analytics_event");
    expect(def, "tag_automated_analytics_event is defined").toBeDefined();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/v_reason := 'seed_user'/);
    expect(body).toMatch(/v_reason := 'local_origin'/);
    expect(body).toMatch(/v_reason := 'headless_ua'/);
    expect(body).toMatch(/jsonb_build_object\('automated', true, 'automation', v_reason\)/);
    expect(body).toMatch(/SECURITY DEFINER/i);
  });

  it("it runs BEFORE INSERT on analytics_events", () => {
    const inv = triggerInventory(files.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") })));
    const trg = triggersOn(inv, "analytics_events").find((t) => t.fn === "tag_automated_analytics_event");
    expect(trg, "the tagging trigger is attached").toBeDefined();
    expect(trg!.timing).toBe("BEFORE");
    expect(trg!.events).toMatch(/INSERT/);
    // Inventory floor: analytics_events carries other triggers too.
    expect(triggersOn(inv, "analytics_events").length).toBeGreaterThan(1);
  });

  it("analytics_events_real excludes tagged rows and test profiles", () => {
    const newest = files
      .map((name) => blankSqlComments(readFileSync(join(dir, name), "utf8")))
      .filter((sql) => /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.analytics_events_real\b/i.test(sql))
      .pop();
    expect(newest, "analytics_events_real is defined").toBeDefined();
    const view = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.analytics_events_real\b[\s\S]*?;/i.exec(newest!)![0];
    expect(view).toMatch(/-> 'automated' IS NOT DISTINCT FROM 'true'::jsonb/);
    expect(view).toMatch(/p\.is_seed/);
  });
});
