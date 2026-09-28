/**
 * nightly-red #1794 (a11y-webkit-prod run 36148473443, 2026-09-25): both sweep
 * legs failed on an unjustified skip, "no is_seed job in status "accepted"
 * owned by the poster on prod — job detail for this status is NOT swept".
 * Nothing owned that state: the sweep borrowed whatever accepted row another
 * run had left, and the product always moves an accepted job on
 * (auto-expire-jobs re-opens an unconfirmed hire at its deadline).
 *
 * The fix gives it an owner: ensureAcceptedJob (e2e/prod-audit/fundedOpenJob.ts,
 * rules in planAcceptedJob), run by e2e/job-status-fixtures/accepted.spec.ts in
 * a11y-webkit-prod.yml's `fixtures` job before both sweep legs. This pins:
 *   1. the plan (reuse an accepted fixture with runway; never touch a hired
 *      one with too little; retire a re-opened one; resume, never re-pay);
 *   2. the wiring (the job runs the project, the sweep waits for it, the
 *      nightly issue counts it);
 *   3. the CLASS: every job_status the sweep renders is either OWNED by
 *      something that keeps it alive, or listed in BORROWED (exact, two-way),
 *      so a new status, or an owner that disappears, fails here instead of as
 *      a skip on the next nightly.
 *
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | if (accepted) return { kind: "reuse", row: accepted, retire }; | if (accepted && false) return { kind: "reuse", row: accepted, retire };
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | r.status === "accepted" && r.helper_id === opts.helperId && r.payment_status === "escrow" && runway(r) >= MIN_RUNWAY_DAYS, | r.status === "accepted" && r.helper_id === opts.helperId && r.payment_status === "escrow",
 * @mutate .github/workflows/a11y-webkit-prod.yml | needs: [preflight, fixtures] | needs: preflight
 * @mutate .github/workflows/a11y-webkit-prod.yml | run: npx playwright test --project=job-status-fixtures | run: echo skipped
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | const open = openAll.filter((r) => !isDeadFor(opts.applications, r.id)); | const open = openAll;
 * @mutate e2e/prod-audit/fundedOpenJob.ts |   await helperConfirmsOffer(api, helper, id, log); |   // confirm removed
 * @mutate e2e/prod-audit/fundedOpenJob.ts | data: { helper_confirmed_at: now, response_deadline: null } | data: { response_deadline: null }
 * @mutate e2e/job-status-fixtures/accepted.spec.ts | await ensureAcceptedJob(request, browser, poster, helper); | { job: { id: "", title: "", date_needed: "2999-01-01" }, log: [] as string[] };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  ACCEPTED_FIXTURE_TITLE,
  DISPUTE_FIXTURE_TITLE,
  MIN_RUNWAY_DAYS,
  planAcceptedJob,
  type FixtureRow,
} from "../../e2e/prod-audit/fundedOpenJobPlan";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const TODAY = "2026-09-26";
const HELPER = "helper-e2e-id";
const dayPlus = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
let n = 0;
const row = (over: Partial<FixtureRow> = {}): FixtureRow => ({
  id: `job-${++n}`,
  title: `${ACCEPTED_FIXTURE_TITLE}: fix a sticking screen door`,
  status: "open",
  payment_status: "unpaid",
  helper_id: null,
  date_needed: dayPlus(30),
  created_at: `2026-09-${String(1 + (n % 20)).padStart(2, "0")}T00:00:00Z`,
  ...over,
});
const plan = (rows: FixtureRow[], apps: Record<string, string> = {}) =>
  planAcceptedJob(rows, { today: TODAY, helperId: HELPER, applications: new Map(Object.entries(apps)) });
const hired = (over: Partial<FixtureRow> = {}) => row({ status: "accepted", payment_status: "escrow", helper_id: HELPER, ...over });

describe("planAcceptedJob", () => {
  it("creates one only when poster-e2e has no usable accepted fixture", () => {
    expect(plan([])).toEqual({ kind: "create", retire: [] });
  });

  it("REUSES an accepted, escrowed fixture hired to helper-e2e with runway (no new payment, idempotent)", () => {
    const a = hired();
    expect(plan([row({ status: "cancelled" }), a])).toEqual({ kind: "reuse", row: a, retire: [] });
    expect(plan([a])).toEqual(plan([a]));
    const edge = hired({ date_needed: dayPlus(MIN_RUNWAY_DAYS) });
    expect(plan([edge]).kind).toBe("reuse");
  });

  it("does NOT reuse a hired fixture auto-expire-jobs is about to re-open, and never retires a hired one", () => {
    const short = hired({ date_needed: dayPlus(MIN_RUNWAY_DAYS - 1) });
    const p = plan([short]);
    expect(p.kind).toBe("create");
    // cancel_escrow refuses a hired job; the plan must not ask for it.
    expect(p.retire).toEqual([]);
  });

  it("RETIRES a funded fixture that is open again with short runway (re-opened by auto-expire-jobs)", () => {
    const reopened = row({ payment_status: "escrow", date_needed: dayPlus(1) });
    const good = hired();
    const p = plan([reopened, good]);
    expect(p.kind).toBe("reuse");
    expect(p.retire.map((r) => r.row.id)).toEqual([reopened.id]);
    // An unpaid short one holds no money: nothing to release.
    expect(plan([row({ date_needed: dayPlus(1) })]).retire).toEqual([]);
  });

  it("RESUMES a half-made fixture at the step it stopped on, never paying twice", () => {
    const funded = row({ payment_status: "escrow" });
    expect(plan([funded])).toEqual({ kind: "resume", row: funded, next: "apply", retire: [] });
    expect(plan([funded], { [funded.id]: "pending" })).toEqual({ kind: "resume", row: funded, next: "hire", retire: [] });
    const unpaid = row({ payment_status: "abandoned" });
    expect(plan([unpaid])).toEqual({ kind: "resume", row: unpaid, next: "fund", retire: [] });
  });

  // a11y-webkit-prod run 36352716213 (#1794): job 36eebad4 was open/escrow and
  // helper-e2e's application on it was REJECTED (expire_unanswered_offers); the
  // plan said "apply" and apply_to_job answered "Already applied to this job".
  it.each(["rejected", "withdrawn"])(
    "a funded fixture helper-e2e has a %s application on is never resumed: it is RETIRED (escrow released)",
    (status) => {
      const dead = row({ payment_status: "escrow" });
      const p = plan([dead], { [dead.id]: status });
      expect(p.kind).toBe("create");
      expect(p.retire.map((r) => r.row.id)).toEqual([dead.id]);
      // An unpaid one with a closed application is not funded either.
      const deadUnpaid = row({ payment_status: "abandoned" });
      expect(plan([deadUnpaid], { [deadUnpaid.id]: status })).toEqual({ kind: "create", retire: [] });
    },
  );

  it("ignores other jobs: another fixture's title, a hire to someone else, an unfunded hire", () => {
    expect(plan([{ ...hired(), title: `${DISPUTE_FIXTURE_TITLE}: patch a drywall hole` }]).kind).toBe("create");
    expect(plan([hired({ helper_id: "someone-else" })]).kind).toBe("create");
    expect(plan([hired({ payment_status: "unpaid" })]).kind).toBe("create");
  });
});

describe("a11y-webkit-prod.yml mints the fixture before the sweep reads it", () => {
  const wf = read(".github/workflows/a11y-webkit-prod.yml")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const job = (name: string) => {
    const m = new RegExp(`^ {2}${name}:\\s*$([\\s\\S]*?)(?=^ {2}[A-Za-z0-9_-]+:\\s*$|(?![\\s\\S]))`, "m").exec(wf);
    return m?.[1] ?? "";
  };

  it("a `fixtures` job runs the job-status-fixtures project", () => {
    expect(job("fixtures")).toMatch(/run: npx playwright test --project=job-status-fixtures\b/);
  });
  it("both sweep legs wait for it", () => {
    expect(job("sweep")).toMatch(/needs: \[preflight, fixtures\]/);
  });
  it("the nightly issue counts it: a red fixtures job is a red run", () => {
    expect(job("notify")).toMatch(/needs\.fixtures\.result == 'success'/);
  });
  // prod-audit run 36361548155 (#1754): the fixture was hired and left
  // UNconfirmed; expire_unanswered_offers swept it at its response_deadline and
  // filed job_denial dd89291c on helper-e2e (fix a78d95be2). The confirm must
  // run on EVERY path (reuse included) and prove itself by reading the row.
  it("helper-e2e confirms the offer on every path, and the confirm proves itself", () => {
    const src = blankComments(read("e2e/prod-audit/fundedOpenJob.ts"));
    const ensure = /export async function ensureAcceptedJob\([\s\S]*?\n}/.exec(src)?.[0] ?? "";
    expect(ensure, "ensureAcceptedJob is gone").toContain("planAcceptedJob(");
    expect(ensure, "the confirm must sit at function level, after the reuse/drive branch, not inside one branch").toMatch(
      /\n {2}}\n[\s\S]*?\n {2}await helperConfirmsOffer\(api, helper, id, log\);/,
    );
    const confirm = /async function helperConfirmsOffer\([\s\S]*?\n}/.exec(src)?.[0] ?? "";
    expect(confirm).toContain("helper_confirmed_at: now");
    expect(confirm).toMatch(/if \(!confirmed\[0\]\?\.helper_confirmed_at\) \{\s*throw new Error/);
  });
  it("the project is the fixture spec's own, and the spec calls the owner", () => {
    const cfg = read("playwright.config.ts");
    expect(cfg).toMatch(/name: "job-status-fixtures",[\s\S]*?testDir: "\.\/e2e\/job-status-fixtures"/);
    const spec = blankComments(read("e2e/job-status-fixtures/accepted.spec.ts"));
    expect(spec).toContain("await ensureAcceptedJob(request, browser, poster, helper);");
    expect(spec).not.toMatch(/test\.skip\s*\(/);
  });
});

/**
 * THE CLASS. Each status e2e/a11y-prod/a11y-prod.spec.ts sweeps, and what keeps
 * a row of it alive for poster-e2e. `evidence` must be present (comments
 * blanked) in `file`, so an owner that is deleted fails here.
 */
const OWNED: Record<string, { file: string; evidence: string; why: string }> = {
  open: { file: "scripts/audit/prod-seed.mjs", evidence: 'id: sid("job:poster-open")', why: "prod-seed --apply upserts it (prod-audit.yml, before every audit)" },
  pending_approval: { file: "scripts/audit/prod-seed.mjs", evidence: 'id: sid("job:poster-pending-approval")', why: "prod-seed --apply upserts it" },
  accepted: { file: "e2e/job-status-fixtures/accepted.spec.ts", evidence: "await ensureAcceptedJob(", why: "a11y-webkit-prod.yml's fixtures job, before the sweep (#1794)" },
  disputed: { file: "e2e/prod-audit/messy-input.spec.ts", evidence: "await ensureDisputedJob(", why: "prod-audit's messy-input beforeAll (Q132); a seed dispute is never auto-resolved" },
};

/**
 * Statuses the sweep still BORROWS from whatever real-flow run (prod-lifecycle,
 * journeys) left one behind for poster-e2e. They were all present in run
 * 36148473443; nothing guarantees they stay. Exact and two-way: give one an
 * owner and it must leave this list. docs/OPEN.md tracks the gap.
 */
const BORROWED = ["cancelled", "completed", "in_progress", "revision_requested"];

describe("every job_status the prod a11y sweep renders has an owner, or is listed as borrowed", () => {
  const spec = blankComments(read("e2e/a11y-prod/a11y-prod.spec.ts"));
  const block = /const JOB_STATUSES = \[([\s\S]*?)\] as const;/.exec(spec)?.[1] ?? "";
  const statuses = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  it("reads the sweep's status list (floor)", () => {
    expect(statuses.length).toBeGreaterThan(6);
    expect(statuses).toContain("accepted");
  });

  it("each status is OWNED or BORROWED, never neither, never both", () => {
    const unaccounted = statuses.filter((s) => !(s in OWNED) && !BORROWED.includes(s));
    expect(unaccounted, "a status the sweep renders that nothing keeps alive: give it an owner").toEqual([]);
    expect(BORROWED.filter((s) => s in OWNED), "owned now: drop it from BORROWED").toEqual([]);
    expect([...Object.keys(OWNED), ...BORROWED].filter((s) => !statuses.includes(s)), "stale entry: the sweep no longer renders it").toEqual([]);
  });

  it.each(Object.entries(OWNED))("%s: its owner is still there", (_status, o) => {
    const code = blankComments(read(o.file));
    expect(code, `${o.file} no longer contains ${o.evidence} (${o.why})`).toContain(o.evidence);
  });
});
