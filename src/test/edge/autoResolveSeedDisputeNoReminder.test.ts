/**
 * A test fixture's overdue dispute never reminds an admin (owner rule: test data never shows to the owner).
 *
 * Measured on prod (read-only SQL, 2026-11-14): 16 "Escalated dispute overdue" error_logs rows in 8 days, every one on
 * an is_seed job ("Prod audit dispute fixture" 9f06b8ea, "SEED Regrout a shower wall" a690c95f, "SEED TEST Regrout a
 * tub surround" 5b3b479a), tagged ops-alert-seed: the seed boundary dropped the notification and logged it, every run.
 * The cron now skips the reminder for an is_seed job; a real job's reminder still goes out (the floor).
 *
 * @mutate supabase/functions/auto-resolve-disputes/index.ts | "SEED Regrout ...").\n        if (job.is_seed !== true) await remindAdmins( | "SEED Regrout ...").\n        await remindAdmins(
 * @mutate supabase/functions/auto-resolve-disputes/index.ts | as for an escalated one.\n      if (job.is_seed !== true) await remindAdmins( | as for an escalated one.\n      await remindAdmins(
 * @mutate supabase/functions/auto-resolve-disputes/index.ts | disputed_by, is_group_job, is_seed") | disputed_by, is_group_job")
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";
const JOB_ID = "job-1";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("auto-resolve-disputes");
}

const cronReq = () =>
  new Request("https://x/functions/v1/auto-resolve-disputes", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });

/** One overdue dispute; `job` overrides its row (as auto-resolve-disputes.test.ts seedExpiredDispute). */
function seedOverdue(job: Record<string, unknown>) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "dispute_deadline",
        result: {
          rows: [{
            id: JOB_ID, title: "Prod audit dispute fixture", helper_id: "helper-1", customer_id: "poster-1", budget: 150,
            dispute_reason: "x", disputed_at: "2026-08-21T15:30:00Z", dispute_deadline: "2026-08-24T15:30:00Z",
            dispute_status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_1", stripe_session_id: "cs_1",
            ...job,
          }],
        },
      },
      { includes: "dispute_resolved_at", result: { rows: [] } },
    ],
  };
  scenario.reads.user_roles = { rows: [{ user_id: "admin-a" }, { user_id: "admin-b" }] };
  scenario.reads.notifications = { rows: [] };
  scenario.reads.disputes = {
    selectOverrides: [
      { includes: "execution_status", result: { rows: [] } },
      { includes: "job_id", result: { rows: [] } },
    ],
  };
  scenario.writeSelectRows.jobs = [{ id: JOB_ID }];
  scenario.writeSelectRows.notifications = [{ id: "n1" }];
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
}

const adminReminders = () =>
  scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert")
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as Array<{ title?: string }>)
    .filter((n) => n.title === "Escalated dispute overdue");

describe("auto-resolve-disputes: a test fixture's dispute reminds nobody", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("a real escalated dispute still reminds each admin (the floor)", async () => {
    seedOverdue({ dispute_status: "escalated", is_seed: false });
    await (await load()).fetch(cronReq());
    expect(adminReminders().length).toBeGreaterThan(1);
  });

  it("an is_seed escalated dispute reminds no admin", async () => {
    seedOverdue({ dispute_status: "escalated", is_seed: true });
    await (await load()).fetch(cronReq());
    expect(adminReminders()).toHaveLength(0);
  });

  it("an is_seed dispute that expires today is still escalated, and reminds no admin", async () => {
    seedOverdue({ disputed_by: "poster-1", is_seed: true });
    await (await load()).fetch(cronReq());
    expect(scenario.writes.filter((w) => w.table === "jobs" && w.op === "update").map((w) => w.payload)).toEqual([{ dispute_status: "escalated" }]);
    expect(adminReminders()).toHaveLength(0);
  });

  it("a real dispute that expires today reminds each admin (the floor)", async () => {
    seedOverdue({ disputed_by: "poster-1", is_seed: false });
    await (await load()).fetch(cronReq());
    expect(adminReminders().length).toBeGreaterThan(1);
  });

  it("the expired-dispute read asks for is_seed (the mock hands back any column; prod returns only those asked)", () => {
    const src = blankComments(readFileSync(resolve("supabase/functions/auto-resolve-disputes/index.ts"), "utf8"));
    const read = src.match(/\.select\("([^"]*dispute_deadline[^"]*)"\)/);
    expect(read?.[1].split(", ").length).toBeGreaterThan(10);
    expect(read?.[1].split(", ")).toContain("is_seed");
  });
});
