/**
 * Unit tests for the `saved-helper-availability-push` Supabase edge function.
 *
 * THE DEFECT THIS PINS
 *
 * The cron's "already told them" cursor lives on `profiles.saved_helper_seen`
 * and is written with `.update(...).eq("user_id", id)`. A customer with no
 * `profiles` row makes that UPDATE match ZERO rows, and PostgREST answers
 * `{ data: null, error: null }` — so the old code's `if (updateErr)` never
 * fired, nothing was logged, and the cursor stayed empty. Every subsequent run
 * therefore re-sent the identical notification: verified in prod 2026-09-11,
 * 20 byte-identical "Lexi updated availability" rows for one customer, one per
 * 6-hourly tick since 2026-09-07, still growing. `favorite_helpers` has no FK
 * to `profiles`, so the orphan that triggers it is reachable with no other bug.
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";
const HELPER = "helper-1";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("saved-helper-availability-push");
}

function cronRequest(fn: EdgeHarness) {
  return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
}

/**
 * One saved-helper pair whose helper has fresh availability.
 * `customerHasProfile: false` reproduces the prod orphan.
 */
function seed(customerId: string, customerHasProfile: boolean) {
  scenario.reads.favorite_helpers = { rows: [{ customer_id: customerId, helper_id: HELPER }] };
  scenario.reads.helper_availability = {
    rows: [{ helper_id: HELPER, updated_at: "2026-09-10T00:00:00Z", is_available: true }],
  };
  scenario.reads.profiles = {
    // The helper-name read (`user_id, full_name`) falls through to `rows`.
    rows: [{ user_id: HELPER, full_name: "Lexi Lombas" }],
    selectOverrides: [
      {
        // The cursor read (`user_id, saved_helper_seen, full_name`).
        includes: "saved_helper_seen",
        result: {
          rows: customerHasProfile
            ? [{ user_id: customerId, saved_helper_seen: {}, full_name: "Pat P." }]
            : [],
        },
      },
    ],
  };
}

const notificationInserts = () =>
  scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");

describe("saved-helper-availability-push", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
  });

  it("notifies a customer whose cursor can actually be stored", async () => {
    seed("customer-1", true);
    const fn = await loadConfigured();
    const res = await cronRequest(fn);
    expect(res.status).toBe(200);

    const inserts = notificationInserts();
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as Array<Record<string, unknown>>)).toHaveLength(1);

    // And the cursor bump is asserted on ROWS, not on a null error.
    const bump = scenario.writes.find((w) => w.table === "profiles" && w.op === "update");
    expect(bump).toBeDefined();
    expect(bump?.selectCols).toBe("user_id");
  });

  it("does NOT notify a customer with no profiles row — the cursor could never advance", async () => {
    seed("orphan-customer", false);
    const fn = await loadConfigured();
    const res = await cronRequest(fn);

    expect(notificationInserts()).toHaveLength(0);
    // Skipped, not swallowed: the run reports the defect.
    expect(res.status).not.toBe(200);
    const body = JSON.parse(await res.text());
    expect(JSON.stringify(body)).toContain("orphan-customer");
  });
});
