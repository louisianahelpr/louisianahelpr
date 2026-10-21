/**
 * Come-back emails (owner said yes, 2026-10-21): the sender, run for real
 * through the edge harness.
 *
 * come-back-emails CLAIMS the due members for step 1 then step 2 (the claim
 * RPC writes each member's come_back_email_sends row in the same statement
 * that returns them), then queues ONE commercial email per claimed member
 * with a signed one-click unsubscribe. WHO is due, including the hidden
 * switch, is decided in SQL (proven in src/test/pglite/comeBackEmails.pglite.mjs);
 * this file proves the sender never mails without a claim, never mails twice,
 * releases a claim only when the database refused the enqueue, stamps the
 * claim's queued_at once queued, reports a claim left unqueued for 2 hours,
 * and treats a missing RPC (PGRST202) as "send nothing, lose nothing" AND a
 * defect (lh-silent-failure review, 2026-10-21).
 *
 * @mutate supabase/functions/come-back-emails/index.ts |   const denied = verifyCronSecret(req);\n  if (denied) return denied; |   const denied = null;
 * @mutate supabase/functions/come-back-emails/index.ts |         if (refused) await release(m.user_id, step); |         await release(m.user_id, step);
 * @mutate supabase/functions/come-back-emails/index.ts |         if (isTestAddress(m.email)) { |         if (false) {
 * @mutate supabase/functions/come-back-emails/index.ts |             headers,\n |             headers: {},\n
 * @mutate supabase/functions/come-back-emails/index.ts |           if (!unsubscribeUrl) { |           if (false) {
 * @mutate supabase/functions/come-back-emails/index.ts |         defects.push(`claim_come_back_emails(step ${step}): ${claimErr.message}`); |         void claimErr;
 * @mutate supabase/functions/come-back-emails/index.ts |         if (claimErr.code === "PGRST202") { |         if (false) {
 * @mutate supabase/functions/come-back-emails/index.ts |           break;\n | \n
 * @mutate supabase/functions/come-back-emails/index.ts |             purpose: "commercial", |             purpose: "transactional",
 * @mutate supabase/functions/come-back-emails/index.ts |             reply_to: SUPPORT_EMAIL, |             reply_to: undefined,
 * @mutate supabase/functions/come-back-emails/index.ts |       if (releaseErr \|\| (released?.length ?? 0) === 0) { |       if (releaseErr) {
 * @mutate supabase/functions/come-back-emails/index.ts | const STEPS: ComeBackStep[] = [1, 2]; | const STEPS: ComeBackStep[] = [1];
 * @mutate supabase/functions/come-back-emails/index.ts |           if (stampQueuedErr \|\| (stamped?.length ?? 0) === 0) { |           if (stampQueuedErr) {
 * @mutate supabase/functions/come-back-emails/index.ts |             .update({ queued_at: new Date().toISOString(), message_id: messageId }) |             .update({ message_id: messageId })
 * @mutate supabase/functions/come-back-emails/index.ts | (/^[0-9A-Z]{5}$/.test(code) \|\| /^PGRST\d+$/.test(code)) | code.length > 0
 * @mutate supabase/functions/come-back-emails/index.ts |       counts.unqueuedClaims = rows.length;\n      for (const r of rows) { |       counts.unqueuedClaims = rows.length;\n      for (const r of []) {
 * @mutate supabase/functions/come-back-emails/index.ts |       defects.push(`unqueued-claim check failed: ${unqueuedErr.message}`); |       void unqueuedErr;
 * @mutate supabase/functions/come-back-emails/index.ts |         else if (!logErr && (failStamped?.length ?? 0) === 0) { |         else if (false) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders, buildUnsubscribeUrl } from "./mocks/email";
import { COME_BACK_COPY } from "../../../supabase/functions/_shared/comeBackEmail";

const CRON = "cron-secret";

async function cron(bearer = CRON) {
  const fn = await loadEdgeFunction("come-back-emails");
  return fn.fetch(fn.request({
    url: "https://edge.test/come-back-emails",
    headers: { Authorization: `Bearer ${bearer}` },
    body: {},
  }));
}

type Payload = Record<string, unknown>;
const enqueues = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email");
const sent = () => enqueues().map((c) => (c.args as { payload: Payload }).payload);
const claims = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "claim_come_back_emails");
const releases = () => scenario.writes.filter((w) => w.table === "come_back_email_sends" && w.op === "delete");

const STEP1 = [
  { user_id: "u-1", email: "pat@gmail.com", full_name: "Pat Smith" },
  { user_id: "u-2", email: "sam@yahoo.com", full_name: null },
];
const STEP2 = [{ user_id: "u-9", email: "lee@gmail.com", full_name: "Lee Ray" }];

describe("come-back-emails: claimed first, one email per claim, never twice", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: CRON });
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? STEP1 : STEP2);
    scenario.rpc.enqueue_email = 1;
    scenario.writeSelectRows.come_back_email_sends = [{ user_id: "u-1" }];
  });
  afterEach(() => resetEnv());

  it("refuses a caller without the cron secret, and claims nothing", async () => {
    const res = await cron("nope");
    expect(res.status).toBe(401);
    expect(scenario.rpcCalls ?? []).toEqual([]);
  });

  it("claims step 1 then step 2, and queues one commercial email per claimed member", async () => {
    const res = await cron();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 3, queued: 3, released: 0, unqueuedClaims: 0 });

    expect(claims().map((c) => c.args)).toEqual([{ p_step: 1, p_limit: 25 }, { p_step: 2, p_limit: 25 }]);
    const names = (scenario.rpcCalls ?? []).map((c) => c.name);
    expect(names.indexOf("claim_come_back_emails")).toBeLessThan(names.indexOf("enqueue_email"));

    const p = sent();
    expect(p.map((x) => x.to)).toEqual(["pat@gmail.com", "sam@yahoo.com", "lee@gmail.com"]);
    expect(p.map((x) => x.subject)).toEqual([COME_BACK_COPY[1].subject, COME_BACK_COPY[1].subject, COME_BACK_COPY[2].subject]);
    expect(p.map((x) => x.label)).toEqual(["come_back_1", "come_back_1", "come_back_2"]);
    for (const x of p) {
      expect(x.purpose).toBe("commercial");
      expect(x.reply_to).toBe("admin@louisianahelpr.test");
      expect((x.headers as Record<string, string>)["List-Unsubscribe"]).toContain(encodeURIComponent(x.to as string));
      expect((x.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    const rendered = emailRenders as { type: { name: string }; props: Record<string, unknown> }[];
    expect(rendered.map((e) => e.type.name)).toEqual(["ComeBackEmail", "ComeBackEmail", "ComeBackEmail"]);
    expect(rendered.map((e) => e.props.step)).toEqual([1, 1, 2]);
    expect(rendered[0].props.fullName).toBe("Pat Smith");
    expect(String(rendered[0].props.unsubscribeUrl)).toContain(encodeURIComponent("pat@gmail.com"));
    expect(String(rendered[0].props.appUrl)).toMatch(/\/home$/);
    // Nothing released: the claim row is what stops a second email.
    expect(releases()).toEqual([]);
    // Each queued email stamps its claim's queued_at and message_id.
    const stamps = scenario.writes.filter((w) => w.table === "come_back_email_sends" && w.op === "update");
    expect(stamps).toHaveLength(3);
    expect(stamps.map((w) => (w.payload as { message_id: string }).message_id)).toEqual(p.map((x) => x.message_id));
    for (const w of stamps) expect((w.payload as { queued_at: string }).queued_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The unqueued-claim check ran, bounded to 2-26 hours old.
    const check = (scenario.readQueries ?? []).find((q) => q.table === "come_back_email_sends");
    expect(check?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "is", column: "queued_at", value: null }),
      expect.objectContaining({ op: "lt", column: "claimed_at" }),
      expect.objectContaining({ op: "gt", column: "claimed_at" }),
    ]));
  });

  it("a queued email whose queued_at stamp matched no row is a defect", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [STEP1[0]] : []);
    scenario.writeSelectRows["come_back_email_sends:update"] = [];
    const res = await cron();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/queued_at NOT stamped for member u-1 step 1/);
    expect(enqueues()).toHaveLength(1);
  });

  it("a claim left without queued_at for 2+ hours is reported as a defect", async () => {
    scenario.rpc.claim_come_back_emails = [];
    scenario.reads.come_back_email_sends = { rows: [{ user_id: "u-old", email_step: 1, claimed_at: "2026-10-21T08:00:00Z" }] };
    const res = await cron();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.unqueuedClaims).toBe(1);
    expect(JSON.stringify(body)).toMatch(/claim for member u-old step 1 has no queued_at after 2 hours/);
  });

  it("a failed unqueued-claim check is a defect, not a clean run", async () => {
    scenario.rpc.claim_come_back_emails = [];
    scenario.reads.come_back_email_sends = { error: { message: "read down" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/unqueued-claim check failed: read down/);
  });

  it("with nobody due (the switch off) it sends nothing and answers 200", async () => {
    scenario.rpc.claim_come_back_emails = [];
    const res = await cron();
    expect(res.status).toBe(200);
    expect(enqueues()).toEqual([]);
    expect(claims()).toHaveLength(2);
  });

  it("a claim failure queues nothing for that step and answers 500", async () => {
    scenario.rpcErrors = { claim_come_back_emails: { message: "boom", code: "XX000" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(enqueues()).toEqual([]);
  });

  it("PGRST202 (RPC not found): sends nothing, claims nothing, stops, and IS a defect (a signature mismatch must not hide behind a 200)", async () => {
    scenario.rpcErrors = { claim_come_back_emails: { message: "Could not find the function", code: "PGRST202" } };
    const res = await cron();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ claimed: 0, queued: 0 });
    expect(JSON.stringify(body)).toMatch(/claim_come_back_emails not found \(PGRST202/);
    expect(claims()).toHaveLength(1);
    expect(enqueues()).toEqual([]);
  });

  it("with no signed one-click unsubscribe the member is NOT mailed and the claim is released", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [STEP1[0]] : []);
    buildUnsubscribeUrl.mockResolvedValueOnce(null);
    const res = await cron();
    expect(res.status).toBe(500);
    expect(enqueues()).toEqual([]);
    const rel = releases();
    expect(rel).toHaveLength(1);
    expect(rel[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: "u-1" }),
      expect.objectContaining({ op: "eq", column: "email_step", value: 1 }),
    ]));
  });

  it("a test address that slips through the claim is never mailed", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) =>
      ((a as { p_step: number }).p_step === 1 ? [{ user_id: "u-t", email: "qa@mailinator.com", full_name: null }] : []);
    const res = await cron();
    expect(res.status).toBe(200);
    expect(enqueues()).toEqual([]);
    expect((await res.json()).skippedTest).toBe(1);
  });

  it("a database-refused enqueue (error with a code) releases the claim so a later run retries", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 2 ? STEP2 : []);
    scenario.rpcErrors = { enqueue_email: { message: "queue missing", code: "42P01" } };
    const res = await cron();
    expect(res.status).toBe(500);
    const rel = releases();
    expect(rel).toHaveLength(1);
    expect(rel[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: "u-9" }),
      expect.objectContaining({ op: "eq", column: "email_step", value: 2 }),
    ]));
  });

  it("a network failure on enqueue (no code) keeps the claim: it may have queued, so never risk a second email", async () => {
    scenario.rpcErrors = { enqueue_email: { message: "TypeError: fetch failed" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(releases()).toEqual([]);
    // The send log says the outcome is unknown, not that it failed.
    const logStamps = scenario.writes.filter((w) => w.table === "email_send_log" && w.op === "update");
    expect(logStamps.length).toBeGreaterThan(0);
    for (const w of logStamps) {
      expect((w.payload as { status?: string }).status).toBeUndefined();
      expect((w.payload as { error_message: string }).error_message).toMatch(/outcome unknown/);
    }
  });

  it("an error code that is not the database's (a gateway body) keeps the claim too", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [STEP1[0]] : []);
    scenario.rpcErrors = { enqueue_email: { message: "upstream", code: "upstream_timeout" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(releases()).toEqual([]);
  });

  it("a send-log failure stamp that matched no row is a defect", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [STEP1[0]] : []);
    scenario.rpcErrors = { enqueue_email: { message: "queue missing", code: "42P01" } };
    scenario.writeSelectRows["email_send_log:update"] = [];
    const res = await cron();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/email_send_log failure stamp matched no row/);
  });

  it("a release that matched no row is a defect, not a silent success", async () => {
    scenario.rpc.claim_come_back_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [STEP1[0]] : []);
    scenario.rpcErrors = { enqueue_email: { message: "queue missing", code: "42P01" } };
    scenario.writeSelectRows.come_back_email_sends = [];
    const res = await cron();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.released).toBe(0);
    expect(JSON.stringify(body)).toMatch(/claim NOT released for member u-1 step 1/);
  });
});
