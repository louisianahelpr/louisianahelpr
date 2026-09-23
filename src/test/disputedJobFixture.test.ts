/**
 * Q132 (docs/OPEN.md): prod-audit run 35844514386 skipped `explore:
 * disputedJob-poster` and `-helper` — "no seeded disputedJob between the two
 * accounts". The prod-audit now owns that fixture (ensureDisputedJob in
 * e2e/prod-audit/fundedOpenJob.ts): fund -> apply -> hire -> rpc_open_dispute,
 * each the app's own path. This pins the pure plan (reuse a disputed one,
 * RESUME a half-made one without paying twice, create only when there is
 * nothing) and the wiring (messy-input builds it before resolveFixtures reads
 * the fixtures, whenever the disputed explores are in scope).
 *
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | if (disputed) return { kind: "reuse", row: disputed }; | if (disputed && false) return { kind: "reuse", row: disputed };
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | if (hired) return { kind: "resume", row: hired, next: "dispute" }; | if (hired) return { kind: "create" };
 * @mutate e2e/prod-audit/messy-input.spec.ts | const disputed = await ensureDisputedJob(request, browser, sessions.get("poster")!, sessions.get("helper")!); | const disputed = { log: [] as string[] };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { DISPUTE_FIXTURE_TITLE, FUNDED_FIXTURE_TITLE, planDisputedJob, type DisputeRow } from "../../e2e/prod-audit/fundedOpenJobPlan";

const HELPER = "helper-e2e-id";
let n = 0;
const row = (over: Partial<DisputeRow> = {}): DisputeRow => ({
  id: `job-${++n}`,
  title: `${DISPUTE_FIXTURE_TITLE}: patch a drywall hole`,
  status: "open",
  payment_status: "unpaid",
  helper_id: null,
  created_at: `2020-01-${String(1 + (n % 20)).padStart(2, "0")}T00:00:00Z`,
  ...over,
});
const plan = (rows: DisputeRow[], applied: string[] = []) => planDisputedJob(rows, { helperId: HELPER, appliedJobIds: new Set(applied) });

describe("planDisputedJob", () => {
  it("creates one only when poster-e2e has no dispute fixture at all", () => {
    expect(plan([])).toEqual({ kind: "create" });
  });
  it("REUSES a disputed fixture with helper-e2e (no new payment, idempotent)", () => {
    const d = row({ status: "disputed", payment_status: "escrow", helper_id: HELPER });
    expect(plan([row(), d])).toEqual({ kind: "reuse", row: d });
    expect(plan([row(), d])).toEqual(plan([row(), d]));
  });
  it("RESUMES a half-made fixture at the step it stopped on, never paying twice", () => {
    const hired = row({ status: "accepted", payment_status: "escrow", helper_id: HELPER });
    expect(plan([hired])).toEqual({ kind: "resume", row: hired, next: "dispute" });
    const funded = row({ status: "open", payment_status: "escrow" });
    expect(plan([funded])).toEqual({ kind: "resume", row: funded, next: "apply" });
    expect(plan([funded], [funded.id])).toEqual({ kind: "resume", row: funded, next: "hire" });
    const unpaid = row({ status: "open", payment_status: "abandoned" });
    expect(plan([unpaid])).toEqual({ kind: "resume", row: unpaid, next: "fund" });
  });
  it("ignores other jobs: the funded OPEN fixture, and a dispute with someone else", () => {
    expect(plan([{ ...row({ status: "open", payment_status: "escrow" }), title: `${FUNDED_FIXTURE_TITLE}: hang two shelves` }])).toEqual({ kind: "create" });
    expect(plan([row({ status: "disputed", payment_status: "escrow", helper_id: "someone-else" })])).toEqual({ kind: "create" });
  });
});

describe("messy-input builds the dispute fixture before reading fixtures", () => {
  const spec = blankComments(readFileSync(resolve(__dirname, "../../e2e/prod-audit/messy-input.spec.ts"), "utf8"));
  it("ensureDisputedJob runs in beforeAll, before resolveFixtures, when the disputed explores are in scope", () => {
    const ensure = spec.indexOf("await ensureDisputedJob(request, browser,");
    const resolveAt = spec.indexOf("fx = await resolveFixtures(");
    expect(ensure).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(ensure);
    expect(spec).toContain('["explore: disputedJob-poster", "explore: disputedJob-helper"]');
  });
  it("the explores it feeds are still generated (floor)", () => {
    expect(spec).toContain('["disputedJob", "poster"]');
    expect(spec).toContain('["disputedJob", "helper"]');
  });
});
