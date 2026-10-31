/**
 * SMS alerts (owner, 2026-10-20): send-sms-notification and twilio-inbound,
 * run from their REAL source through the edge harness with Twilio's API
 * mocked (global fetch). The decision logic lives in public.sms_claim_due /
 * sms_claim_confirmation (proved in PGlite, src/test/pglite/smsAlerts.pglite.mjs,
 * migration 20261021193738); these tests prove the edge side:
 * service-only auth, nothing sent without the secrets, the text never carries
 * the notification's title/body, and the inbound webhook refuses an unsigned
 * or wrongly signed request before it changes anything.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   The signature check is the only gate on a verify_jwt=false webhook that
//   can unsubscribe anyone.
// @mutate supabase/functions/twilio-inbound/index.ts | if (!timingSafeEqual(presented, expected)) { | if (false) {
//   The service-role gate: without it anyone could make us text a member.
// @mutate supabase/functions/send-sms-notification/index.ts | if (!serviceRoleKey \|\| !timingSafeEqual(presented, serviceRoleKey)) { | if (false) {
//   Missing secrets must be reported to the claim, never treated as ready.
// @mutate supabase/functions/send-sms-notification/index.ts | { p_limit: BATCH, p_provider_ready: twilio !== null } | { p_limit: BATCH, p_provider_ready: true }
//   A text that went out but could not be recorded must be loud.
// @mutate supabase/functions/send-sms-notification/index.ts |   if (unrecorded > 0) return json(500, | if (false) return json(500,
//   STOP must reach the database.
// @mutate supabase/functions/twilio-inbound/index.ts | if (action === 'stop' \|\| action === 'start') { | if (action === 'start') {
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { SMS_CONFIRM_HINT, SMS_OPTED_IN_REPLY, smsConfirmText, twilioSignature } from "../../../supabase/functions/_shared/smsPolicy";

const SID = "AC" + "0".repeat(32);
const MG = "MG" + "1".repeat(32);
const TOKEN = "twilio-auth-token";
const NOTIF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BASE_ENV = {
  SUPABASE_URL: "https://fncmgoasalhdgfwzhsqa.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

type FetchCall = { url: string; init?: RequestInit };
let fetchCalls: FetchCall[];

function stubTwilio(response: { status: number; body: unknown }) {
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }));
}

async function loadSend(env: Record<string, string> = {}): Promise<EdgeHarness> {
  setEnv({ ...BASE_ENV, ...env });
  return loadEdgeFunction("send-sms-notification");
}

const TWILIO_ENV = { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_MESSAGING_SERVICE_SID: MG };

describe("send-sms-notification", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    stubTwilio({ status: 201, body: { sid: "SM123" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  const DRAIN = { drain: true };

  // Owner 10-30: "You will have to text me if someone messages in support".
  // @mutate supabase/functions/send-sms-notification/index.ts |       p_phone: Deno.env.get('OWNER_ALERT_PHONE')?.trim() \|\| null, |       p_phone: null,
  // @mutate supabase/functions/send-sms-notification/index.ts |     if (claim.action !== 'send' \|\| !claim.sms_id \|\| !claim.phone) return json(200, { sent: false, reason: claim.reason ?? 'unknown' }) |
  // @mutate supabase/functions/send-sms-notification/index.ts |       message: 'support text failed', |       message: 'x',
  describe("the owner's support text", () => {
    const OWNER = { owner_support_text: true };
    const send = async (env: Record<string, string> = TWILIO_ENV) => {
      const fn = await loadSend(env);
      return fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: OWNER }));
    };

    it("refuses a caller without the service-role bearer", async () => {
      const fn = await loadSend(TWILIO_ENV);
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer not-the-key" }, body: OWNER }));
      expect(res.status).toBe(401);
      expect(fetchCalls).toEqual([]);
    });

    it("sends the fixed words and the inbox link to the claimed number, and records it", async () => {
      scenario.rpc.sms_claim_owner_support = { action: "send", sms_id: "sms-9", phone: "+12255550142" };
      scenario.rpc.sms_record_result = true;
      const res = await send();
      expect(res.status).toBe(200);
      expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "sms_claim_owner_support", args: { p_provider_ready: true, p_phone: null } });
      const form = new URLSearchParams(String(fetchCalls[0].init?.body));
      expect(form.get("To")).toBe("+12255550142");
      expect(form.get("Body")).toBe("New Helpr support message https://www.louisianahelpr.com/admin?view=support");
      expect(scenario.rpcCalls?.[1]).toMatchObject({ name: "sms_record_result", args: { p_sms_id: "sms-9", p_status: "sent", p_provider_sid: "SM123" } });
    });

    it("a Team thread reply links to that thread", async () => {
      scenario.rpc.sms_claim_owner_support = { action: "send", sms_id: "sms-9", phone: "+12255550142" };
      scenario.rpc.sms_record_result = true;
      const fn = await loadSend(TWILIO_ENV);
      await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { ...OWNER, team_thread_user_id: NOTIF } }));
      expect(new URLSearchParams(String(fetchCalls[0].init?.body)).get("Body")).toBe(`New Helpr support message https://www.louisianahelpr.com/messages?teamThread=${NOTIF}`);
    });

    it("passes the OWNER_ALERT_PHONE secret to the claim", async () => {
      scenario.rpc.sms_claim_owner_support = { action: "skip", reason: "no_owner_phone" };
      await send({ ...TWILIO_ENV, OWNER_ALERT_PHONE: " +12255557777 " });
      expect(scenario.rpcCalls?.[0]).toMatchObject({ args: { p_phone: "+12255557777" } });
    });

    it("a claim that says skip sends nothing", async () => {
      scenario.rpc.sms_claim_owner_support = { action: "skip", reason: "no_owner_phone" };
      const res = await send();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sent: false, reason: "no_owner_phone" });
      expect(fetchCalls).toEqual([]);
    });

    it("without the Twilio secrets tells the claim the provider isn't ready", async () => {
      scenario.rpc.sms_claim_owner_support = { action: "skip", reason: "twilio_not_configured" };
      await send({});
      expect(scenario.rpcCalls?.[0]).toMatchObject({ args: { p_provider_ready: false } });
      expect(fetchCalls).toEqual([]);
    });

    it("a refused text is recorded as failed and logged", async () => {
      stubTwilio({ status: 400, body: { code: 21610 } });
      scenario.rpc.sms_claim_owner_support = { action: "send", sms_id: "sms-9", phone: "+12255550142" };
      scenario.rpc.sms_record_result = true;
      const res = await send();
      expect(res.status).toBe(502);
      expect(scenario.rpcCalls?.[1]).toMatchObject({ name: "sms_record_result", args: { p_status: "failed", p_error_code: "21610" } });
      expect(JSON.stringify(scenario.writes.filter((w) => w.table === "error_logs" && w.op === "insert"))).toContain("support text failed");
    });
  });

  it("refuses a caller without the service-role bearer, before any claim", async () => {
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer not-the-key" }, body: DRAIN }));
    expect(res.status).toBe(401);
    expect(scenario.rpcCalls).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it("without the Twilio secrets tells the claim the provider is not ready and sends nothing", async () => {
    scenario.rpc.sms_claim_due = [];
    const fn = await loadSend();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, failed: 0 });
    expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "sms_claim_due", args: { p_limit: 25, p_provider_ready: false } });
    expect(fetchCalls).toEqual([]);
  });

  it("a drain sends each claimed text: the FIXED phrase and a job link, never the notification's own text, and records the SID", async () => {
    scenario.rpc.sms_claim_due = [
      { sms_id: "sms-1", phone: "+12255550123", kind: "job_offer", job_id: JOB, first_text: true },
    ];
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, failed: 0 });
    expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "sms_claim_due", args: { p_provider_ready: true } });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    const form = new URLSearchParams(String(fetchCalls[0].init?.body));
    expect(form.get("To")).toBe("+12255550123");
    expect(form.get("MessagingServiceSid")).toBe(MG);
    expect(form.get("Body")).toBe(
      `Louisiana Helpr: New job offer. Answer before it expires. https://www.louisianahelpr.com/jobs?job=${JOB} Reply STOP to stop.`,
    );
    expect(scenario.rpcCalls?.[1]).toMatchObject({
      name: "sms_record_result", args: { p_sms_id: "sms-1", p_status: "sent", p_provider_sid: "SM123", p_error_code: null },
    });
  });

  it("a money problem links to the earnings page", async () => {
    scenario.rpc.sms_claim_due = [{ sms_id: "sms-m", phone: "+12255550123", kind: "money_problem", job_id: JOB, first_text: false }];
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    const form = new URLSearchParams(String(fetchCalls[0].init?.body));
    expect(form.get("Body")).toBe(
      "Louisiana Helpr: There is a problem with a payment or payout. Please check your account. https://www.louisianahelpr.com/profile?tab=earnings",
    );
  });

  // Owner 2026-10-23: no text is ever sent for a nearby or matching job, even if a claim for one reached the sender.
  // @mutate supabase/functions/send-sms-notification/index.ts |     if (claim.kind === 'job_match') { |     if (false) {
  it("a nearby-job (job_match) claim is refused and recorded, and Twilio is never called", async () => {
    scenario.rpc.sms_claim_due = [{ sms_id: "sms-jm", phone: "+12255550123", kind: "job_match", job_id: JOB, first_text: false }];
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    expect(fetchCalls.filter((c) => new URL(c.url).hostname === "api.twilio.com")).toEqual([]);
    expect(await res.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(scenario.rpcCalls?.[1]).toMatchObject({
      name: "sms_record_result", args: { p_sms_id: "sms-jm", p_status: "failed", p_provider_sid: null, p_error_code: "job_match_retired" },
    });
  });

  it("records a Twilio refusal with its error code (21610 = recipient replied STOP)", async () => {
    stubTwilio({ status: 400, body: { code: 21610, message: "Attempt to send to unsubscribed recipient" } });
    scenario.rpc.sms_claim_due = [{ sms_id: "sms-2", phone: "+12255550123", kind: "message", job_id: null, first_text: false }];
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, failed: 1 });
    expect(scenario.rpcCalls?.[1]).toMatchObject({
      name: "sms_record_result", args: { p_sms_id: "sms-2", p_status: "failed", p_provider_sid: null, p_error_code: "21610" },
    });
  });

  it("a text sent but not recorded is a 500 (loud), never a silent success", async () => {
    scenario.rpc.sms_claim_due = [{ sms_id: "sms-3", phone: "+12255550123", kind: "message", job_id: null, first_text: false }];
    scenario.rpc.sms_record_result = false;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "result_not_recorded", sent: 1, unrecorded: 1 });
  });

  it("the double opt-in job sends the fixed confirmation text to the pending number", async () => {
    scenario.rpc.sms_claim_confirmation = { action: "send", sms_id: "sms-c", phone: "+12255550123", kind: "confirm", job_id: null, first_text: false, code: "0427" };
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { confirm_user_id: NOTIF } }));
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "sms_claim_confirmation", args: { p_user_id: NOTIF, p_provider_ready: true } });
    const form = new URLSearchParams(String(fetchCalls[0].init?.body));
    expect(form.get("Body")).toBe(smsConfirmText("0427"));
    expect(form.get("Body")).toMatch(/Reply YES 0427 /);
  });

  it("rejects a body that is neither a drain nor a uuid (no claim)", async () => {
    const fn = await loadSend(TWILIO_ENV);
    for (const body of [{ confirm_user_id: "x'; drop" }, { notification_id: NOTIF }, { drain: "true" }]) {
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body }));
      expect(res.status).toBe(400);
    }
    expect(scenario.rpcCalls).toEqual([]);
  });

  it("a claim error is a 500, not a silent success", async () => {
    scenario.rpcErrors = { sms_claim_due: { message: "boom" } };
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: DRAIN }));
    expect(res.status).toBe(500);
    expect(fetchCalls).toEqual([]);
  });
});

describe("twilio-inbound", () => {
  const URL_PUBLIC = "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/twilio-inbound";

  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    scenario.rpc.sms_inbound_keyword = 1;
  });

  async function post(params: Record<string, string>, signature?: string) {
    setEnv({ ...BASE_ENV, TWILIO_AUTH_TOKEN: TOKEN });
    const fn = await loadEdgeFunction("twilio-inbound");
    const sig = signature ?? (await twilioSignature(TOKEN, URL_PUBLIC, params));
    return fn.fetch(fn.request({
      // The runtime's own request URL differs from the public one Twilio signed.
      url: "http://localhost:9000/twilio-inbound",
      headers: { "content-type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
      rawBody: new URLSearchParams(params).toString(),
    }));
  }

  it("STOP with a valid signature opts the number out", async () => {
    const res = await post({ From: "+12255550123", Body: " stop ", MessageSid: "SM1" });
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls).toEqual([
      expect.objectContaining({ name: "sms_inbound_keyword", args: { p_phone: "+12255550123", p_action: "stop", p_code: null } }),
    ]);
  });

  // @mutate supabase/functions/twilio-inbound/index.ts |     const code = action === 'start' ? parseConfirmCode(params.Body) : null | const code = null
  it("YES with the code from the confirmation passes the code to the database", async () => {
    const res = await post({ From: "+12255550123", Body: "Yes 0427", MessageSid: "SM2" });
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls).toEqual([
      expect.objectContaining({ name: "sms_inbound_keyword", args: { p_phone: "+12255550123", p_action: "start", p_code: "0427" } }),
    ]);
  });

  // @mutate supabase/functions/twilio-inbound/index.ts |     if (action === 'start' && code !== null && changed === 1) { |     if (false) {
  it("a confirmed YES <code> gets the opt-in confirmation reply Twilio's A2P review requires (owner 2026-10-23)", async () => {
    scenario.rpc.sms_inbound_keyword = 1;
    const res = await post({ From: "+12255550123", Body: "YES 0427", MessageSid: "SM5" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("You&apos;re now signed up for job alert texts");
    expect(body).toContain("Reply HELP for help, STOP to opt out.");
    expect(SMS_OPTED_IN_REPLY).toBe("Louisiana Helpr: You're now signed up for job alert texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.");
  });

  it("a YES <code> the database did not accept (wrong or expired code) gets no confirmation", async () => {
    scenario.rpc.sms_inbound_keyword = 0;
    const res = await post({ From: "+12255550123", Body: "YES 9999", MessageSid: "SM6" });
    expect(await res.text()).not.toContain("signed up");
  });

  it("a bare YES that changed nothing gets the hint to add the code", async () => {
    scenario.rpc.sms_inbound_keyword = 0;
    const res = await post({ From: "+12255550123", Body: "YES", MessageSid: "SM3" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("reply YES and the 4-digit code");
    expect(SMS_CONFIRM_HINT).toContain("reply YES and the 4-digit code");
  });

  it("refuses a forged STOP (wrong signature) and changes nothing", async () => {
    const res = await post({ From: "+12255550123", Body: "STOP" }, "bm90LXRoZS1zaWduYXR1cmU=");
    expect(res.status).toBe(403);
    expect(scenario.rpcCalls).toEqual([]);
  });

  it("refuses a request signed with a different token", async () => {
    const params = { From: "+12255550123", Body: "STOP" };
    const res = await post(params, await twilioSignature("other-token", URL_PUBLIC, params));
    expect(res.status).toBe(403);
    expect(scenario.rpcCalls).toEqual([]);
  });

  it("HELP gets the fixed help reply as TwiML", async () => {
    const res = await post({ From: "+12255550123", Body: "help" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toContain("<Message>Louisiana Helpr alerts: help at louisianahelpr.com/support or admin@louisianahelpr.com.");
    expect(scenario.rpcCalls).toEqual([]);
  });

  it("an ordinary reply changes nothing", async () => {
    const res = await post({ From: "+12255550123", Body: "please don't stop, thanks" });
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls).toEqual([]);
  });

  it("503s (and changes nothing) when TWILIO_AUTH_TOKEN is not set", async () => {
    setEnv({ ...BASE_ENV });
    const fn = await loadEdgeFunction("twilio-inbound");
    const res = await fn.fetch(fn.request({ rawBody: "From=%2B12255550123&Body=STOP", headers: { "X-Twilio-Signature": "x" } }));
    expect(res.status).toBe(503);
    expect(scenario.rpcCalls).toEqual([]);
  });
});

describe("sms-provider-check (read-only)", () => {
  // @mutate supabase/functions/sms-provider-check/index.ts | if (isAdmin !== true) return json(403, { error: 'Forbidden: admin only' }) |
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function call(isAdmin: boolean, env: Record<string, string> = TWILIO_ENV) {
    scenario.authUser = { id: "admin-1", email: "a@test.dev" };
    scenario.rpc.has_role = isAdmin;
    fetchCalls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      const u = String(url);
      const body = u.includes("/PhoneNumbers") ? { phone_numbers: [{ sid: "PN1" }] }
        : u.includes("Tollfree/Verifications") ? { verifications: [{ tollfree_phone_number_sid: "PN1", status: "PENDING_REVIEW" }] }
        : { friendly_name: "Louisiana Helpr alerts", inbound_request_url: "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/twilio-inbound" };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    setEnv({ ...BASE_ENV, SUPABASE_ANON_KEY: "anon", ...env });
    const fn = await loadEdgeFunction("sms-provider-check");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer user-jwt" }, body: {} }));
  }

  it("refuses a non-admin before touching Twilio", async () => {
    const res = await call(false);
    expect(res.status).toBe(403);
    expect(fetchCalls).toEqual([]);
  });

  it("only GETs (never the Messages endpoint) and reports verification status", async () => {
    const res = await call(true);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ configured: true, credentials_ok: true, sender_count: 1, inbound_webhook_set: true, tollfree_verification: [{ status: "PENDING_REVIEW" }] });
    expect(fetchCalls.length).toBe(3);
    for (const c of fetchCalls) {
      expect(c.init?.method).toBe("GET");
      expect(c.url).not.toMatch(/Messages/);
    }
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("names the missing secrets without reading Twilio", async () => {
    const res = await call(true, {});
    expect(await res.json()).toMatchObject({ configured: false, secrets: { TWILIO_ACCOUNT_SID: false } });
    expect(fetchCalls).toEqual([]);
  });

  // Q76 (lh-authz-rls note on the guard fixes, 2026-10-23): the admin who ran
  // the check is recorded once, with no details (no secret, number or Twilio
  // answer), and a non-admin leaves no row.
  // @mutate supabase/functions/sms-provider-check/index.ts | await writeAdminAudit(admin, { | await notAnAuditWrite(admin, {
  it("records the admin who ran the check in admin_audit_log, with no details; a non-admin writes nothing", async () => {
    const audits = () => (scenario.writes as Array<{ table: string; op: string; payload: unknown }>)
      .filter((w) => w.table === "admin_audit_log" && w.op === "insert")
      .map((w) => w.payload as Record<string, unknown>);
    await call(true);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ admin_id: "admin-1", action: "sms_provider_check", target_type: "sms_provider", target_id: "twilio", details: null });
    resetSupabaseMock();
    await call(false);
    expect(audits()).toEqual([]);
  });

  // Q837: an unconfirmed-email caller is refused before the role check, the audit row and Twilio.
  // @mutate supabase/functions/sms-provider-check/index.ts | if (unconfirmedEmail) return unconfirmedEmail; |
  it("refuses an unconfirmed-email caller before anything else", async () => {
    scenario.rpc.has_role = true;
    fetchCalls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }));
    scenario.authUser = { id: "admin-1", email: "a@test.dev", email_confirmed_at: null };
    setEnv({ ...BASE_ENV, SUPABASE_ANON_KEY: "anon", ...TWILIO_ENV });
    const fn = await loadEdgeFunction("sms-provider-check");
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer user-jwt" }, body: {} }));
    expect(res.status).toBe(403);
    expect(fetchCalls).toEqual([]);
    expect((scenario.writes as Array<{ table: string }>).filter((w) => w.table === "admin_audit_log")).toEqual([]);
  });
});
