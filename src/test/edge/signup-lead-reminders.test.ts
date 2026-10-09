/**
 * Sign-up leads (owner pop-up 2026-10-09, "Save it, follow up once").
 *
 * signup-lead-reminders runs the sweep, CLAIMS the due leads (the claim RPC
 * stamps reminder_sent_at in the same UPDATE that returns them), then queues
 * ONE commercial email per lead with a signed one-click unsubscribe. A claim
 * is released only when nothing can have been queued (render failure, or a
 * database error with a code); a network failure keeps it, so a lead is never
 * mailed twice. record-signup-lead is the anonymous step-1 capture: rate
 * limited, validated, service-role write, and the same answer whether or not
 * the address has an account.
 *
 * Runs the REAL function sources through the edge harness.
 *
 * @mutate supabase/functions/signup-lead-reminders/index.ts |   const denied = verifyCronSecret(req);\n  if (denied) return denied; |   const denied = null;
 * @mutate supabase/functions/signup-lead-reminders/index.ts |       if (enqueueErr.code) await release(lead.id); |       await release(lead.id);
 * @mutate supabase/functions/signup-lead-reminders/index.ts |       if (isTestAddress(lead.email)) { |       if (false) {
 * @mutate supabase/functions/signup-lead-reminders/index.ts |           headers,\n |           headers: {},\n
 * @mutate supabase/functions/signup-lead-reminders/index.ts |       defects.push(`claim_signup_lead_reminders: ${claimErr.message}`); |       void claimErr;
 * @mutate supabase/functions/signup-lead-reminders/index.ts |       defects.push(`sweep_signup_leads: ${sweepErr.message}`); |       void sweepErr;
 * @mutate supabase/functions/signup-lead-reminders/index.ts |         if (!unsubscribeUrl) { |         if (false) {
 * @mutate supabase/functions/record-signup-lead/index.ts |   addressOnly.delete("authorization"); |   void addressOnly;
 * @mutate supabase/functions/record-signup-lead/index.ts |     if (error?.code === "PGRST202") { |     if (false) {
 * @mutate supabase/functions/record-signup-lead/index.ts |       p_replaces: replaces, |       p_replaces: null,
 * @mutate supabase/functions/record-signup-lead/index.ts |   if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders); |   if (false) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);
 * @mutate supabase/functions/record-signup-lead/index.ts |   return EMAIL_RE.test(email) ? email : null; |   return email;
 * @mutate supabase/functions/record-signup-lead/index.ts |       return json({ error: "Could not save" }, 500);\n    }\n  } catch |     }\n  } catch
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, rateLimitState, rateLimitCalls, rateLimitAuthSeen } from "./mocks/shared";
import { resetEmailMocks, emailRenders, buildUnsubscribeUrl } from "./mocks/email";

const CRON = "cron-secret";

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET: CRON,
  });
}

async function cron(bearer = CRON) {
  const fn = await loadEdgeFunction("signup-lead-reminders");
  return fn.fetch(fn.request({
    url: "https://edge.test/signup-lead-reminders",
    headers: { Authorization: `Bearer ${bearer}` },
    body: {},
  }));
}

async function capture(body: unknown) {
  const fn = await loadEdgeFunction("record-signup-lead");
  return fn.fetch(fn.request({ url: "https://edge.test/record-signup-lead", body }));
}

const enqueues = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email");
const releases = () =>
  scenario.writes.filter((w) => w.table === "signup_leads" && w.op === "update");

describe("signup-lead-reminders: one reminder per lead, never twice", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    env();
    scenario.rpc.sweep_signup_leads = { completed: 1, purged: 2 };
    scenario.rpc.claim_signup_lead_reminders = [
      { id: "lead-1", email: "first@gmail.com" },
      { id: "lead-2", email: "second@yahoo.com" },
    ];
    scenario.rpc.enqueue_email = 1;
    scenario.writeSelectRows.signup_leads = [{ id: "lead-1" }];
  });
  afterEach(() => resetEnv());

  it("refuses a caller without the cron secret", async () => {
    const res = await cron("nope");
    expect(res.status).toBe(401);
    expect(scenario.rpcCalls ?? []).toEqual([]);
  });

  it("sweeps, claims, and queues ONE commercial email per claimed lead with one-click unsubscribe", async () => {
    const res = await cron();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ completed: 1, purged: 2, claimed: 2, queued: 2, released: 0 });

    const names = (scenario.rpcCalls ?? []).map((c) => c.name);
    expect(names.indexOf("sweep_signup_leads")).toBeLessThan(names.indexOf("claim_signup_lead_reminders"));
    expect(names.indexOf("claim_signup_lead_reminders")).toBeLessThan(names.indexOf("enqueue_email"));

    const sent = enqueues().map((c) => (c.args as { payload: Record<string, unknown> }).payload);
    expect(sent.map((p) => p.to)).toEqual(["first@gmail.com", "second@yahoo.com"]);
    for (const p of sent) {
      expect(p.subject).toBe("Finish signing up for Louisiana Helpr");
      expect(p.purpose).toBe("commercial");
      expect((p.headers as Record<string, string>)["List-Unsubscribe"]).toContain(encodeURIComponent(p.to as string));
      expect((p.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    expect(emailRenders.map((e) => (e as { type: { name: string } }).type.name)).toEqual([
      "SignupLeadReminderEmail",
      "SignupLeadReminderEmail",
    ]);
    expect((emailRenders[0] as { props: { signupUrl: string } }).props.signupUrl).toMatch(/\/signup$/);
    // Nothing was released: the claim's stamp is what stops a second email.
    expect(releases()).toEqual([]);
  });

  it("a claim failure queues nothing and answers 500", async () => {
    scenario.rpcErrors = { claim_signup_lead_reminders: { message: "boom", code: "XX000" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(enqueues()).toEqual([]);
  });

  it("a failed sweep is a defect (retention did not run), but the claim still runs: it re-checks auth.users itself", async () => {
    scenario.rpcErrors = { sweep_signup_leads: { message: "sweep down", code: "XX000" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(enqueues()).toHaveLength(2);
  });

  it("with no signed one-click unsubscribe the lead is NOT mailed (a non-member cannot open the preferences page) and the claim is released", async () => {
    scenario.rpc.claim_signup_lead_reminders = [{ id: "lead-1", email: "first@gmail.com" }];
    buildUnsubscribeUrl.mockResolvedValueOnce(null);
    const res = await cron();
    expect(res.status).toBe(500);
    expect(enqueues()).toEqual([]);
    expect(releases()).toHaveLength(1);
  });

  it("a test address that slips through the claim is never mailed", async () => {
    scenario.rpc.claim_signup_lead_reminders = [{ id: "lead-t", email: "qa@mailinator.com" }];
    const res = await cron();
    expect(res.status).toBe(200);
    expect(enqueues()).toEqual([]);
    expect((await res.json()).skippedTest).toBe(1);
  });

  it("a database-refused enqueue (error with a code) releases the claim so the next run retries", async () => {
    scenario.rpc.claim_signup_lead_reminders = [{ id: "lead-1", email: "first@gmail.com" }];
    scenario.rpcErrors = { enqueue_email: { message: "queue missing", code: "42P01" } };
    const res = await cron();
    expect(res.status).toBe(500);
    const rel = releases();
    expect(rel).toHaveLength(1);
    expect(rel[0].payload).toEqual({ reminder_sent_at: null });
    expect(rel[0].filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "eq", column: "id", value: "lead-1" })]));
  });

  it("a network failure on enqueue (no code) keeps the claim: it may have queued, so never risk a second email", async () => {
    scenario.rpc.claim_signup_lead_reminders = [{ id: "lead-1", email: "first@gmail.com" }];
    scenario.rpcErrors = { enqueue_email: { message: "TypeError: fetch failed" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(releases()).toEqual([]);
  });
});

describe("record-signup-lead: anonymous step-1 capture", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    env();
    scenario.rpc.record_signup_lead = null;
  });
  afterEach(() => resetEnv());

  const recorded = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "record_signup_lead");

  it("saves a normalised address and source through the service-role RPC, and answers 204", async () => {
    const res = await capture({ email: "  New.Person@Gmail.COM ", source: "Facebook.com!" });
    expect(res.status).toBe(204);
    expect(recorded().map((c) => c.args)).toEqual([{ p_email: "new.person@gmail.com", p_source: "facebook.com", p_replaces: null }]);
    expect(rateLimitCalls).toEqual([expect.objectContaining({ keyPrefix: "record-signup-lead", maxRequests: 10 })]);
  });

  it("rate limits on the address alone: an unverified token's sub cannot buy a fresh bucket", async () => {
    const fn = await loadEdgeFunction("record-signup-lead");
    await fn.fetch(fn.request({
      url: "https://edge.test/record-signup-lead",
      headers: { Authorization: "Bearer a.b.c" },
      body: { email: "a@gmail.com" },
    }));
    expect(rateLimitAuthSeen).toEqual([false]);
  });

  it("passes a corrected typo's old address as p_replaces", async () => {
    await capture({ email: "jon@gmail.com", replaces: "Jon@Gmial.com" });
    expect(recorded().map((c) => c.args)).toEqual([{ p_email: "jon@gmail.com", p_source: null, p_replaces: "jon@gmial.com" }]);
  });

  it("before its migration is live (PGRST202) sign-up sees no error", async () => {
    scenario.rpcErrors = { record_signup_lead: { message: "not found", code: "PGRST202" } };
    const res = await capture({ email: "a@gmail.com" });
    expect(res.status).toBe(204);
  });

  it("never sends a password, even when the caller includes one", async () => {
    await capture({ email: "a@gmail.com", password: "Secret123!" });
    expect(JSON.stringify(recorded())).not.toContain("Secret123");
  });

  it("refuses a malformed address without touching the database", async () => {
    for (const email of ["nope", "a@b", "x@@y.com", "", 42]) {
      const res = await capture({ email });
      expect(res.status).toBe(400);
    }
    expect(recorded()).toEqual([]);
  });

  it("is rate limited", async () => {
    rateLimitState.allowed = false;
    const res = await capture({ email: "a@gmail.com" });
    expect(res.status).toBe(429);
    expect(recorded()).toEqual([]);
  });

  it("a failed save is a 500, never a fake success", async () => {
    scenario.rpcErrors = { record_signup_lead: { message: "down", code: "XX000" } };
    const res = await capture({ email: "a@gmail.com" });
    expect(res.status).toBe(500);
  });
});
