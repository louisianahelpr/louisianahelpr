/**
 * The seed must not leave a fake emergency on prod.
 *
 * Dispute c7a12050 (job bb2c3732, is_seed) has been `status='decided'`,
 * `execution_status='pending'` since 2026-09-07: a split somebody decided and
 * nothing ever executed. `auto-resolve-disputes` sweeps for that shape and
 * reminded every admin about it daily, and every run 500'd, until 20260914183932
 * taught it to skip is_seed jobs. Skipping is right; manufacturing the row is
 * not. `prod-seed.mjs --apply` now retires any stuck seed split, `--verify`
 * fails while one exists.
 *
 * The retirement UN-DECIDES. It never writes execution_status='executed': no
 * transfer or refund id exists on these rows, so no money moved, and faking a
 * settlement would be read as real by money-reconciliation.
 *
 * RED before the fix: `prod-seed.mjs` contained no reference to
 * STUCK_SEED_SPLIT_QUERY, and the module under test did not exist — the last
 * two cases here fail against origin/main's copy of the script
 * (SEED_SCRIPT_PATH points at it).
 *
 * Shown able to fail 2026-09-20 on both halves of what it owns — the safety
 * predicate, and the script that uses it:
 *   * dropping the money guard from `isStuckSeedSplit` (a row with a transfer
 *     id, refund id or settlement time becomes retirable) turns "never touches
 *     a real dispute, or one where money moved" red;
 *   * deleting apply()'s `await retireStuckSeedSplits();` turns "--apply
 *     retires them" red. That second one used to SURVIVE — see the comment on
 *     that case.
 *
 * @mutate scripts/audit/seedDisputeFixture.mjs |   if (d.execution_transfer_id || d.execution_refund_id || d.executed_at) return false;\n |
 * @mutate scripts/audit/prod-seed.mjs |   await retireStuckSeedSplits();\n |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STUCK_EXECUTION_STATUSES,
  STUCK_SEED_SPLIT_QUERY,
  isStuckSeedSplit,
  retireStuckSplitPatch,
  stuckSplitCasFilter,
  // @ts-expect-error - plain .mjs tool script, no types
} from "../../scripts/audit/seedDisputeFixture.mjs";

const SEED_SCRIPT = process.env.SEED_SCRIPT_PATH ?? join(process.cwd(), "scripts", "audit", "prod-seed.mjs");

/** The real row, read from prod 2026-09-14. */
const c7a12050 = {
  id: "c7a12050-1542-40f0-99b6-189c47a13bd8",
  job_id: "bb2c3732-476a-4f66-aae6-372cbdfcfdf6",
  status: "decided",
  execution_status: "pending",
  execution_transfer_id: null,
  execution_refund_id: null,
  executed_at: null,
  execution_helper_cents: null,
  execution_refund_cents: null,
  decision_text: "Helpr attended and waited 40 minutes; poster's lockbox code was wrong.",
  jobs: { is_seed: true },
};

describe("seed dispute fixture", () => {
  it("recognises the stuck seed split that has been on prod since 2026-09-07", () => {
    expect(isStuckSeedSplit(c7a12050)).toBe(true);
    expect(isStuckSeedSplit({ ...c7a12050, execution_status: "executing" })).toBe(true);
  });

  /**
   * The predicate must match the sweeper it exists to silence, or --verify says
   * "clean" while auto-resolve-disputes still counts the row. The sweeper reads
   * `.in("execution_status", ["pending","executing","failed"])` and does NOT
   * filter on `status`, and its own comment says nothing writes 'pending'
   * today — so 'failed' is the state that actually occurs.
   *
   * RED before the fix: the predicate required status === 'decided' and
   * excluded 'failed', so both assertions below returned false.
   */
  it("matches every execution state auto-resolve-disputes calls stuck", () => {
    const sweeper = readFileSync(
      join(process.cwd(), "supabase", "functions", "auto-resolve-disputes", "index.ts"), "utf8");
    const inClause = /\.in\("execution_status",\s*\[([^\]]*)\]\)/.exec(sweeper)?.[1] ?? "";
    const sweeperStates = [...inClause.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    expect(sweeperStates.length).toBeGreaterThan(0);
    expect([...STUCK_EXECUTION_STATUSES].sort()).toEqual(sweeperStates);
    // The two the old predicate missed.
    expect(isStuckSeedSplit({ ...c7a12050, execution_status: "failed" })).toBe(true);
    expect(isStuckSeedSplit({ ...c7a12050, status: "open", execution_status: "failed" })).toBe(true);
  });

  /**
   * The PATCH filter carries the whole predicate, not the id alone, so a row
   * `execute-dispute-split` claims between the read and the write matches zero
   * rows instead of being overwritten mid-Stripe-call. Seed jobs carry real
   * Stripe test-mode money, and 'executing' IS that window.
   *
   * RED before the fix: the filter was `disputes?id=eq.X&select=id`.
   */
  it("the write is a compare-and-swap, not an unconditional id match", () => {
    const f = stuckSplitCasFilter(c7a12050.id);
    expect(f).toContain(`id=eq.${c7a12050.id}`);
    expect(f).toContain("execution_status=in.(pending,executing,failed)");
    expect(f).toContain("execution_transfer_id=is.null");
    expect(f).toContain("execution_refund_id=is.null");
    expect(f).toContain("executed_at=is.null");
    expect(f).toContain("select=id");
  });

  it("never touches a real dispute, or one where money moved", () => {
    expect(isStuckSeedSplit({ ...c7a12050, jobs: { is_seed: false } })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, jobs: null })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, execution_transfer_id: "tr_123" })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, execution_refund_id: "re_123" })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, executed_at: "2026-09-08T00:00:00Z" })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, execution_helper_cents: 2500 })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, status: "open", execution_status: null })).toBe(false);
    expect(isStuckSeedSplit({ ...c7a12050, execution_status: "executed" })).toBe(false);
    expect(isStuckSeedSplit(null)).toBe(false);
  });

  it("un-decides instead of faking a settlement", () => {
    const patch = retireStuckSplitPatch(c7a12050);
    expect(patch.status).toBe("withdrawn");
    expect(patch.execution_status).toBeNull();
    // No key of the patch claims a settlement, and none carries a Stripe id.
    expect(Object.values(patch)).not.toContain("executed");
    expect(Object.keys(patch)).not.toContain("execution_transfer_id");
    expect(Object.keys(patch)).not.toContain("execution_refund_id");
    expect(Object.keys(patch)).not.toContain("executed_at");
    expect(Object.keys(patch)).not.toContain("execution_helper_cents");
    expect(patch.decision_text).toContain(c7a12050.decision_text);
    expect(patch.decision_text).toMatch(/^SEED fixture retired/);
    // Idempotent: --apply is run over and over.
    expect(retireStuckSplitPatch({ ...c7a12050, decision_text: patch.decision_text }).decision_text)
      .toBe(patch.decision_text);
  });

  it("refuses to patch anything the predicate rejects", () => {
    expect(() => retireStuckSplitPatch({ ...c7a12050, jobs: { is_seed: false } })).toThrow(/not a stuck seed split/);
  });

  it("the query itself is fenced to seed jobs with no execution", () => {
    expect(STUCK_SEED_SPLIT_QUERY).toContain("jobs.is_seed=eq.true");
    expect(STUCK_SEED_SPLIT_QUERY).toContain("jobs!inner(is_seed)");
    expect(STUCK_SEED_SPLIT_QUERY).toContain("execution_transfer_id=is.null");
    expect(STUCK_SEED_SPLIT_QUERY).toContain("execution_refund_id=is.null");
  });

  /**
   * SHOWN VACUOUS 2026-09-20, and fixed here. This case used to read
   * `expect(src).toContain("retireStuckSeedSplits()")` — which the DEFINITION
   * line `async function retireStuckSeedSplits() {` satisfies all by itself.
   * Deleting `await retireStuckSeedSplits();` from `apply()`, so --apply
   * retires nothing and the whole retirement is dead code, left this guard
   * GREEN. Same shape as the money bucket's comment-satisfiable text pins.
   * The call is now looked for inside `apply()`'s own body, comments stripped.
   */
  it("--apply retires them and --verify fails while one exists", () => {
    const raw = readFileSync(SEED_SCRIPT, "utf8");
    // `[^:]` before `//` so a `https://` inside a string is not mistaken for a
    // line comment.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const start = src.indexOf("async function apply()");
    expect(start, "prod-seed.mjs has no `async function apply()` — did it get renamed?").toBeGreaterThan(-1);
    const end = src.indexOf("\n}\n", start);
    expect(end, "could not find the end of apply()").toBeGreaterThan(start);
    expect(src.slice(start, end), "apply() does not call retireStuckSeedSplits() — --apply retires nothing")
      .toContain("await retireStuckSeedSplits();");
    expect(src).toContain("STUCK_SEED_SPLIT_QUERY");
    expect(src).toMatch(/seed disputes stuck mid-execution[\s\S]{0,200}min:\s*0/);
  });

  /**
   * PostgREST answers `200 []` when a filter matches nothing, so the PATCH
   * cannot report a zero-row write through its error alone — the project's own
   * "a null error is not a write" rule. RED before the fix: the response was
   * discarded and the success line printed unconditionally.
   */
  it("the retirement checks the row count instead of trusting a null error", () => {
    const src = readFileSync(SEED_SCRIPT, "utf8");
    expect(src).toContain("stuckSplitCasFilter(d.id)");
    expect(src).toMatch(/out\.length !== 1/);
    // The success line is inside the guarded branch, not before it.
    const fn = src.slice(src.indexOf("async function retireStuckSeedSplits"));
    expect(fn.indexOf("out.length !== 1")).toBeLessThan(fn.indexOf("retired stuck seed dispute split"));
  });
});
