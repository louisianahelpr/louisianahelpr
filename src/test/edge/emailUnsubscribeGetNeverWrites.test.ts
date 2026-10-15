/**
 * Q1655 + Q?unsub-page-raw-html: an email's unsubscribe link.
 *
 * Before: a GET of supabase/functions/email-unsubscribe WROTE the opt-out
 * (any mail scanner or link preview that fetched the URL turned the member's
 * email off), then rendered an HTML page that Supabase serves as text/plain
 * (measured on prod 2026-10-14: every footer click showed raw markup).
 *
 * Now:
 *   1. a GET writes nothing and redirects (302) to the app's /unsubscribe page,
 *      carrying the same signed token;
 *   2. the page's calls (src/lib/emailUnsubscribe.ts, the real module) drive the
 *      real function source through the edge harness: `check` writes nothing
 *      and names the address, `unsubscribe` writes the opt-out, `resubscribe`
 *      undoes it, a bad token is "invalid_link" and writes nothing;
 *   3. a mail client's RFC 8058 one-click POST still writes on the POST alone
 *      and gets a text 200 (the job-match half is in jobMatchListUnsubscribe).
 */
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (req.method === 'GET') { |   if (req.method === 'HEAD') {
// @mutate supabase/functions/email-unsubscribe/index.ts |   return `${getAppUrl()}/unsubscribe#${q.toString()}` |   return `${getAppUrl()}/unsubscribe?${q.toString()}`
// @mutate supabase/functions/email-unsubscribe/index.ts |   return `${getAppUrl()}/unsubscribe#${q.toString()}` |   return `${getAppUrl()}/profile#${q.toString()}`
// @mutate supabase/functions/email-unsubscribe/index.ts |   for (const key of ['e', 'sig', 'list']) { |   for (const key of url.searchParams.keys()) {
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (action === 'check') { |   if (action === 'x-check') {
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (wantsJson) { |   if (false) {
// @mutate src/lib/emailUnsubscribe.ts |   if (res.ok && body?.ok === true && body.action === action && typeof body.email === "string") { |   if (res.ok) {
// @mutate scripts/probes/unsubscribe-get-redirects.mjs |   return problems;\n} |   return [];\n}
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks } from "./mocks/email";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postUnsubscribe, readUnsubscribeLink, type UnsubscribeLink } from "@/lib/emailUnsubscribe";
import { gradeUnsubscribeGet } from "../../../scripts/probes/unsubscribe-get-redirects.mjs";

const FN = "https://x.supabase.co/functions/v1/email-unsubscribe";

async function loadUnsub(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "c" });
  return loadEdgeFunction("email-unsubscribe");
}

/** A fetch that hands the page's request straight to the real function source. */
const viaHarness = (fn: EdgeHarness): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => fn.fetch(new Request(input, init))) as typeof fetch;

describe("email-unsubscribe: a GET writes nothing and sends the visitor to the app page", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    scenario.reads.profiles = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.signup_leads = { rows: [] };
  });

  /** The Location, and the token it carries in its fragment. */
  const target = (res: Response) => {
    const to = new URL(res.headers.get("Location") ?? "about:blank");
    return { to, token: new URLSearchParams(to.hash.slice(1)) };
  };

  it("a footer-link GET (promotions) writes nothing and 302s to www /unsubscribe with the token in the fragment", async () => {
    const fn = await loadUnsub();
    const res = await fn.fetch(new Request(`${FN}?e=member%40example.com&sig=ok-promotions`, { method: "GET" }));
    expect(res.status).toBe(302);
    const { to, token } = target(res);
    expect(`${to.origin}${to.pathname}`).toBe("https://www.louisianahelpr.com/unsubscribe");
    expect(to.search, "the token never rides in the query (server logs)").toBe("");
    expect(token.get("e")).toBe("member@example.com");
    expect(token.get("sig")).toBe("ok-promotions");
    expect(token.get("list")).toBeNull();
    expect(res.headers.get("Content-Type"), "no HTML body for Supabase to serve as text/plain").toBeNull();
    expect(scenario.writes, "a GET must never write (Q1655)").toHaveLength(0);
  });

  it("a job-match GET keeps list=job_matches and writes nothing", async () => {
    const fn = await loadUnsub();
    const res = await fn.fetch(new Request(`${FN}?e=member%40example.com&sig=ok-job_matches&list=job_matches`));
    expect(res.status).toBe(302);
    expect(target(res).token.get("list")).toBe("job_matches");
    expect(scenario.writes).toHaveLength(0);
  });

  it("a GET with a bad token still writes nothing (the page reports it)", async () => {
    const fn = await loadUnsub();
    const res = await fn.fetch(new Request(`${FN}?e=member%40example.com&sig=forged`));
    expect(res.status).toBe(302);
    expect(scenario.writes).toHaveLength(0);
  });

  it("only e, sig and list reach the Location: no next= or redirect= rides along", async () => {
    const fn = await loadUnsub();
    const res = await fn.fetch(new Request(`${FN}?e=member%40example.com&sig=ok-promotions&next=https://evil.test&redirect=x`));
    const { to, token } = target(res);
    expect(to.origin).toBe("https://www.louisianahelpr.com");
    expect([...token.keys()].sort()).toEqual(["e", "sig"]);
  });

  it("HEAD, PUT and DELETE are refused and write nothing", async () => {
    const fn = await loadUnsub();
    for (const method of ["HEAD", "PUT", "DELETE"]) {
      const res = await fn.fetch(new Request(`${FN}?e=member%40example.com&sig=ok-promotions`, { method }));
      expect(res.status, method).toBe(405);
    }
    expect(scenario.writes).toHaveLength(0);
  });
});

describe("the /unsubscribe page's calls against the real function", () => {
  const link: UnsubscribeLink = { e: "member@example.com", sig: "ok-promotions", list: "promotions" };

  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    scenario.reads.profiles = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1" }] };
    scenario.reads.signup_leads = { rows: [] };
  });

  it("reads the token the redirect carried in the fragment", () => {
    expect(readUnsubscribeLink("#e=member%40example.com&sig=ok-promotions")).toEqual(link);
    expect(readUnsubscribeLink("#e=a&sig=b&list=job_matches")?.list).toBe("job_matches");
    expect(readUnsubscribeLink("#e=a")).toBeNull();
  });

  it("check names the address and writes nothing", async () => {
    const fn = await loadUnsub();
    const r = await postUnsubscribe("https://x.supabase.co", link, "check", viaHarness(fn));
    expect(r).toEqual({ ok: true, action: "check", list: "promotions", email: "member@example.com" });
    expect(scenario.writes).toHaveLength(0);
  });

  it("the button's unsubscribe writes the commercial opt-out, and resubscribe undoes it", async () => {
    const fn = await loadUnsub();
    const off = await postUnsubscribe("https://x.supabase.co", link, "unsubscribe", viaHarness(fn));
    expect(off).toEqual({ ok: true, action: "unsubscribe", list: "promotions", email: "member@example.com" });
    const prefs = () => scenario.writes.filter((w) => w.table === "notification_preferences").map((w) => w.payload);
    expect(prefs()).toEqual([{ user_id: "real-user-1", email_promotions: false }]);

    const on = await postUnsubscribe("https://x.supabase.co", link, "resubscribe", viaHarness(fn));
    expect(on.ok && on.action).toBe("resubscribe");
    expect(prefs()).toEqual([
      { user_id: "real-user-1", email_promotions: false },
      { user_id: "real-user-1", email_promotions: true },
    ]);
  });

  it("the job-match link turns off only new-job email", async () => {
    const fn = await loadUnsub();
    const r = await postUnsubscribe(
      "https://x.supabase.co",
      { e: "member@example.com", sig: "ok-job_matches", list: "job_matches" },
      "unsubscribe",
      viaHarness(fn),
    );
    expect(r.ok && r.list).toBe("job_matches");
    expect(scenario.writes.map((w) => w.payload)).toEqual([{ user_id: "real-user-1", email_job_matches: false }]);
  });

  it("a forged token is invalid_link and writes nothing, for check as for unsubscribe", async () => {
    const fn = await loadUnsub();
    for (const action of ["check", "unsubscribe", "resubscribe"] as const) {
      const r = await postUnsubscribe("https://x.supabase.co", { ...link, sig: "forged" }, action, viaHarness(fn));
      expect(r, action).toEqual({ ok: false, error: "invalid_link" });
    }
    expect(scenario.writes).toHaveLength(0);
  });

  it("the job-match link's resubscribe turns only new-job email back on", async () => {
    const fn = await loadUnsub();
    const r = await postUnsubscribe(
      "https://x.supabase.co",
      { e: "member@example.com", sig: "ok-job_matches", list: "job_matches" },
      "resubscribe",
      viaHarness(fn),
    );
    expect(r.ok && r.action).toBe("resubscribe");
    expect(scenario.writes.map((w) => w.payload)).toEqual([{ user_id: "real-user-1", email_job_matches: true }]);
  });

  it("an address with no account gets the same answer as a member (no account-existence oracle)", async () => {
    const fn = await loadUnsub();
    const member = await postUnsubscribe("https://x.supabase.co", link, "unsubscribe", viaHarness(fn));
    scenario.reads.profiles = { rows: [] };
    const stranger = await postUnsubscribe("https://x.supabase.co", link, "unsubscribe", viaHarness(fn));
    expect(stranger).toEqual(member);
  });

  it("a transport failure and a non-JSON 200 are failures, never success", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await postUnsubscribe("https://x.supabase.co", link, "unsubscribe", offline)).toEqual({ ok: false, error: "network" });
    const plain200 = (async () => new Response("Unsubscribed", { status: 200 })) as typeof fetch;
    expect(await postUnsubscribe("https://x.supabase.co", link, "unsubscribe", plain200)).toEqual({ ok: false, error: "failed" });
  });

  it("a mail client's one-click POST still writes on the POST alone and gets text 200 (RFC 8058)", async () => {
    const fn = await loadUnsub();
    const res = await fn.fetch(new Request(`${FN}?e=member%40example.com&sig=ok-promotions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(scenario.writes.filter((w) => w.table === "notification_preferences").map((w) => w.payload))
      .toEqual([{ user_id: "real-user-1", email_promotions: false }]);
  });
});

describe("the live probe (scripts/probes/unsubscribe-get-redirects.mjs) grades prod's answer", () => {
  it("fails the answer prod gave on 2026-10-14 (400 text/plain HTML) and passes the redirect", () => {
    const measured = {
      status: 400,
      location: null,
      contentType: "text/plain",
      body: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    };
    expect(gradeUnsubscribeGet(measured).length).toBeGreaterThan(0);
    expect(gradeUnsubscribeGet({
      status: 302,
      location: "https://www.louisianahelpr.com/unsubscribe#e=probe&sig=probe-invalid",
      contentType: null,
      body: "",
    })).toEqual([]);
    expect(gradeUnsubscribeGet({
      status: 302,
      location: "https://www.louisianahelpr.com/unsubscribe?e=probe&sig=probe-invalid",
      contentType: null,
      body: "",
    }).length).toBeGreaterThan(0);
  });

  it("runs in the edge smoke workflow", () => {
    const wf = readFileSync(join(process.cwd(), ".github/workflows/edge-function-smoke.yml"), "utf8");
    expect(wf).toMatch(/^\s+run: node scripts\/probes\/unsubscribe-get-redirects\.mjs$/m);
  });
});
