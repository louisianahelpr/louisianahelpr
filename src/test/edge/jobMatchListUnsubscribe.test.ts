/**
 * Q1585 (d): every member gets the "new job posted" email for every new job
 * (owner, 2026-10-12), so it is bulk mail to a mailbox provider and carries an
 * RFC 8058 one-click List-Unsubscribe. The link must turn off EXACTLY that
 * email (notification_preferences.email_job_matches) and nothing else, and
 * only for a token signed for that list.
 *
 *  1. `_shared/unsubscribe.ts`, the real module: the list is inside the HMAC,
 *     so a promotions link cannot be replayed as a job-match opt-out or the
 *     reverse, and the promotions link already in inboxes is unchanged.
 *  2. send-notification-email (real source, edge harness): a job_match email
 *     is queued with the job-match List-Unsubscribe headers; a transactional
 *     email carries none.
 *  3. email-unsubscribe (real source, edge harness): a job-match one-click POST
 *     writes email_job_matches = false and never the commercial consent flags;
 *     a token signed for the other list is refused.
 */
// @mutate supabase/functions/_shared/unsubscribe.ts |   return list === 'promotions' ? `${TOKEN_VERSION}:${normalized}` : `${TOKEN_VERSION}.${list}:${normalized}` |   return `${TOKEN_VERSION}:${normalized}`
// @mutate supabase/functions/send-notification-email/index.ts |       : isJobMatch |       : false
// @mutate supabase/functions/email-unsubscribe/index.ts |     .upsert({ user_id: userId, email_job_matches: !optOut }, { onConflict: 'user_id' }) |     .upsert({ user_id: userId, email_promotions: !optOut }, { onConflict: 'user_id' })
// @mutate supabase/functions/email-unsubscribe/index.ts | url.searchParams.get('sig'), list) | url.searchParams.get('sig'))
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, unsubscribeHeaders } from "./mocks/email";

/**
 * Loaded through a NON-LITERAL specifier (as pushCategoryAndIcalDates.test.ts
 * does): tsconfig.app.json does not compile `supabase/functions/*`, so a static
 * import fails with TS6307. The module IS typechecked by `npm run typecheck:edge`.
 * It reads Deno.env only inside its functions, so the stub below is in place
 * by the time anything runs.
 */
const UNSUB_PATH = "../../../supabase/functions/_shared/unsubscribe.ts";
type List = "promotions" | "job_matches";
type UnsubModule = {
  buildUnsubscribeUrl(email: string, list?: List): Promise<string | null>;
  verifyUnsubscribeToken(e: string | null, sig: string | null, list?: List): Promise<string | null>;
  unsubscribeHeaders(email?: string, list?: List): Promise<Record<string, string>>;
  unsubscribeListFrom(value: string | null): List;
};
const loadUnsubModule = async () => (await import(/* @vite-ignore */ UNSUB_PATH)) as UnsubModule;

describe("_shared/unsubscribe.ts: the list is part of the signature", () => {
  const g = globalThis as unknown as { Deno?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.Deno;
    const env: Record<string, string> = { CRON_SECRET: "test-secret", SUPABASE_URL: "https://x.supabase.co" };
    g.Deno = { env: { get: (k: string) => env[k] } };
  });
  afterEach(() => {
    g.Deno = saved;
  });

  it("a job-match link verifies only as a job-match link, and a promotions link only as promotions", async () => {
    const m = await loadUnsubModule();
    const job = new URL((await m.buildUnsubscribeUrl("Member@Example.com", "job_matches"))!);
    const promo = new URL((await m.buildUnsubscribeUrl("Member@Example.com"))!);
    expect(job.searchParams.get("list")).toBe("job_matches");
    expect(promo.searchParams.get("list"), "the promotions link already in inboxes is unchanged").toBeNull();
    expect(job.searchParams.get("e")).toBe(promo.searchParams.get("e"));
    expect(job.searchParams.get("sig")).not.toBe(promo.searchParams.get("sig"));

    const v = (u: URL, list?: List) =>
      m.verifyUnsubscribeToken(u.searchParams.get("e"), u.searchParams.get("sig"), list);
    expect(await v(job, "job_matches")).toBe("member@example.com");
    expect(await v(job, "promotions"), "a job-match link must not opt out of promotions").toBeNull();
    expect(await v(job), "a job-match link must not opt out of promotions").toBeNull();
    expect(await v(promo, "promotions")).toBe("member@example.com");
    expect(await v(promo, "job_matches"), "a promotions link must not turn off job emails").toBeNull();
    expect(m.unsubscribeListFrom("job_matches")).toBe("job_matches");
    expect(m.unsubscribeListFrom("anything")).toBe("promotions");
    expect(m.unsubscribeListFrom(null)).toBe("promotions");
  });

  it("job-match headers are RFC 8058 one-click, pointing at the job-match link", async () => {
    const m = await loadUnsubModule();
    const h = await m.unsubscribeHeaders("member@example.com", "job_matches");
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/x\.supabase\.co\/functions\/v1\/email-unsubscribe\?e=[^&]+&sig=[^&]+&list=job_matches>$/);
  });
});

async function loadSender(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", RESEND_API_KEY: "re_test" });
  return loadEdgeFunction("send-notification-email");
}

describe("send-notification-email: job_match mail carries the job-match List-Unsubscribe", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    unsubscribeHeaders.mockClear();
    resetEnv();
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1", email_job_matches: true, email_work_status: true }] };
    scenario.reads.profiles = { rows: [{ email: "real.user@gmail.com", full_name: "Real User" }] };
    scenario.reads.suppressed_emails = { rows: [] };
    scenario.rpc.notification_crosses_seed_boundary = false;
  });

  const queued = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email").map((c) => (c.args as { payload: { headers?: Record<string, string> } }).payload);

  it("a job_match email is queued with one-click headers for the job-match list", async () => {
    const fn = await loadSender();
    const res = await fn.fetch(fn.request({
      headers: { Authorization: "Bearer service-key" },
      body: { user_id: "real-user-1", title: "New job posted", message: "A new yard_work job was just posted", type: "job_match", link: "/home?job=1" },
    }));
    expect(res.status).toBe(200);
    const sent = queued();
    expect(sent).toHaveLength(1);
    expect(unsubscribeHeaders).toHaveBeenCalledWith("real.user@gmail.com", "job_matches");
    expect(sent[0].headers?.["List-Unsubscribe"]).toContain("list=job_matches");
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("a transactional email carries no unsubscribe control", async () => {
    const fn = await loadSender();
    const res = await fn.fetch(fn.request({
      headers: { Authorization: "Bearer service-key" },
      body: { user_id: "real-user-1", title: "Arrival confirmed", message: "Your Helpr arrived", type: "work_status" },
    }));
    expect(res.status).toBe(200);
    const sent = queued();
    expect(sent).toHaveLength(1);
    expect(sent[0].headers).toBeUndefined();
    expect(unsubscribeHeaders).not.toHaveBeenCalled();
  });
});

async function loadUnsub(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "c" });
  return loadEdgeFunction("email-unsubscribe");
}

describe("email-unsubscribe: the job-match link turns off job-match email only", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    scenario.reads.profiles = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.signup_leads = { rows: [] };
  });

  const post = (fn: EdgeHarness, sig: string, list: string) =>
    fn.fetch(fn.request({
      method: "POST",
      url: `https://x.supabase.co/functions/v1/email-unsubscribe?e=member%40example.com&sig=${sig}&list=${list}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      rawBody: "List-Unsubscribe=One-Click",
    }));

  it("one-click POST writes email_job_matches = false and nothing commercial", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "ok-job_matches", "job_matches");
    expect(res.status).toBe(200);
    const prefs = scenario.writes.filter((w) => w.table === "notification_preferences");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].payload).toEqual({ user_id: "real-user-1", email_job_matches: false });
    expect(scenario.writes.filter((w) => w.table === "profiles"), "marketing_consent untouched").toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "signup_leads"), "a lead gets no job email").toHaveLength(0);
  });

  it("a promotions-signed token presented as a job-match link is refused, and writes nothing", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "ok-promotions", "job_matches");
    expect(res.status).toBe(400);
    expect(scenario.writes).toHaveLength(0);
  });

  it("the promotions link still flips the commercial flags, not the job-match switch", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "ok-promotions", "promotions");
    expect(res.status).toBe(200);
    const prefs = scenario.writes.filter((w) => w.table === "notification_preferences");
    expect(prefs.map((w) => w.payload)).toEqual([{ user_id: "real-user-1", email_promotions: false }]);
    expect(scenario.writes.filter((w) => w.table === "profiles")).toHaveLength(1);
  });
});
