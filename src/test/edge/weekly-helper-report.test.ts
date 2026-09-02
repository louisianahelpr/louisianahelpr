/**
 * Unit tests for the `weekly-helper-report` Supabase edge function.
 *
 * Three defects are pinned here, all of the same family — a run that dropped
 * work and reported a clean 200:
 *
 *   1. The helper roster came from `jobs.select("helper_id")` with NO bound and
 *      NO `ORDER BY`. PostgREST caps a result at `db-max-rows = 1000` (proven
 *      against prod: `limit=5000` on a 1,619-row table returns exactly 1000),
 *      and applies the cap after the sort — so with no sort the roster was
 *      "some 1000 rows", and every helper outside them silently got no report.
 *   2. That read's `error` was DISCARDED (`const { data } = await ...`), so a
 *      failed query produced `undefined`, an empty roster, and the cheerful
 *      message "No users have worked a job yet".
 *   3. The notification INSERT — the only thing this function delivers — had
 *      its result discarded too, so `sent` counted attempts rather than rows.
 *
 * Runs the REAL function source through the edge harness, including the real
 * `_shared/paginate.ts` and `_shared/cron-result.ts`, so whether a run that
 * dropped work answers non-2xx — the only signal `sweep_cron_http_failures()`
 * can see — is genuinely under test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("weekly-helper-report");
}

function cronRequest(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** One Pro helper who worked one job this week. */
function seedOneHelper() {
  scenario.reads.jobs = { rows: [{ helper_id: "helper-1", id: "job-1" }] };
  scenario.reads.profiles = {
    rows: [
      {
        user_id: "helper-1",
        full_name: "Dana",
        email: "dana@example.com",
        subscription_tier: "pro",
        subscription_expires_at: null,
      },
    ],
  };
  scenario.reads.reviews = { rows: [] };
  scenario.reads.applications = { rows: [] };
}

function reportWrites() {
  return scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
}

describe("weekly-helper-report edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("rejects a request without the cron bearer", async () => {
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("sends one report per Pro helper and answers 200 with no defects", async () => {
    const fn = await loadConfigured();
    seedOneHelper();

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.sent).toBe(1);
    expect(b.defects).toBe(0);
    expect(reportWrites()).toHaveLength(1);
  });

  it("proves the notification INSERT is guarded: zero rows written is a DEFECT, not a send", async () => {
    const fn = await loadConfigured();
    seedOneHelper();
    // A null `error` does not mean the write happened. This is the shape the
    // old code could not distinguish from success.
    scenario.writeSelectRows["notifications"] = [];

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(b.sent).toBe(0);
    expect(String(b.defectReasons)).toContain("zero rows written");
  });

  it("projects a column `notifications` actually has", async () => {
    // `.select("id")` is only a guard if `id` exists — a reflexive `.select("id")`
    // on a table whose key is named something else 400s in production (that is
    // exactly what `stripe_webhook_events` does). `notifications` is
    // (id, user_id, title, message, type, read, link, created_at).
    const fn = await loadConfigured();
    seedOneHelper();

    await fn.fetch(cronRequest(fn));

    expect(reportWrites()[0].selectCols).toBe("id");
  });

  it("PAGES the roster scan instead of taking one capped read", async () => {
    const fn = await loadConfigured();
    // 1,200 assigned jobs — past the 1000-row cap. The mock slices on
    // `.range()` exactly as PostgREST does, so the previous single unpaged read
    // would have stopped at the first window and reported 500.
    //
    // One shared helper on purpose: the store resolves `.in(...)` by table name
    // rather than by filter, so a wide id list would fan the profile lookup out
    // once per chunk and the SEND count would measure the mock, not the code.
    // The property under test is the ROSTER scan, and `scanned_jobs` is it.
    seedOneHelper();
    scenario.reads.jobs = {
      rows: Array.from({ length: 1200 }, (_, i) => ({ helper_id: "helper-1", id: `job-${i}` })),
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.scanned_jobs).toBe(1200);
    expect(b.sent).toBe(1);
  });

  it("a TRUNCATED roster read fails the run instead of reporting on a subset", async () => {
    const fn = await loadConfigured();
    // The server hands back 3 rows while insisting 1,619 match — the exact
    // shape of a capped read. Nothing about the rows themselves says so.
    scenario.reads.jobs = {
      rows: [
        { helper_id: "helper-1", id: "job-1" },
        { helper_id: "helper-2", id: "job-2" },
        { helper_id: "helper-3", id: "job-3" },
      ],
      count: 1619,
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(String(b.error)).toContain("read 3 of 1619 rows");
    expect(reportWrites()).toHaveLength(0);
  });

  it("a FAILED roster read is an error, not 'no users have worked a job yet'", async () => {
    const fn = await loadConfigured();
    scenario.reads.jobs = { error: { message: "permission denied for table jobs" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(String(b.error)).toContain("permission denied");
    // The old code answered 200 with this message on a failed read.
    expect(JSON.stringify(b)).not.toContain("No users have worked a job yet");
  });

  it("a failed STATS read skips the helper rather than emailing them $0.00", async () => {
    const fn = await loadConfigured();
    seedOneHelper();
    // `reviews` is one of the four per-helper stats reads. Its error used to be
    // swallowed by `.data?.length || 0`, producing a real-looking zero in a
    // report about someone's own week.
    scenario.reads.reviews = { error: { message: "statement timeout" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.sent).toBe(0);
    expect(reportWrites()).toHaveLength(0);
    expect(String(b.defectReasons)).toContain("statement timeout");
  });

  it("skips helpers whose membership has expired", async () => {
    const fn = await loadConfigured();
    seedOneHelper();
    scenario.reads.profiles = {
      rows: [
        {
          user_id: "helper-1",
          full_name: "Dana",
          email: "dana@example.com",
          subscription_tier: "pro",
          subscription_expires_at: "2020-01-01T00:00:00Z",
        },
      ],
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(b.sent).toBe(0);
    expect(b.total).toBe(0);
    expect(reportWrites()).toHaveLength(0);
  });
});
