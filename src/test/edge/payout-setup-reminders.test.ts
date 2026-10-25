/**
 * payout-setup-reminders (owner decision 2026-10-25, item 9; lead answer 4(a)):
 * the REAL function source through the edge harness. WHO is due is the SQL
 * claim (proved in src/test/pglite/payoutAfterHire.pglite.mjs); this proves
 * what the function does with each claim:
 *   - refuses a call without the cron secret;
 *   - sends nothing, and makes no write, when the claim returns nobody;
 *   - for each claim: the in-app notice (the stage's words, the job, the
 *     payout screen link, financial_alerts), then the email, then sent_at;
 *   - a 'money' reminder names the job;
 *   - a notice the database REFUSES releases the claim (deleted) and is a
 *     defect (500), and no email goes;
 *   - a notice the seed boundary drops is not a defect and sends no email;
 *   - a failed claim (PGRST202 included) is a defect before anything is sent;
 *   - it moves no money.
 *
 * @mutate supabase/functions/payout-setup-reminders/index.ts |         await release(c);\n        continue;\n      }\n      if ((noted | \n        continue;\n      }\n      if ((noted
 * @mutate supabase/functions/payout-setup-reminders/index.ts |         .update({ sent_at: new Date().toISOString() }) |         .update({ sent_at: null })
 * @mutate supabase/functions/payout-setup-reminders/index.ts |     if (error) {\n      return cronError( |     if (false) {\n      return cronError(
 * @mutate supabase/functions/_shared/payoutSetupReminder.ts |     const job = jobTitle?.trim() ? `"${jobTitle.trim()}"` : "your job"; |     const job = "your job";
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { HIRED_PAYOUT_BODY, HIRED_PAYOUT_TITLE } from "@/lib/payoutAfterHire";

const CRON_SECRET = "cron-secret-payout-reminders";
const HELPR = "helpr-1";
const JOB = "job-1";

async function run(bearer = CRON_SECRET) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET });
  const fn = await loadEdgeFunction("payout-setup-reminders");
  return fn.fetch(fn.request({ method: "POST", url: "https://edge.test/payout-setup-reminders", headers: { Authorization: `Bearer ${bearer}` }, body: {} }));
}

const notices = () =>
  scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
const ledger = (op: string) => scenario.writes.filter((w) => w.table === "payout_setup_reminders" && w.op === op);
const emails = () =>
  (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([url]) => String(url).includes("send-notification-email"));
const claim = (stage: string, key = stage, jobTitle: string | null = "Mow the lawn") => ({
  helper_id: HELPR, reminder_key: key, stage, job_id: JOB, job_title: jobTitle,
});

describe("payout-setup-reminders", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    scenario.writeSelectRows.notifications = [{ id: "n-1" }];
    scenario.writeSelectRows.payout_setup_reminders = [{ helper_id: HELPR }];
  });
  afterEach(() => {
    resetEnv();
    vi.unstubAllGlobals();
  });

  it("refuses a call without the cron secret", async () => {
    const res = await run("wrong");
    expect(res.status).toBe(401);
    expect(scenario.rpcCalls ?? []).toEqual([]);
  });

  it("nobody due: no notice, no email, no write", async () => {
    scenario.rpc.claim_payout_setup_reminders = [];
    const res = await run();
    expect(res.status).toBe(200);
    expect(scenario.writes).toEqual([]);
    expect(emails()).toEqual([]);
  });

  it("a 'hired' claim: the prompt's words in the app, the email, then sent_at", async () => {
    scenario.rpc.claim_payout_setup_reminders = [claim("hired")];
    const res = await run();
    expect(res.status).toBe(200);
    expect(notices()).toEqual([
      expect.objectContaining({ user_id: HELPR, job_id: JOB, title: HIRED_PAYOUT_TITLE, message: HIRED_PAYOUT_BODY, type: "financial_alerts", link: "/profile?tab=payment" }),
    ]);
    expect(emails()).toHaveLength(1);
    expect(JSON.parse(String((emails()[0][1] as { body: string }).body))).toMatchObject({ user_id: HELPR, title: HIRED_PAYOUT_TITLE });
    expect(ledger("update")).toHaveLength(1);
    expect((ledger("update")[0].payload as { sent_at?: unknown }).sent_at, "sent_at is stamped with the send time").toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(ledger("update")[0].filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: "helper_id", value: HELPR }), expect.objectContaining({ column: "reminder_key", value: "hired" })]),
    );
    expect((scenario.rpcCalls ?? []).find((c) => c.name === "claim_payout_setup_reminders")?.args).toEqual({ p_limit: 100 });
  });

  it("a day reminder says what is left; a 'money' reminder names the job", async () => {
    scenario.rpc.claim_payout_setup_reminders = [claim("day3"), claim("money", `money:${JOB}`, "Mow the lawn")];
    const res = await run();
    expect(res.status).toBe(200);
    const [day, money] = notices();
    expect(day.title).toBe("Finish payout setup to get paid");
    expect(String(day.message)).toMatch(/a few minutes/);
    expect(String(day.message)).not.toMatch(/about 2 minutes|two minutes/);
    expect(String(money.message)).toContain('"Mow the lawn"');
    expect(String(money.message)).toMatch(/held until your payout account is ready/);
  });

  it("a notice the database refuses releases the claim, sends no email, and is a defect", async () => {
    scenario.rpc.claim_payout_setup_reminders = [claim("day1")];
    scenario.writeErrors.notifications = { message: "permission denied", code: "42501" };
    const res = await run();
    expect(res.status).not.toBe(200);
    expect(ledger("delete")).toHaveLength(1);
    expect(emails()).toEqual([]);
    expect(ledger("update")).toEqual([]);
  });

  it("a notice the seed boundary drops by design: no email, not a defect", async () => {
    scenario.rpc.claim_payout_setup_reminders = [claim("day1")];
    scenario.writeSelectRows.notifications = [];
    scenario.rpc.notification_crosses_seed_boundary = true;
    const res = await run();
    expect(res.status).toBe(200);
    expect(emails()).toEqual([]);
    expect(ledger("delete")).toEqual([]);
  });

  it("a failed claim (PGRST202 included) is a defect before anything is sent", async () => {
    scenario.rpcErrors = { claim_payout_setup_reminders: { message: "Could not find the function", code: "PGRST202" } };
    const res = await run();
    expect(res.status).toBe(500);
    expect(scenario.writes).toEqual([]);
    expect(emails()).toEqual([]);
  });

  it("moves no money", async () => {
    scenario.rpc.claim_payout_setup_reminders = [claim("hired"), claim("money", `money:${JOB}`)];
    await run();
    const MONEY = ["jobs", "payout_transfers", "payment_refunds", "tips", "credit_ledger", "profiles"];
    expect(scenario.writes.filter((w) => MONEY.includes(w.table))).toEqual([]);
  });
});
