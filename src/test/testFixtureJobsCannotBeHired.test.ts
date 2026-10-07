/**
 * Q946 (owner, 2026-10-07): ONE durable test-only job, funded in the database
 * only (payment_status 'escrow', no Stripe charge), visible to the test
 * accounts only, that the browse journey applies to and withdraws from.
 *
 * What must hold, and why:
 *   1. it can never be hired: an escrow row with no PaymentIntent that got
 *      hired and released would pay a Helpr from the LIVE platform balance.
 *      The newest definition of enforce_test_fixture_job_never_hired refuses a
 *      Helpr, a direct offer, any status past open (except ending) and any
 *      money move while open, for every role, and its trigger watches exactly
 *      those columns. Behaviour (red before, 3x replay):
 *      src/test/pglite/testFixtureJobsCannotBeHired.pglite.mjs.
 *   2. the registry is server-only (no anon/authenticated grant, RLS on);
 *   3. the ensure script makes exactly that row (is_seed, escrow, open, the
 *      poster's, Cleaning) and registers it, keeps a healthy one, removes a
 *      leftover application, and replaces an ended one;
 *   4. NOT YET: e2e/journeys/01-browse.spec.ts applying to and withdrawing from
 *      it is left under Q1429 (its first wiring tripped CodeQL #462/#463 and was
 *      reverted to main's spec); its guard returns with that wiring.
 *
 * @mutate supabase/migrations/20261007122020_test_fixture_jobs_cannot_be_hired.sql |   IF NEW.helper_id IS NOT NULL AND NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN | IF false THEN
 * @mutate scripts/e2e/browseFixture.mjs |     payment_status: "escrow", |     payment_status: "unpaid",
 * @mutate scripts/e2e/browseFixture.mjs |       await call("DELETE", `applications?job_id=eq.${job.id}&helper_id=eq.${helperId}&select=id`); |       // removed
 * @mutate scripts/e2e/browseFixture.mjs |     if (job && job.status === "open") { |     if (false) {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import {
  BROWSE_FIXTURE_PURPOSE,
  BROWSE_FIXTURE_TITLE,
  ensureBrowseFixture,
  fixtureHealthy,
  fixtureRow,
} from "../../scripts/e2e/browseFixture.mjs";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

describe("the durable test job can be applied to, never hired (Q946)", () => {
  const def = effectiveDefs(MIGRATIONS).get("enforce_test_fixture_job_never_hired");
  const body = blankSqlComments(def?.stmt ?? "");
  const migs = (() => {
    const all = new Map<string, string>();
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      all.set(f, blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8")));
    }
    return all;
  })();

  it("reads the newest definition (inventory floor)", () => {
    expect(def, "enforce_test_fixture_job_never_hired is defined").toBeTruthy();
    expect(body.length).toBeGreaterThan(600);
  });

  it("refuses a Helpr, a direct offer, any status past open but ending, and money moving while open", () => {
    expect(body).toMatch(/FROM public\.test_fixture_jobs f WHERE f\.job_id = OLD\.id/);
    expect(body).toMatch(/IF NEW\.helper_id IS NOT NULL AND NEW\.helper_id IS DISTINCT FROM OLD\.helper_id THEN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/IF NEW\.offered_to_helper_id IS NOT NULL AND NEW\.offered_to_helper_id IS DISTINCT FROM OLD\.offered_to_helper_id THEN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/NEW\.status::text NOT IN \('open', 'cancelled'\) THEN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/NEW\.payment_status IS DISTINCT FROM OLD\.payment_status AND NEW\.status::text <> 'cancelled' THEN\s+RAISE EXCEPTION/);
    // No role exemption: a service-role cron or RPC must not walk it into the money path either.
    expect(body).not.toMatch(/service_role|auth\.role\(\)|current_user|session_user/);
  });

  it("the newest trigger on jobs runs it before every update of those columns", () => {
    const creates = [...migs.entries()].filter(([, s]) => /CREATE TRIGGER trg_jobs_test_fixture_never_hired/.test(s));
    expect(creates.length).toBeGreaterThan(0);
    const [, newest] = creates[creates.length - 1];
    expect(newest).toMatch(/CREATE TRIGGER trg_jobs_test_fixture_never_hired\s+BEFORE UPDATE OF helper_id, offered_to_helper_id, status, payment_status ON public\.jobs\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_test_fixture_job_never_hired\(\)/);
  });

  it("the registry is server-only", () => {
    const sql = [...migs.values()].filter((s) => /test_fixture_jobs/.test(s)).join("\n");
    expect(sql).toMatch(/ALTER TABLE public\.test_fixture_jobs ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.test_fixture_jobs FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT [^;]* ON public\.test_fixture_jobs TO [^;]*(anon|authenticated)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.enforce_test_fixture_job_never_hired\(\) FROM PUBLIC, anon, authenticated/);
  });
});

describe("scripts/e2e/browseFixture.mjs keeps exactly one healthy fixture", () => {
  it("the row is a test-only, funded-in-the-database, open Cleaning job of the poster's", () => {
    const row = fixtureRow(POSTER, Date.parse("2024-10-07T12:00:00Z"));
    expect(row).toMatchObject({ customer_id: POSTER, status: "open", payment_status: "escrow", is_seed: true, category: "cleaning", title: BROWSE_FIXTURE_TITLE });
    expect(row).not.toHaveProperty("stripe_payment_intent_id");
    // Long enough for JobDetailDialog's Read More (> 180), within the DB's 1000 (Q949).
    expect(String(row.description).length).toBeGreaterThan(180);
    expect(String(row.description).length).toBeLessThanOrEqual(1000);
    expect(String(row.title).length).toBeLessThanOrEqual(32);
    expect(row).not.toHaveProperty("helper_id");
    expect(row.date_needed).toBe("2024-11-06");
    expect(Date.parse(String(row.created_at))).toBeLessThan(Date.parse("2024-10-07T00:00:01Z"));
  });

  it("health is open + escrow + is_seed + the poster's + no Helpr", () => {
    const ok = { status: "open", payment_status: "escrow", is_seed: true, customer_id: POSTER, helper_id: null };
    expect(fixtureHealthy(ok, POSTER)).toBe(true);
    for (const bad of [{ status: "cancelled" }, { payment_status: "cancelled" }, { is_seed: false }, { customer_id: HELPER }, { helper_id: HELPER }]) {
      expect(fixtureHealthy({ ...ok, ...bad }, POSTER), JSON.stringify(bad)).toBe(false);
    }
    expect(fixtureHealthy(null, POSTER)).toBe(false);
  });

  type Call = { method: string; path: string; body: unknown };
  const fakeFetch = (rows: { reg: unknown[]; job: unknown[] }) => {
    const calls: Call[] = [];
    const impl = (async (url: string, init: { method: string; body?: string }) => {
      const path = url.split("/rest/v1/")[1];
      calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null });
      let out: unknown = [];
      if (init.method === "GET" && path.startsWith("test_fixture_jobs")) out = rows.reg;
      else if (init.method === "GET" && path.startsWith("jobs")) out = rows.job;
      else if (init.method === "PATCH") out = [{ id: "j1" }];
      else if (init.method === "POST" && path.startsWith("jobs")) out = [{ id: "new-job" }];
      else if (init.method === "POST" && path.startsWith("test_fixture_jobs")) out = [{ job_id: "new-job" }];
      return new Response(JSON.stringify(out), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, impl };
  };
  const NOW = Date.parse("2024-10-07T12:00:00Z");
  const healthy = { id: "j1", status: "open", payment_status: "escrow", is_seed: true, customer_id: POSTER, helper_id: null, date_needed: "2024-10-30" };

  it("keeps a healthy fixture and removes the helper's leftover application", async () => {
    const f = fakeFetch({ reg: [{ job_id: "j1" }], job: [healthy] });
    const r = await ensureBrowseFixture({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", posterId: POSTER, helperId: HELPER, fetchImpl: f.impl, now: NOW });
    expect(r).toEqual({ jobId: "j1", action: "kept" });
    expect(f.calls.some((c) => c.method === "DELETE" && c.path.startsWith(`applications?job_id=eq.j1&helper_id=eq.${HELPER}`))).toBe(true);
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
    expect(f.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("moves a fixture's date forward when it is within a week", async () => {
    const f = fakeFetch({ reg: [{ job_id: "j1" }], job: [{ ...healthy, date_needed: "2024-10-09" }] });
    await ensureBrowseFixture({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", posterId: POSTER, helperId: HELPER, fetchImpl: f.impl, now: NOW });
    const patch = f.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ date_needed: "2024-11-06" });
  });

  it("ends a still-open fixture BEFORE unregistering it, so no open escrow job is left unprotected", async () => {
    const f = fakeFetch({ reg: [{ job_id: "j1" }], job: [{ ...healthy, customer_id: HELPER }] });
    await ensureBrowseFixture({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", posterId: POSTER, helperId: HELPER, fetchImpl: f.impl, now: NOW });
    const end = f.calls.findIndex((c) => c.method === "PATCH" && c.path.startsWith("jobs?id=eq.j1&status=eq.open"));
    const unreg = f.calls.findIndex((c) => c.method === "DELETE" && c.path.startsWith("test_fixture_jobs"));
    expect(end, "the old fixture is ended").toBeGreaterThan(-1);
    expect(f.calls[end].body).toMatchObject({ status: "cancelled", payment_status: "cancelled" });
    expect(unreg, "and only then unregistered").toBeGreaterThan(end);
  });

  it("replaces an ended fixture and registers the new one under the same purpose", async () => {
    const f = fakeFetch({ reg: [{ job_id: "j1" }], job: [{ ...healthy, status: "cancelled" }] });
    const r = await ensureBrowseFixture({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", posterId: POSTER, helperId: HELPER, fetchImpl: f.impl, now: NOW });
    expect(r).toEqual({ jobId: "new-job", action: "created" });
    expect(f.calls.some((c) => c.method === "DELETE" && c.path.startsWith(`test_fixture_jobs?purpose=eq.${BROWSE_FIXTURE_PURPOSE}`))).toBe(true);
    const insert = f.calls.find((c) => c.method === "POST" && c.path.startsWith("jobs"));
    expect(insert?.body).toMatchObject({ payment_status: "escrow", is_seed: true, status: "open" });
    expect(f.calls.find((c) => c.method === "POST" && c.path.startsWith("test_fixture_jobs"))?.body).toEqual({ job_id: "new-job", purpose: BROWSE_FIXTURE_PURPOSE });
  });
});

