/**
 * SMS alerts (owner, 2026-10-20): send-sms-notification and twilio-inbound,
 * run from their REAL source through the edge harness with Twilio's API
 * mocked (global fetch). The decision logic lives in public.sms_claim (proved
 * in PGlite, ~/.lh-pglite/pgl-sms-1020.mjs); these tests prove the edge side:
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
//   Missing secrets must be reported to sms_claim, never treated as ready.
// @mutate supabase/functions/send-sms-notification/index.ts | { p_notification_id: notificationId, p_provider_ready: twilio !== null } | { p_notification_id: notificationId, p_provider_ready: true }
//   STOP must reach the database.
// @mutate supabase/functions/twilio-inbound/index.ts | if (action === 'stop' \|\| action === 'start') { | if (action === 'start') {
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { SMS_CONFIRM_TEXT, twilioSignature } from "../../../supabase/functions/_shared/smsPolicy";

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

  it("refuses a caller without the service-role bearer, before any claim", async () => {
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer not-the-key" }, body: { notification_id: NOTIF } }));
    expect(res.status).toBe(401);
    expect(scenario.rpcCalls).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it("without the Twilio secrets tells sms_claim the provider is not ready and sends nothing", async () => {
    scenario.rpc.sms_claim = { action: "skip", reason: "twilio_not_configured" };
    const fn = await loadSend();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { notification_id: NOTIF } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: false, reason: "twilio_not_configured" });
    expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "sms_claim", args: { p_notification_id: NOTIF, p_provider_ready: false } });
    expect(fetchCalls).toEqual([]);
  });

  it("sends the FIXED phrase and a job link, never the notification's own text, and records the SID", async () => {
    scenario.rpc.sms_claim = {
      action: "send", sms_id: "sms-1", phone: "+12255550123", kind: "job_offer", job_id: JOB, first_text: true,
    };
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { notification_id: NOTIF } }));
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls?.[0]).toMatchObject({ args: { p_provider_ready: true } });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    const form = new URLSearchParams(String(fetchCalls[0].init?.body));
    expect(form.get("To")).toBe("+12255550123");
    expect(form.get("MessagingServiceSid")).toBe(MG);
    expect(form.get("Body")).toBe(
      `Louisiana Helpr: You have a new job offer. https://www.louisianahelpr.com/jobs?job=${JOB} Reply STOP to stop.`,
    );
    expect(scenario.rpcCalls?.[1]).toMatchObject({
      name: "sms_record_result", args: { p_sms_id: "sms-1", p_status: "sent", p_provider_sid: "SM123", p_error_code: null },
    });
  });

  it("records a Twilio refusal with its error code (21610 = recipient replied STOP)", async () => {
    stubTwilio({ status: 400, body: { code: 21610, message: "Attempt to send to unsubscribed recipient" } });
    scenario.rpc.sms_claim = { action: "send", sms_id: "sms-2", phone: "+12255550123", kind: "message", job_id: null, first_text: false };
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { notification_id: NOTIF } }));
    expect(res.status).toBe(502);
    expect(scenario.rpcCalls?.[1]).toMatchObject({
      name: "sms_record_result", args: { p_sms_id: "sms-2", p_status: "failed", p_provider_sid: null, p_error_code: "21610" },
    });
  });

  it("the double opt-in job sends the fixed confirmation text to the pending number", async () => {
    scenario.rpc.sms_claim_confirmation = { action: "send", sms_id: "sms-c", phone: "+12255550123", kind: "confirm", job_id: null, first_text: false };
    scenario.rpc.sms_record_result = true;
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { confirm_user_id: NOTIF } }));
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "sms_claim_confirmation", args: { p_user_id: NOTIF, p_provider_ready: true } });
    const form = new URLSearchParams(String(fetchCalls[0].init?.body));
    expect(form.get("Body")).toBe(SMS_CONFIRM_TEXT);
    expect(form.get("Body")).toMatch(/Reply YES/);
  });

  it("rejects a body that is not a uuid", async () => {
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { notification_id: "x'; drop" } }));
    expect(res.status).toBe(400);
    expect(scenario.rpcCalls).toEqual([]);
  });

  it("a claim error is a 500, not a silent success", async () => {
    scenario.rpcErrors = { sms_claim: { message: "boom" } };
    const fn = await loadSend(TWILIO_ENV);
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: { notification_id: NOTIF } }));
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
      expect.objectContaining({ name: "sms_inbound_keyword", args: { p_phone: "+12255550123", p_action: "stop" } }),
    ]);
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
    expect(await res.text()).toContain("<Message>Louisiana Helpr alerts: help at admin@louisianahelpr.com");
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
});
