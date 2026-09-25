/*
 * CLASS GUARD: every CI sweep holds BOTH test seats, so a hired+funded
 * leftover is settled forward instead of deferred forever — and never while a
 * live run could still be driving it.
 *
 * nightly-red #1719 (e2e-journeys run 36164148002, 2026-09-25): the sweeper
 * warned that 7 test-owned jobs had sat in escrow past 48h (10 hired+funded in
 * all). `prod-lifecycle-sweeper.mjs` has settled such rows forward whenever it
 * holds HELPER_ACCESS_TOKEN since 2026-09-22, but not one of the ten workflow
 * steps that ran it passed that token, so the branch never ran in CI and the
 * pile the 2026-09-22 cleanup cleared came straight back.
 *
 * Inventory from source: every step in .github/workflows that runs the sweeper.
 *   1. It runs it through scripts/e2e/sweep-both-seats.sh (never `node` directly),
 *      and passes the helper seat's secrets to that step.
 *   2. sweep-both-seats.sh hands the helper token to the sweeper.
 *   3. The sweeper walks a row only when it is older than the longest
 *      `timeout-minutes` of any CI job holding the helper seat, so it cannot
 *      settle a job a live run is still driving.
 *
 * lh-money-escrow review of this fix (2026-09-25):
 *   M1 each sweep step names its phase (SWEEP_PHASE: pre, or teardown for the
 *      `if: always()` unwind) so a teardown fails when it cannot hold the
 *      helper seat (behaviour: src/test/sweeperFailsClosed.test.ts); each passes
 *      E2E_STRIPE_MODE from the repo variable (L2).
 *   M2 every JOB that sweeps with both seats holds the job-level
 *      `prod-lifecycle-shared-accounts` lock, so two sweeps never walk the same
 *      leftover row at once (e2e-abuse-notifications' suites job had only the
 *      workflow-level prod-load group, which a dispatch does not share).
 *   M3 the helper-seat inventory counts a seat however it is supplied: step,
 *      job or WORKFLOW-level env, password or session secret.
 */

// @mutate scripts/e2e/sweep-both-seats.sh | HELPER_ACCESS_TOKEN="$HTOKEN" SWEEP_PHASE="$SWEEP_PHASE" exec node | exec node
// @mutate .github/workflows/e2e-abuse-notifications.yml |     concurrency:\n      group: prod-lifecycle-shared-accounts\n      cancel-in-progress: false\n    strategy: |     strategy:
// @mutate .github/workflows/e2e-journeys.yml |           SWEEP_PHASE: teardown | SWEEP_PHASE: pre
// @mutate .github/workflows/slow-network.yml |           E2E_STRIPE_MODE: ${{ vars.E2E_STRIPE_MODE }} | E2E_STRIPE_MODE: test
// @mutate .github/workflows/e2e-abuse-notifications.yml |           PLAYWRIGHT_LIFECYCLE_JOB_ID: ${{ secrets.PLAYWRIGHT_LIFECYCLE_JOB_ID }} | PLAYWRIGHT_LIFECYCLE_JOB_ID: ""
// @mutate scripts/e2e/stripe-sandbox-off.sh | gh variable set E2E_STRIPE_MODE --body live | gh variable list
// @mutate scripts/e2e/stripe-sandbox-off.sh |   exit 1\nfi\n\nread -r -s -p "Paste your sk_live key: " |   true\nfi\n\nread -r -s -p "Paste your sk_live key: "
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | export const SETTLE_FORWARD_MIN_AGE_MS = 6 * 60 * 60 * 1000; | export const SETTLE_FORWARD_MIN_AGE_MS = 2 * 60 * 60 * 1000;
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | if (CAN_SETTLE_FORWARD && oldEnough) { | if (CAN_SETTLE_FORWARD) {

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const root = join(__dirname, "..", "..");
const WF_DIR = join(root, ".github/workflows");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = {
  steps?: Step[];
  "timeout-minutes"?: number;
  env?: Record<string, string>;
  concurrency?: string | { group?: string; "cancel-in-progress"?: boolean };
};

const workflows = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((f) => ({ file: f, text: readFileSync(join(WF_DIR, f), "utf8") }))
  .map((w) => ({ ...w, doc: parse(w.text) as { env?: Record<string, string>; jobs?: Record<string, Job> } }));

const SWEEP = /prod-lifecycle-sweeper\.mjs|sweep-both-seats\.sh/;
const sweepSteps = workflows.flatMap((w) =>
  Object.entries(w.doc.jobs ?? {}).flatMap(([job, j]) =>
    (j.steps ?? [])
      .filter((s) => typeof s.run === "string" && SWEEP.test(s.run))
      .map((s) => ({ where: `${w.file} › ${job} › ${s.name ?? "(unnamed)"}`, step: s, job: j })),
  ),
);
const sweepJobs = [...new Map(sweepSteps.map((s) => [s.where.split(" › ").slice(0, 2).join(" › "), s.job])).entries()];

describe("every CI sweep holds both seats", () => {
  it("finds the sweep steps (inventory floor)", () => {
    expect(sweepSteps.length).toBeGreaterThan(5);
  });

  it.each(sweepSteps.map((s) => [s.where, s.step] as const))("%s", (_where, step) => {
    const run = step.run ?? "";
    expect(run, "runs the sweeper directly, poster seat only").not.toMatch(/node\s+\S*prod-lifecycle-sweeper\.mjs/);
    expect(run).toMatch(/bash scripts\/e2e\/sweep-both-seats\.sh/);
    expect(step.env?.HELPER_EMAIL).toBe("${{ secrets.PLAYWRIGHT_HELPER_EMAIL }}");
    expect(step.env?.HELPER_PASSWORD).toBe("${{ secrets.PLAYWRIGHT_HELPER_PASSWORD }}");
    // M1: the phase decides whether a failed helper mint fails the step.
    const teardown = /always\(\)/.test(String(step.if ?? ""));
    expect(step.env?.SWEEP_PHASE, "the `if: always()` unwind is the teardown; anything else is a pre-sweep").toBe(
      teardown ? "teardown" : "pre",
    );
    // L2: the sweeper settles forward only when the repo variable says test.
    expect(step.env?.E2E_STRIPE_MODE).toBe("${{ vars.E2E_STRIPE_MODE }}");
    // The two-role fixture is held BY ID, so every sweep must know that id.
    expect(step.env?.PLAYWRIGHT_LIFECYCLE_JOB_ID).toBe("${{ secrets.PLAYWRIGHT_LIFECYCLE_JOB_ID }}");
  });

  it("every workflow that sweeps has a teardown sweep", () => {
    const files = new Set(sweepSteps.map((s) => s.where.split(" › ")[0]));
    for (const f of files) {
      expect(
        sweepSteps.some((s) => s.where.startsWith(`${f} › `) && s.step.env?.SWEEP_PHASE === "teardown"),
        `${f} sweeps but never as a teardown`,
      ).toBe(true);
    }
  });

  it("finds the sweeping jobs (floor)", () => {
    expect(sweepJobs.length).toBeGreaterThan(4);
  });

  it.each(sweepJobs)("%s holds the job-level shared-accounts lock (M2)", (_where, job) => {
    const c = job.concurrency;
    const group = typeof c === "string" ? c : c?.group;
    expect(group, "two sweeps holding both seats must never walk the same row at once").toBe("prod-lifecycle-shared-accounts");
    expect(typeof c === "object" ? c["cancel-in-progress"] : undefined, "a cancelled sweep strands rows").toBe(false);
  });

  it("sweep-both-seats.sh hands the helper token to the sweeper", () => {
    const sh = read("scripts/e2e/sweep-both-seats.sh")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(sh).toMatch(/HELPER_ACCESS_TOKEN="\$HTOKEN" SWEEP_PHASE="\$SWEEP_PHASE" exec node "\$HERE\/prod-lifecycle-sweeper\.mjs"/);
  });
});

describe("the Stripe switch records its mode for the sweeper (L2)", () => {
  const code = (rel: string) =>
    read(rel)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");

  it("stripe-sandbox-off.sh says live BEFORE it swaps the key, and stops if it cannot", () => {
    const off = code("scripts/e2e/stripe-sandbox-off.sh");
    const flag = off.indexOf("gh variable set E2E_STRIPE_MODE --body live");
    expect(flag, "sandbox-off never tells CI Stripe is live").toBeGreaterThan(-1);
    expect(flag).toBeLessThan(off.indexOf("supabase secrets set"));
    expect(off.slice(flag, off.indexOf("supabase secrets set"))).toMatch(/exit 1/);
  });

  it("stripe-sandbox-on.sh says test only AFTER the test key is set", () => {
    const on = code("scripts/e2e/stripe-sandbox-on.sh");
    const flag = on.indexOf("gh variable set E2E_STRIPE_MODE --body test");
    expect(flag).toBeGreaterThan(on.lastIndexOf("supabase secrets set"));
  });
});

describe("the sweep never settles a job a live run could be driving", () => {
  const sweeper = read("scripts/e2e/prod-lifecycle-sweeper.mjs");

  const minAgeMs = (() => {
    const m = /export const SETTLE_FORWARD_MIN_AGE_MS = ([\d\s*]+);/.exec(sweeper);
    if (!m) return NaN;
    return m[1].split("*").reduce((acc, n) => acc * Number(n.trim()), 1);
  })();

  /**
   * Longest timeout of any job that can sign the helper in (the seat a hire
   * needs), however the seat reaches it: step, job or WORKFLOW-level env (a
   * workflow-level env reaches every job), by password or by a minted session
   * (review M3).
   */
  const HELPER_SEAT = /PLAYWRIGHT_HELPER_(PASSWORD|SESSION)/;
  const helperJobs = workflows.flatMap((w) => {
    const workflowWide = HELPER_SEAT.test(JSON.stringify(w.doc.env ?? {}));
    return Object.entries(w.doc.jobs ?? {})
      .filter(([, j]) => workflowWide || HELPER_SEAT.test(JSON.stringify(j)))
      .map(([job, j]) => ({ where: `${w.file} › ${job}`, minutes: j["timeout-minutes"] ?? 360 }));
  });

  it("inventories the helper-seat jobs (floor)", () => {
    expect(helperJobs.length).toBeGreaterThan(5);
  });

  it("the inventory sees a seat supplied only through workflow-level env", () => {
    const doc = parse(
      "env:\n  PLAYWRIGHT_HELPER_SESSION: ${{ secrets.PLAYWRIGHT_HELPER_SESSION }}\njobs:\n  drive:\n    timeout-minutes: 400\n    steps: [{ run: echo }]\n",
    ) as { env?: Record<string, string>; jobs?: Record<string, Job> };
    const workflowWide = HELPER_SEAT.test(JSON.stringify(doc.env ?? {}));
    const found = Object.entries(doc.jobs ?? {}).filter(([, j]) => workflowWide || HELPER_SEAT.test(JSON.stringify(j)));
    expect(found.map(([k]) => k)).toEqual(["drive"]);
  });

  it("the age gate is longer than every such job can run", () => {
    const longest = helperJobs.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    expect(minAgeMs, "SETTLE_FORWARD_MIN_AGE_MS is not a readable product of integers").toBeGreaterThan(0);
    expect(
      minAgeMs,
      `a row younger than ${longest.minutes} min may belong to ${longest.where}, still running`,
    ).toBeGreaterThan(longest.minutes * 60_000);
  });

  it("the settle-forward branch is gated on that age", () => {
    const code = sweeper.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
    expect(code).toMatch(/const oldEnough = [^;]*ageMs >= SETTLE_FORWARD_MIN_AGE_MS;/);
    expect(code).toMatch(/if \(CAN_SETTLE_FORWARD && oldEnough\) \{/);
    expect(code).not.toMatch(/if \(CAN_SETTLE_FORWARD\) \{/);
  });
});
