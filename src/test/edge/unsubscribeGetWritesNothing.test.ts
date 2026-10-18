/**
 * Q1655 (lh-authz-rls review of Q1585): a GET of the unsubscribe link must
 * write NOTHING. Mail scanners, link previewers and corporate gateways GET
 * every URL in a message; email-unsubscribe used to write on that GET, so any
 * of them turned a member's email off. It also rendered its result as HTML,
 * which Supabase serves as text/plain (measured 2026-10-17 on prod: the
 * function's 400 page came back `content-type: text/plain` + nosniff), so a
 * member saw raw source, and its resubscribe button could never show the
 * resubscribed page (every POST answered text).
 *
 * Now (real source, edge harness):
 *   1. GET, valid or not: no read, no write, 303 to the web page /unsubscribe
 *      carrying exactly e/sig/list.
 *   2. The page's POST `action=unsubscribe` / `action=resubscribe` writes, and
 *      answers JSON the page renders. The page sends e/sig/list in the BODY
 *      (never a URL analytics or Sentry would record: lh-authz-rls review of
 *      Q1655, #1), and a page POST reads them ONLY from the body.
 *   3. The page's POST with a bad signature, or a link signed for the other
 *      list, writes nothing: invalid_link, 400.
 *   4. The RFC 8058 one-click POST is unchanged (writes, answers text):
 *      jobMatchListUnsubscribe.test.ts covers its writes, this its body.
 */
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (req.method === 'GET') return toConfirmPage(url) |   if (req.method === 'GET' && url.searchParams.has('never')) return toConfirmPage(url)
// @mutate supabase/functions/email-unsubscribe/index.ts |     if (sent === 'unsubscribe' \|\| sent === 'resubscribe') { |     if (sent === 'resubscribe') {
// @mutate supabase/functions/email-unsubscribe/index.ts |   for (const k of ['e', 'sig', 'list']) { |   for (const k of ['e', 'sig']) {
// @mutate supabase/functions/email-unsubscribe/index.ts |       token = form |       void form
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (fromPage) return json({ status: action === 'resubscribe' ? 'resubscribed' : 'unsubscribed', list }, 200) |   if (fromPage) return json({ status: 'unsubscribed', list }, 200)
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks } from "./mocks/email";

const BASE = "https://x.supabase.co/functions/v1/email-unsubscribe";

async function loadUnsub(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "c", APP_URL: "https://www.louisianahelpr.com" });
  return loadEdgeFunction("email-unsubscribe");
}

const post = (fn: EdgeHarness, query: string, rawBody: string) =>
  fn.fetch(fn.request({
    method: "POST",
    url: query ? `${BASE}?${query}` : BASE,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    rawBody,
  }));

describe("email-unsubscribe: a GET writes nothing (Q1655)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    scenario.reads.profiles = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.signup_leads = { rows: [] };
  });

  for (const [name, query] of [
    ["a valid job-match link", "e=member%40example.com&sig=ok-job_matches&list=job_matches"],
    ["a valid promotions link", "e=member%40example.com&sig=ok-promotions"],
    ["a forged link", "e=member%40example.com&sig=forged"],
  ] as const) {
    it(`${name}: 303 to the web page, nothing written`, async () => {
      const fn = await loadUnsub();
      const res = await fn.fetch(fn.request({ method: "GET", url: `${BASE}?${query}` }));
      expect(res.status).toBe(303);
      const to = new URL(res.headers.get("location") ?? "");
      expect(`${to.origin}${to.pathname}`).toBe("https://www.louisianahelpr.com/unsubscribe");
      const want = new URLSearchParams(query);
      expect(Object.fromEntries(to.searchParams)).toEqual(Object.fromEntries(want));
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(scenario.writes, "a GET must never write").toHaveLength(0);
    });
  }

  it("the page's unsubscribe POST writes and answers JSON", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "", "action=unsubscribe&e=member%40example.com&sig=ok-job_matches&list=job_matches");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ status: "unsubscribed", list: "job_matches" });
    const prefs = scenario.writes.filter((w) => w.table === "notification_preferences");
    expect(prefs.map((w) => w.payload)).toEqual([{ user_id: "real-user-1", email_job_matches: false }]);
  });

  it("the page's resubscribe POST writes the switch back on and answers JSON", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "", "action=resubscribe&e=member%40example.com&sig=ok-promotions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "resubscribed", list: "promotions" });
    const prefs = scenario.writes.filter((w) => w.table === "notification_preferences");
    expect(prefs.map((w) => w.payload)).toEqual([{ user_id: "real-user-1", email_promotions: true }]);
    expect(scenario.writes.filter((w) => w.table === "profiles").map((w) => w.payload)).toEqual([{ marketing_consent: true }]);
  });

  for (const [name, body] of [
    ["a forged signature", "action=unsubscribe&e=member%40example.com&sig=forged"],
    ["a promotions link presented as job matches", "action=unsubscribe&e=member%40example.com&sig=ok-promotions&list=job_matches"],
    ["a job-match link presented as promotions", "action=unsubscribe&e=member%40example.com&sig=ok-job_matches"],
  ] as const) {
    it(`the page's POST with ${name} writes nothing: invalid_link`, async () => {
      const fn = await loadUnsub();
      const res = await post(fn, "", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_link" });
      expect(scenario.writes).toHaveLength(0);
    });
  }

  it("a page POST reads the link from its body only, never the URL", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "e=member%40example.com&sig=ok-promotions", "action=unsubscribe");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_link" });
    expect(scenario.writes).toHaveLength(0);
  });

  it("the RFC 8058 one-click POST still writes and answers text", async () => {
    const fn = await loadUnsub();
    const res = await post(fn, "e=member%40example.com&sig=ok-job_matches&list=job_matches", "List-Unsubscribe=One-Click");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("Unsubscribed");
    expect(scenario.writes.filter((w) => w.table === "notification_preferences")).toHaveLength(1);
  });
});
