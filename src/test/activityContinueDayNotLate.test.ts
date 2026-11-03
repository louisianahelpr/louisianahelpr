/**
 * Owner bug 11-03: a job with an OPEN continue day (job_continue_days status 'set', closed_at null) is dated by that
 * day everywhere Activity decides "late". Before, Activity read only jobs.date_needed, so a job whose first day had
 * passed but which continues on Thursday showed "Late" / the overdue lines / the poster's no-show move.
 *
 * Held here:
 *   - fetchPostedActivity and fetchAppliedActivity swap in the continue day (jobOnContinueDay, the tracker's rule) for a
 *     job under way, so jobIsOverdue, derivePosterWait (jobStatusLine) and posterStepContract (isPastDue) see it;
 *   - the open days come IN the cores payload ('open_continue_days', 20261103231310), so Activity is ONE request; only
 *     an older database (no such key) or a failed cores read sends the direct read, with no job-id list, and both
 *     cores asked together share ONE such read;
 *   - only an open SET day counts (the query asks for status 'set' and closed_at null), and only a job in progress;
 *   - a refused read degrades to the first date (never throws the screen).
 */
// @mutate src/hooks/useActivityData.ts |     ...onContinueDay(j, continueDays), |     ...j,
// @mutate src/hooks/useActivityData.ts | job: job ? { ...onContinueDay(job, continueDays), ...appliedSeries.get(job.id) } | job: job ? { ...job, ...appliedSeries.get(job.id) }
// @mutate src/hooks/useActivityData.ts | ): J => (j.status === "in_progress" ? jobOnContinueDay(j, days[j.id]) : j); | ): J => jobOnContinueDay(j, days[j.id]);
// @mutate src/lib/continueDayReads.ts |           .is("closed_at", null), |           .not("job_id", "is", null),
// @mutate src/lib/continueDayReads.ts |           .eq("status", "set") |           .in("status", ["proposed", "set"])
// @mutate src/lib/continueDayReads.ts |   if (r?.userId === userId && !r.served.has(part) && | if (false &&
// @mutate src/lib/continueDayReads.ts |     if (r && typeof r.job_id === "string") out[r.job_id] = r; |     if (r && typeof r.job_id !== "string") out[r.job_id] = r;
// @mutate src/lib/continueDayReads.ts |   if (!Array.isArray(rows)) return null; |   if (!Array.isArray(rows)) return {};
// @mutate src/hooks/useActivityData.ts |   const continueDays = openContinueDaysFrom(cores?.open_continue_days) ?? await fetchMyOpenContinueDays(userId, "posted"); |   const continueDays = await fetchMyOpenContinueDays(userId, "posted");
// @mutate src/hooks/useActivityData.ts |   const continueDays = openContinueDaysFrom(cores?.open_continue_days) ?? await fetchMyOpenContinueDays(userId, "applied"); |   const continueDays = openContinueDaysFrom(cores?.open_continue_days) ?? {};
// @mutate supabase/migrations/20261103231310_activity_cores_carry_open_continue_days.sql |        WHERE d.status = 'set' AND d.closed_at IS NULL | WHERE d.status IN ('proposed', 'set')
// @mutate supabase/migrations/20261103231310_activity_cores_carry_open_continue_days.sql |          AND d.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid | AND d.job_id IN (SELECT j.id FROM public.jobs j
// @mutate supabase/migrations/20261103231310_activity_cores_carry_open_continue_days.sql |     'open_continue_days', ( |     'open_days', (
// @mutate supabase/migrations/20261103231310_activity_cores_carry_open_continue_days.sql |  STABLE SECURITY INVOKER\n SET search_path TO 'public' |  STABLE SECURITY DEFINER\n SET search_path TO 'public'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

type Resp = { data: unknown; error: unknown };
let issued: string[] = [];
let responses: Record<string, Resp> = {};
let coresGate: Promise<void> = Promise.resolve();

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const f: string[] = [];
    const b: Record<string, unknown> = {};
    const done = () => {
      const key = `${table}|${f.join(",")}`;
      issued.push(key);
      return Promise.resolve(responses[key] ?? responses[table] ?? { data: [], error: null });
    };
    b.select = () => (f.push("select"), b);
    b.eq = (c: string, v: unknown) => (f.push(`eq:${c}=${v}`), b);
    b.in = (c: string, v: unknown[]) => (f.push(`in:${c}=${v.join("&")}`), b);
    b.is = (c: string, v: unknown) => (f.push(`is:${c}=${v}`), b);
    b.not = (c: string, o: string, v: unknown) => (f.push(`not:${c}.${o}=${v}`), b);
    b.order = () => done();
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => done().then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      rpc: async (fn: string) => {
        issued.push(`rpc:${fn}`);
        if (fn === "get_my_activity_cores") await coresGate;
        return responses[`rpc:${fn}`] ?? { data: [], error: null };
      },
    },
  };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { fetchPostedActivity, fetchAppliedActivity } from "@/hooks/useActivityData";
import { forgetActivityCoresRead } from "@/lib/activityCores";
import { forgetMyOpenContinueDaysRead } from "@/lib/continueDayReads";
import { jobIsOverdue } from "@/components/job-card/activityFilters";
import { derivePosterWait } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";

const day = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(Date.now() + offset * 86_400_000));

const PASSED = day(-2);
const AHEAD = day(2);
const CONTINUE_KEY = "job_continue_days|select,eq:status=set,is:closed_at=null";
const continuing = (jobId: string) => ({ data: [{ job_id: jobId, status: "set", new_date: AHEAD, new_start_time: "09:00:00" }], error: null });

const job = (over: Partial<Job> = {}) =>
  ({
    id: "j1", customer_id: "u1", helper_id: "h1", status: "in_progress", date_needed: PASSED, start_time: "09:00",
    helper_confirmed_at: "2026-11-01T10:00:00Z", helper_on_the_way_at: "2026-11-01T10:00:00Z",
    helper_arrived_at: "2026-11-01T10:00:00Z", poster_confirmed_arrival_at: "2026-11-01T10:00:00Z", ...over,
  }) as unknown as Job;

/** A get_my_activity_cores payload (20261103231310 shape) with these posted jobs and open continue days. */
const cores = (posted: Job[], openDays: unknown[]) => ({
  posted_jobs: posted, poster_applications: [], offer_targets: [], my_applications: [], application_jobs: [],
  direct_offers: [], violations: [], reviews: [], open_continue_days: openDays,
});

beforeEach(() => {
  issued = [];
  responses = {};
  coresGate = Promise.resolve();
  forgetActivityCoresRead();
  forgetMyOpenContinueDaysRead();
});

describe("Activity dates a continuing job by its open continue day (owner bug 11-03)", () => {
  it("control: the same job with no continue day IS overdue (the test can fail)", async () => {
    responses["jobs"] = { data: [job()], error: null };
    const { postedJobs } = await fetchPostedActivity("u1");
    expect(postedJobs[0].date_needed).toBe(PASSED);
    expect(jobIsOverdue(postedJobs[0])).toBe(true);
    expect(derivePosterWait(postedJobs[0])).toBe("overdue_unfinished");
  });

  it("My Posts: an in-progress job past its first day with a SET day ahead is not Late", async () => {
    responses["jobs"] = { data: [job()], error: null };
    responses[CONTINUE_KEY] = continuing("j1");
    const { postedJobs } = await fetchPostedActivity("u1");
    expect(postedJobs[0].date_needed).toBe(AHEAD);
    expect(postedJobs[0].start_time).toBe("09:00");
    expect(jobIsOverdue(postedJobs[0])).toBe(false);
    expect(derivePosterWait(postedJobs[0])).not.toMatch(/^overdue/);
  });

  it("asks only for open SET days, with no id list (the party policy scopes it)", async () => {
    responses["jobs"] = { data: [job()], error: null };
    await fetchPostedActivity("u1");
    expect(issued).toContain(CONTINUE_KEY);
    expect(issued.some((k) => k.startsWith("job_continue_days") && k.includes("in:job_id"))).toBe(false);
  });

  it("ONE request: the cores payload carries the open days, so no continue-day read is sent", async () => {
    responses["rpc:get_my_activity_cores"] = { data: cores([job()], [{ job_id: "j1", status: "set", new_date: AHEAD, new_start_time: "09:00:00" }]), error: null };
    responses[CONTINUE_KEY] = { data: [], error: null };
    const { postedJobs } = await fetchPostedActivity("u1");
    expect(issued.filter((k) => !k.startsWith("rpc:get_job_series_state") && !k.startsWith("job_series"))).toEqual(["rpc:get_my_activity_cores"]);
    expect(postedJobs[0].date_needed).toBe(AHEAD);
    expect(jobIsOverdue(postedJobs[0])).toBe(false);
  });

  it("only a SET day in the payload counts; an empty list means none (no fallback read)", async () => {
    responses["rpc:get_my_activity_cores"] = { data: cores([job()], [{ job_id: "j1", status: "proposed", new_date: AHEAD, new_start_time: "10:00:00" }]), error: null };
    responses[CONTINUE_KEY] = continuing("j1");
    const { postedJobs } = await fetchPostedActivity("u1");
    expect(issued).not.toContain(CONTINUE_KEY);
    expect(postedJobs[0].date_needed).toBe(PASSED);
  });

  it("My Jobs (the Helpr) through the cores payload: not Late, one request", async () => {
    responses["rpc:get_my_activity_cores"] = {
      data: { ...cores([], [{ job_id: "j1", status: "set", new_date: AHEAD, new_start_time: "09:00:00" }]),
        my_applications: [{ id: "a1", job_id: "j1", helper_id: "u1", status: "accepted", created_at: "2026-11-01T00:00:00Z" }],
        application_jobs: [job({ helper_id: "u1" })] },
      error: null,
    };
    const { appliedApps } = await fetchAppliedActivity("u1");
    expect(issued).not.toContain(CONTINUE_KEY);
    expect(appliedApps[0].job?.date_needed).toBe(AHEAD);
  });

  it("both cores asked together send ONE continue-day read; a refetch reads again", async () => {
    responses["jobs"] = { data: [job()], error: null };
    await Promise.all([fetchPostedActivity("u1"), fetchAppliedActivity("u1")]);
    expect(issued.filter((k) => k === CONTINUE_KEY)).toHaveLength(1);
    await fetchPostedActivity("u1");
    expect(issued.filter((k) => k === CONTINUE_KEY)).toHaveLength(2);
  });

  it("a job not in progress keeps its own date (a completed job is never re-dated)", async () => {
    responses["jobs"] = { data: [job({ status: "completed" })], error: null };
    responses[CONTINUE_KEY] = continuing("j1");
    const { postedJobs } = await fetchPostedActivity("u1");
    expect(postedJobs[0].date_needed).toBe(PASSED);
  });

  it("a refused continue-day read degrades to the first date and does not throw", async () => {
    responses["jobs"] = { data: [job()], error: null };
    responses[CONTINUE_KEY] = { data: null, error: { code: "42501", message: "denied" } };
    const { postedJobs } = await fetchPostedActivity("u1");
    expect(postedJobs[0].date_needed).toBe(PASSED);
  });

  it("My Jobs (the Helpr): the same job through their application is not Late", async () => {
    responses["applications"] = { data: [{ id: "a1", job_id: "j1", helper_id: "u1", status: "accepted", created_at: "2026-11-01T00:00:00Z" }], error: null };
    responses["rpc:get_jobs_for_my_applications"] = { data: [job({ helper_id: "u1" })], error: null };
    responses[CONTINUE_KEY] = continuing("j1");
    const { appliedApps } = await fetchAppliedActivity("u1");
    expect(appliedApps[0].job?.date_needed).toBe(AHEAD);
    expect(jobIsOverdue(appliedApps[0].job!)).toBe(false);
  });
});

describe("get_my_activity_cores carries the open continue days (20261103231310: Activity is ONE request)", () => {
  const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
  const body = blankSqlComments(defs.get("get_my_activity_cores")?.stmt ?? "");

  it("reads every function's newest definition (inventory floor)", () => {
    expect(defs.size).toBeGreaterThan(1000);
    expect(body.length).toBeGreaterThan(500);
  });

  it("the newest definition returns open_continue_days: open SET days of my posted or applied jobs, as the caller", () => {
    expect(body).toMatch(/'open_continue_days',/);
    expect(body).toMatch(/FROM public\.job_continue_days d\s+WHERE d\.status = 'set' AND d\.closed_at IS NULL/);
    expect(body).toMatch(/d\.job_id IN \(SELECT j\.id FROM public\.jobs j WHERE j\.customer_id = v_uid\s+UNION SELECT a\.job_id FROM public\.applications a WHERE a\.helper_id = v_uid\)/);
    expect(body).toMatch(/STABLE SECURITY INVOKER/);
  });
});
