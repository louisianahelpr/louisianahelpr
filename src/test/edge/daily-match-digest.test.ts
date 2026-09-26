/**
 * Unit tests for the `daily-match-digest` Supabase edge function — the daily
 * cron that summarizes each helper's queued job matches into one notification
 * and then drains `match_digest_queue`.
 *
 * The invariant under test is the DRAIN. The queue rows are deleted only after
 * the notifications insert succeeds, so a failed drain "retries next run" — but
 * that is only comforting if the next run succeeds. The error was already
 * checked; the ROW COUNT was not, and a DELETE matching zero rows returns
 * `{ data: [], error: null }`. Every row left behind is re-summarized and
 * re-sent to a real person tomorrow, and every day after, while the run reports
 * 200 the whole time.
 *
 * Runs the REAL function source via the edge harness, including the real
 * `_shared/cron-result.ts`, so whether a run that dropped work answers non-2xx
 * — the only signal `sweep_cron_http_failures()` can see — is genuinely tested.
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
  return loadEdgeFunction("daily-match-digest");
}

function cronRequest(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

/** Two queued matches for one helper. */
function seedQueue() {
  scenario.reads.match_digest_queue = {
    rows: [
      {
        id: "q-1",
        user_id: "helper-1",
        job_id: "job-1",
        created_at: "2026-08-30T12:00:00Z",
        jobs: {
          id: "job-1",
          title: "Move a couch",
          category: "moving",
          location: "123 Main St, Baton Rouge",
          budget: 80,
        },
      },
      {
        id: "q-2",
        user_id: "helper-1",
        job_id: "job-2",
        created_at: "2026-08-30T13:00:00Z",
        jobs: {
          id: "job-2",
          title: "Mow a lawn",
          category: "yard",
          location: "456 Oak Ave, Denham Springs",
          budget: 60,
        },
      },
    ],
  };
  scenario.rpc.mask_job_location = "Baton Rouge, LA";
  // Q392: both rows still in the user's feed at digest time.
  scenario.rpc.job_match_digest_rows = [
    { id: "q-1", send: true },
    { id: "q-2", send: true },
  ];
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

function drainWrite() {
  return scenario.writes.find((w) => w.table === "match_digest_queue" && w.op === "delete");
}

describe("daily-match-digest edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("sends one digest per user and drains every queue row it summarized", async () => {
    const fn = await loadConfigured();
    seedQueue();
    scenario.writeSelectRows["match_digest_queue:delete"] = [{ id: "q-1" }, { id: "q-2" }];

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);

    const b = await body(res);
    expect(b.ok).toBe(true);
    expect(b.users).toBe(1);
    expect(b.queued).toBe(2);
    expect(b.drained).toBe(2);
    expect(b.defects).toBe(0);

    // Both rows targeted in one request, and the street address never reaches
    // the notification.
    expect(drainWrite()?.filters).toEqual([
      { op: "in", column: "id", value: ["q-1", "q-2"] },
    ]);
    const notify = scenario.writes.find((w) => w.table === "notifications");
    const rows = notify?.payload as Array<{ message: string }>;
    expect(rows[0].message).toContain("Baton Rouge, LA");
    expect(rows[0].message).not.toContain("123 Main St");
  });

  it("records a DEFECT and answers 500 when the drain removes nothing", async () => {
    const fn = await loadConfigured();
    seedQueue();
    // The DELETE reports success and removes nothing — the shape a no-op DELETE
    // returns from PostgREST.
    scenario.writeSelectRows["match_digest_queue:delete"] = [];

    const res = await fn.fetch(cronRequest(fn));

    // BEFORE the fix this run answered 200 with `defects: 0`. The digest had
    // already gone out, the rows were still queued, and tomorrow's run would
    // send the identical digest to the same person — forever, invisibly.
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.ok).toBe(false);
    expect(b.drained).toBe(0);
    expect(b.defects).toBe(1);
    const reasons = (b.defectReasons as string[]).join(" | ");
    expect(reasons).toContain("matched 0/2 rows");
    expect(reasons).toContain("every day");
  });

  it("records a DEFECT on a PARTIAL drain, not just a total no-op", async () => {
    const fn = await loadConfigured();
    seedQueue();
    scenario.writeSelectRows["match_digest_queue:delete"] = [{ id: "q-1" }];

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.drained).toBe(1);
    expect((b.defectReasons as string[]).join(" | ")).toContain("matched 1/2 rows");
  });

  it("still records a DEFECT when the drain errors outright", async () => {
    const fn = await loadConfigured();
    seedQueue();
    scenario.writeErrors.match_digest_queue = { message: "permission denied", code: "42501" };

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(500);
    expect((await body(res)).defects).toBe(1);
  });

  it("asks the drain DELETE for `id` so a short drain is countable", async () => {
    // The mock returns the seeded rows regardless of projection, so the counts
    // above prove nothing about the projection reaching PostgREST. Assert it.
    const fn = await loadConfigured();
    seedQueue();
    scenario.writeSelectRows["match_digest_queue:delete"] = [];
    await fn.fetch(cronRequest(fn));
    expect(drainWrite()?.selectCols).toBe("id");
  });

  // Q392: a row is re-checked against the browse gate at digest time.
  it("drains a row whose job left the user's feed WITHOUT summarising it, and keeps a not-yet-visible row", async () => {
    const fn = await loadConfigured();
    seedQueue();
    scenario.reads.match_digest_queue.rows!.push({
      id: "q-3",
      user_id: "helper-1",
      job_id: "job-3",
      created_at: "2026-08-30T14:00:00Z",
      jobs: { id: "job-3", title: "Too new", category: "moving", location: "789 Elm St, Baton Rouge", budget: 40 },
    });
    // job-1 was hired since it was queued; job-3 is not in this user's feed yet.
    scenario.rpc.job_match_digest_rows = [
      { id: "q-1", send: false },
      { id: "q-2", send: true },
    ];
    scenario.writeSelectRows["match_digest_queue:delete"] = [{ id: "q-1" }, { id: "q-2" }];

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(scenario.rpcCalls?.find((c) => c.name === "job_match_digest_rows")?.args).toEqual({
      p_queue_ids: ["q-1", "q-2", "q-3"],
    });
    const rows = scenario.writes.find((w) => w.table === "notifications")?.payload as Array<{ title: string; message: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Today's matches — 1 job for you");
    expect(rows[0].message).toContain("Mow a lawn");
    expect(rows[0].message).not.toContain("Move a couch");
    expect(rows[0].message).not.toContain("Too new");
    expect(drainWrite()?.filters).toEqual([{ op: "in", column: "id", value: ["q-1", "q-2"] }]);
  });

  it("sends nothing and drains nothing when the gate check itself fails", async () => {
    const fn = await loadConfigured();
    seedQueue();
    scenario.rpcErrors = { job_match_digest_rows: { message: "canceling statement", code: "57014" } };

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(500);
    expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    expect(drainWrite()).toBeUndefined();
  });

  it("before its migration deploys (PGRST202) it summarises the rows as it did before the check", async () => {
    const fn = await loadConfigured();
    seedQueue();
    scenario.rpcErrors = { job_match_digest_rows: { message: "Could not find the function", code: "PGRST202" } };
    scenario.writeSelectRows["match_digest_queue:delete"] = [{ id: "q-1" }, { id: "q-2" }];

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect((scenario.writes.find((w) => w.table === "notifications")?.payload as unknown[]).length).toBe(1);
    expect(drainWrite()?.filters).toEqual([{ op: "in", column: "id", value: ["q-1", "q-2"] }]);
  });
});

// ─── proven able to fail, 2026-09-21 ───────────────────────────────────────
// Drop the ROW COUNT check and a DELETE that matched nothing reports 200 with
// defects: 0 — the same digest re-sent to the same person every day. Red:
//   × records a DEFECT and answers 500 when the drain removes nothing
//   × records a DEFECT on a PARTIAL drain, not just a total no-op
//   AssertionError: expected 200 to be 500
// @mutate supabase/functions/daily-match-digest/index.ts | if (removed < batch.length) { | if (false) {
// Q392: summarise every queued row whatever the gate answered, and a job hired
// since it was queued is announced again in the digest. Red:
//   × drains a row whose job left the user's feed WITHOUT summarising it, ...
// @mutate supabase/functions/daily-match-digest/index.ts | if (!row.jobs \|\| !sendable.has(row.id)) continue; | if (!row.jobs) continue;
