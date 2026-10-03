/**
 * `prod-seed.mjs --verify` cannot seed a "money state" — a job/payment status
 * or money-ledger row (payout_transfers, tips) that only a REAL, completed
 * Stripe payment produces — because Stripe is LIVE on prod pre-launch and the
 * standing rule is never to complete a live payment just to seed test data.
 *
 * Owner decision 2026-10-02 (pop-up): `--verify` measured 27/55 states
 * present, 28 missing in that run. Accept the money states as unseedable
 * before launch; `--verify` must mark a MISSING money state
 * "expected-unseeded" (still a pass), while any OTHER missing state still
 * fails. Owner decision 2026-10-02 (seed money states stay unseeded before launch).
 *
 * The exact money-state count in code, read from prod-seed.mjs's own
 * `check(state, q, min, source)` calls tagged `source: "real flow"`, is 17
 * (6 job-status + 9 payment-status + payout_transfers + tips) — NOT 28. The
 * owner's "28" was a point-in-time count of every failing row in one live
 * run (which can include other fixtures not yet applied at that moment, not
 * only money states); 28 is not reproduced here because inventing a second,
 * unverifiable number would contradict CLAUDE.md's "never guess."
 *
 * This guard proves three things about `scripts/lib/moneyStateExpectations.mjs`
 * (the pure classifier `prod-seed.mjs --verify` now calls, extracted because
 * prod-seed.mjs's own top-level `MODE` guard exits the process if imported
 * outside a --mode CLI invocation):
 *   1. a missing money state ("real flow") is `ok: true, expectedUnseeded: true`
 *   2. a missing non-money state is still `ok: false, expectedUnseeded: false`
 *   3. a PRESENT money state is `ok: true, expectedUnseeded: false` (no
 *      false-positive "unseeded" marking on a row that is actually there)
 * plus an inventory floor on prod-seed.mjs's own source: exactly 17 "real
 * flow" rows today, and a check that `verify()`'s `check()` closure actually
 * calls `classifyVerifyRow` (so a revert back to inline `ok: !err && n >= min`
 * is caught).
 *
 * @mutate scripts/lib/moneyStateExpectations.mjs | const expectedUnseeded = !err && !passed && source === MONEY_STATE_SOURCE; | const expectedUnseeded = false;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyVerifyRow, MONEY_STATE_SOURCE } from "../../scripts/lib/moneyStateExpectations.mjs";

const repoRoot = resolve(__dirname, "../..");
const seedSrc = readFileSync(resolve(repoRoot, "scripts/audit/prod-seed.mjs"), "utf8");

describe("prod-seed --verify marks missing money states expected-unseeded, not failed", () => {
  it("tags the real-flow source string prod-seed.mjs actually uses", () => {
    expect(MONEY_STATE_SOURCE).toBe("real flow");
    expect(seedSrc).toContain('"real flow"');
  });

  it("a MISSING money state (real flow) still passes, marked expected-unseeded", () => {
    const row = classifyVerifyRow({ n: 0, min: 1, err: "", source: "real flow" });
    expect(row).toEqual({ ok: true, expectedUnseeded: true });
  });

  it("a MISSING non-money state (prod-seed) still fails — only money states get the pass", () => {
    const row = classifyVerifyRow({ n: 0, min: 1, err: "", source: "prod-seed" });
    expect(row).toEqual({ ok: false, expectedUnseeded: false });
  });

  it("a PRESENT money state passes WITHOUT the expected-unseeded marker (not a false positive)", () => {
    const row = classifyVerifyRow({ n: 3, min: 1, err: "", source: "real flow" });
    expect(row).toEqual({ ok: true, expectedUnseeded: false });
  });

  it("a query error still fails even for a money-state source (an error is not 'unseeded', it's broken)", () => {
    const row = classifyVerifyRow({ n: 0, min: 1, err: "PGRST001 boom", source: "real flow" });
    expect(row).toEqual({ ok: false, expectedUnseeded: false });
  });

  it("prod-seed.mjs's verify() actually wires classifyVerifyRow into its check() closure", () => {
    expect(seedSrc).toMatch(/import\s*\{\s*classifyVerifyRow\s*\}\s*from\s*["']\.\.\/lib\/moneyStateExpectations\.mjs["']/);
    expect(seedSrc).toMatch(/classifyVerifyRow\(\{\s*n,\s*min,\s*err,\s*source\s*\}\)/);
  });

  it("has exactly 17 'real flow'-tagged check() rows in prod-seed.mjs today — an exact floor, not a guess", () => {
    // The job-status loop: `for (const s of [...]) { await check(..., s === "open" || s === "pending_approval" ? "prod-seed" : "real flow"); }`
    // — every status EXCEPT the ones named in that ternary's condition is "real flow".
    const jobLoop = /for \(const s of \[([^\]]+)\]\) \{\s*await check\(`job status \$\{s\}`[^;]*?s\s*===\s*"([a-z_]+)"\s*\|\|\s*s\s*===\s*"([a-z_]+)"\s*\?\s*"prod-seed"\s*:\s*"real flow"/.exec(
      seedSrc,
    );
    const jobStates = [...(jobLoop?.[1].matchAll(/"([a-z_]+)"/g) ?? [])].map((m) => m[1]);
    const jobProdSeedStates = jobLoop ? [jobLoop[2], jobLoop[3]] : [];
    expect(jobStates.length).toBeGreaterThan(0);
    const jobRealFlow = jobStates.filter((s) => !jobProdSeedStates.includes(s)).length;

    // The payment-status loop: same shape, `s === "unpaid" ? "prod-seed" : "real flow"`.
    const paymentLoop = /for \(const s of \[([^\]]+)\]\) \{\s*await check\(`payment \$\{s\}`[^;]*?s\s*===\s*"([a-z_]+)"\s*\?\s*"prod-seed"\s*:\s*"real flow"/.exec(
      seedSrc,
    );
    const paymentStates = [...(paymentLoop?.[1].matchAll(/"([a-z_]+)"/g) ?? [])].map((m) => m[1]);
    const paymentProdSeedStates = paymentLoop ? [paymentLoop[2]] : [];
    expect(paymentStates.length).toBeGreaterThan(0);
    const paymentRealFlow = paymentStates.filter((s) => !paymentProdSeedStates.includes(s)).length;

    // The two standalone money-ledger checks, each a single call site.
    const standaloneRealFlow = [...seedSrc.matchAll(/await check\("(payout_transfers|tips) \(helper\)"[^;]*"real flow"\)/g)].length;

    // Direct, source-grounded floor as of 2026-10-02: 6 job-status + 9 payment-status + 2
    // standalone (payout_transfers, tips) = 17. If this ever moves, update
    // this number in the SAME commit (CLAUDE.md: every floor stays exact).
    expect(standaloneRealFlow).toBe(2);
    expect(jobRealFlow + paymentRealFlow + standaloneRealFlow).toBe(17);
  });
});
