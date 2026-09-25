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
 */

// @mutate scripts/e2e/sweep-both-seats.sh | HELPER_ACCESS_TOKEN="$HTOKEN" exec node | exec node
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | export const SETTLE_FORWARD_MIN_AGE_MS = 6 * 60 * 60 * 1000; | export const SETTLE_FORWARD_MIN_AGE_MS = 2 * 60 * 60 * 1000;
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | if (CAN_SETTLE_FORWARD && oldEnough) { | if (CAN_SETTLE_FORWARD) {

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const root = join(__dirname, "..", "..");
const WF_DIR = join(root, ".github/workflows");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { steps?: Step[]; "timeout-minutes"?: number; env?: Record<string, string> };

const workflows = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((f) => ({ file: f, text: readFileSync(join(WF_DIR, f), "utf8") }))
  .map((w) => ({ ...w, doc: parse(w.text) as { jobs?: Record<string, Job> } }));

const SWEEP = /prod-lifecycle-sweeper\.mjs|sweep-both-seats\.sh/;
const sweepSteps = workflows.flatMap((w) =>
  Object.entries(w.doc.jobs ?? {}).flatMap(([job, j]) =>
    (j.steps ?? [])
      .filter((s) => typeof s.run === "string" && SWEEP.test(s.run))
      .map((s) => ({ where: `${w.file} › ${job} › ${s.name ?? "(unnamed)"}`, step: s })),
  ),
);

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
  });

  it("sweep-both-seats.sh hands the helper token to the sweeper", () => {
    const sh = read("scripts/e2e/sweep-both-seats.sh")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(sh).toMatch(/HELPER_ACCESS_TOKEN="\$HTOKEN" exec node "\$HERE\/prod-lifecycle-sweeper\.mjs"/);
  });
});

describe("the sweep never settles a job a live run could be driving", () => {
  const sweeper = read("scripts/e2e/prod-lifecycle-sweeper.mjs");

  const minAgeMs = (() => {
    const m = /export const SETTLE_FORWARD_MIN_AGE_MS = ([\d\s*]+);/.exec(sweeper);
    if (!m) return NaN;
    return m[1].split("*").reduce((acc, n) => acc * Number(n.trim()), 1);
  })();

  /** Longest timeout of any job that can sign the helper in (the seat a hire needs). */
  const helperJobs = workflows.flatMap((w) =>
    Object.entries(w.doc.jobs ?? {})
      .filter(([, j]) => JSON.stringify(j).includes("PLAYWRIGHT_HELPER_PASSWORD"))
      .map(([job, j]) => ({ where: `${w.file} › ${job}`, minutes: j["timeout-minutes"] ?? 360 })),
  );

  it("inventories the helper-seat jobs (floor)", () => {
    expect(helperJobs.length).toBeGreaterThan(5);
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
