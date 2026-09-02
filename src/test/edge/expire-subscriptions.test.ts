/**
 * Unit tests for the `expire-subscriptions` Supabase edge function.
 *
 * This is the only thing that ends a paid membership on time, and it had two
 * structural holes the 2026-09-01 subscription audit found:
 *
 *   1. Its query filters `subscription_expires_at IS NOT NULL`, so a profile
 *      holding a tier with a NULL expiry was not merely unhandled — it was
 *      INVISIBLE. A permanent free membership the membership-ending sweep
 *      would never once look at.
 *   2. It had no `cron_work_expectations` row, and it reported only `cleared`.
 *      `cleared` alone is the wrong thing to assert on: this cron correctly
 *      does nothing on almost every day of its life, so "cleared = 0" must
 *      never be suspicious by itself. The suspicious sentence is "found N and
 *      cleared none of them".
 *
 * Runs the REAL function source via the edge harness; only Supabase, the Slack
 * alerter and the Deno runtime are doubled.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("expire-subscriptions");
}

function cronCall(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}

/**
 * `profiles` is read TWICE with different column lists — the expired sweep and
 * the unexpirable scan — so the results have to be keyed on the select list,
 * not on the table name. `full_name` appears only in the first; the second is
 * matched on `user_id, email` (first match wins, so order matters).
 */
function profileReads(expired: unknown[], unexpirable: unknown[], unexpirableError?: { message: string }) {
  scenario.reads.profiles = {
    selectOverrides: [
      { includes: "full_name", result: { rows: expired as any } },
      {
        includes: "user_id, email",
        result: unexpirableError
          ? { rows: [], error: unexpirableError }
          : { rows: unexpirable as any },
      },
    ],
    rows: [],
  };
}

const expiredRow = (n: number) => ({
  user_id: `user-${n}`,
  full_name: `Member ${n}`,
  email: `m${n}@test.com`,
  subscription_tier: "pro",
  subscription_expires_at: "2026-08-01T00:00:00.000Z",
});

describe("expire-subscriptions edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("rejects a caller with no cron secret", async () => {
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({}));
    expect(res.status).toBe(401);
  });

  describe("the quiet day — which is most days", () => {
    it("reports found:0 alongside cleared:0 and stays 200", async () => {
      const fn = await loadConfigured();
      profileReads([], []);

      const out = await json(await fn.fetch(cronCall(fn)));

      // `found` is the candidate key cron_work_expectations asserts on
      // (20260901011254). Without it the only expressible expectation is
      // "cleared > 0", which would page every single quiet day.
      expect(out.fn).toBe("expire-subscriptions");
      expect(out.found).toBe(0);
      expect(out.cleared).toBe(0);
      expect(out.defects).toBe(0);
      expect(out.ok).toBe(true);
      expect(slackAlerts.length).toBe(0);
    });
  });

  describe("the tier that can never expire", () => {
    it("COUNTS null-expiry tiers instead of silently skipping them", async () => {
      const fn = await loadConfigured();
      profileReads([], [
        { user_id: "ghost-1", email: "ghost1@test.com", subscription_tier: "elite" },
        { user_id: "ghost-2", email: "ghost2@test.com", subscription_tier: "pro" },
      ]);

      const res = await fn.fetch(cronCall(fn));
      const out = await json(res);

      // The whole point: these rows are outside this sweep's WHERE clause, so
      // before this change nothing anywhere reported their existence.
      expect(out.unexpirable).toBe(2);
      expect(out.found).toBe(0);
      expect(out.cleared).toBe(0);
    });

    it("pages ops, loudly, when any exist", async () => {
      const fn = await loadConfigured();
      profileReads([], [{ user_id: "ghost-1", email: "g@test.com", subscription_tier: "elite" }]);

      await fn.fetch(cronCall(fn));

      const alert = slackAlerts.find((a) =>
        String((a as { title?: string }).title).includes("never expire"),
      ) as { severity?: string; fields?: Record<string, unknown> } | undefined;
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("critical");
      expect(alert!.fields?.count).toBe(1);
    });

    it("does NOT clear them — a live subscriber with a missing period end looks identical", async () => {
      const fn = await loadConfigured();
      profileReads([], [{ user_id: "ghost-1", email: "g@test.com", subscription_tier: "elite" }]);

      await fn.fetch(cronCall(fn));

      // Revoking a tier someone may be actively paying for is the one outcome
      // worse than the bug. Telling the truth about it is this function's job;
      // resolving it against Stripe is subscription-reconciliation's.
      expect(scenario.writes.filter((w) => w.table === "profiles")).toHaveLength(0);
    });

    it("does not turn a standing data condition into a daily 500", async () => {
      const fn = await loadConfigured();
      profileReads([], [{ user_id: "ghost-1", email: "g@test.com", subscription_tier: "elite" }]);

      const res = await fn.fetch(cronCall(fn));

      // cronResult turns defects into a non-2xx, and a cron that 500s every day
      // until somebody hand-repairs old rows trains everyone to ignore its
      // failures — which is how the original bug survived. Alert, don't 500.
      expect(res.status).toBe(200);
      expect((await json(res)).defects).toBe(0);
    });

    it("treats a FAILED unexpirable scan as a real defect", async () => {
      const fn = await loadConfigured();
      profileReads([], [], { message: "statement timeout" });

      const res = await fn.fetch(cronCall(fn));
      const out = await json(res);

      // A dropped error here would read as "none found" and restore exactly the
      // silence this whole block exists to remove.
      expect(res.status).toBe(500);
      expect(out.defects).toBe(1);
      expect(String(out.defectReasons[0])).toContain("statement timeout");
      expect(out.unexpirable).toBe(0);
    });
  });

  describe("clearing expired memberships", () => {
    it("clears the tier AND the Stripe linkage, keeping the customer id", async () => {
      const fn = await loadConfigured();
      profileReads([expiredRow(1)], []);
      scenario.writeSelectRows.profiles = [{ user_id: "user-1" }];

      await fn.fetch(cronCall(fn));

      const write = scenario.writes.find((w) => w.table === "profiles" && w.op === "update")!;
      const payload = write.payload as Record<string, unknown>;
      expect(payload.subscription_tier).toBeNull();
      expect(payload.subscription_expires_at).toBeNull();
      expect(payload.stripe_subscription_id).toBeNull();
      expect(payload.subscription_billing_cycle).toBeNull();
      expect(payload.subscription_cancel_at_period_end).toBe(false);
      // The Customer survives cancellation and is the durable handle for a
      // later resubscribe.
      expect(Object.keys(payload)).not.toContain("stripe_customer_id");
      // The expiry predicate is re-asserted on the WRITE, not just the read.
      expect(write.filters.some((f) => f.op === "in" && f.column === "user_id")).toBe(true);
    });

    it("counts what the WRITE actually cleared, not what the read found", async () => {
      const fn = await loadConfigured();
      profileReads([expiredRow(1), expiredRow(2)], []);
      // The `.lt` guard on the UPDATE matched only one row: user-2 renewed in
      // the gap between the SELECT and the write, so their fresh future expiry
      // correctly kept them out of it.
      scenario.writeSelectRows.profiles = [{ user_id: "user-1" }];

      const out = await json(await fn.fetch(cronCall(fn)));

      expect(out.found).toBe(2);
      expect(out.cleared).toBe(1);
    });

    it("does NOT email 'your membership ended' to the member who renewed in the gap", async () => {
      const fn = await loadConfigured();
      profileReads([expiredRow(1), expiredRow(2)], []);
      scenario.writeSelectRows.profiles = [{ user_id: "user-1" }];

      const out = await json(await fn.fetch(cronCall(fn)));

      const notif = scenario.writes.find((w) => w.table === "notifications" && w.op === "insert");
      const rows = notif!.payload as Array<{ user_id: string; message: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe("user-1");
      // Display name, not the raw column id — a lapsing member must not be told
      // "Your pro pass ended."
      expect(rows[0].message).not.toContain("Your pro membership");
      expect(out.notified).toBe(1);
    });

    it("skips the notifications insert entirely when the whole batch was lost to renewals", async () => {
      const fn = await loadConfigured();
      profileReads([expiredRow(1)], []);
      scenario.writeSelectRows.profiles = [];

      const out = await json(await fn.fetch(cronCall(fn)));

      expect(out.found).toBe(1);
      expect(out.cleared).toBe(0);
      // PostgREST rejects a zero-length insert body, and there is nobody to
      // tell anyway.
      expect(scenario.writes.some((w) => w.table === "notifications")).toBe(false);
    });

    it("found>0 with cleared=0 is the shape cron_work_expectations flags", async () => {
      const fn = await loadConfigured();
      profileReads([expiredRow(1), expiredRow(2)], []);
      scenario.writeSelectRows.profiles = [];

      const out = await json(await fn.fetch(cronCall(fn)));

      // The rule seeded in 20260901011254 is candidate_key='found',
      // disposition_keys=['cleared']. This body satisfies its suspicious
      // predicate; the quiet-day body at the top of this file does not.
      expect(out.found).toBeGreaterThan(0);
      expect(out.cleared).toBe(0);
    });
  });
});
