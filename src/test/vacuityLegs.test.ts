// @mutate scripts/vacuity/legs.mjs |   return scoped.filter((m) => !done.has(mutationKey(m))); |   return scoped;
// @mutate scripts/vacuity/legs.mjs |     if (now() >= deadline) { |     if (false) {
// @mutate scripts/vacuity/legs.mjs |   const ran = results.filter((r) => r.verdict !== NOT_REACHED).map(mutationKey); |   const ran = results.map(mutationKey);
// @mutate scripts/vacuity/legs.mjs |   if (!fs.existsSync(file)) throw new Error | if (false) throw new Error
// @mutate scripts/vacuity/legs.mjs |       if (state === "mutated" && fsx.existsSync(snapshot)) { |       if (false) {
// @mutate scripts/vacuity/legs.mjs |     mutated() {\n      state = "mutated"; |     mutated() {\n      state = "clean";
// @mutate scripts/vacuity/run.mjs |     if (pastDeadline(deadline)) { |     if (false) {
// @mutate scripts/vacuity/run.mjs |       const r = runGuard(m.guard, { rebuild: pwGuard && needsRebuild(m.target), clean: pwGuard && !needsRebuild(m.target) }); |       const r = runGuard(m.guard, { rebuild: pwGuard && needsRebuild(m.target) });
// @mutate scripts/vacuity/index.mjs |   if (LAST_LEG && remaining) |   if (false)
// @mutate scripts/ci/vacuity-legs.mjs | ...(n === LEGS ? ["--last-leg"] : []) | ...([])
// @mutate scripts/ci/vacuity-legs.mjs |     if: \${{ !cancelled() && needs.scope.outputs.have_e2e == 'true' && needs.${prev}.outputs.remaining != '' && needs.${prev}.outputs.remaining != '0' }} |     if: \${{ !cancelled() && needs.scope.outputs.have_e2e == 'true' }}
// @mutate scripts/e2e/wait-shared-accounts.mjs | ".github/workflows/press-every-control.yml", ".github/workflows/vacuity.yml"] | ".github/workflows/press-every-control.yml"]
// @mutate scripts/e2e/wait-shared-accounts.mjs | && !((me.now ?? Date.now()) - lastActivity(run) <= ACTIVE_WITHIN_MS) |
// @mutate scripts/vacuity/legs.mjs |     if (to === i) mine.add(g[0].guard); |     mine.add(g[0].guard);
// @mutate scripts/vacuity/legs.mjs |     const to = load.indexOf(Math.min(...load)); |     const to = 0;
// @mutate scripts/ci/vacuity-legs.mjs |           SLICE: \${{ needs.scope.outputs.slice }} |           SLICE: ""
// @mutate .github/workflows/vacuity.yml |       slice: ${{ steps.scope.outputs.slice }} |       slice: ""
/*
 * Q1270 (2026-10-07): vacuity.yml's Playwright registrations run in resumable
 * locked legs (scripts/vacuity/legs.mjs, written by scripts/ci/vacuity-legs.mjs),
 * each under the one-hour shared-account cap.
 *
 * Pinned here, with fakes (nothing here spawns a guard):
 *  - the committed vacuity.yml is exactly the generator's output;
 *  - a leg skips what earlier legs ran, stops starting groups at its deadline,
 *    and hands on only what it actually ran; the last leg fails on leftovers;
 *  - dist/ is back to the clean build before a baseline or a non-bundle
 *    mutation (it was not: a non-bundle mutation after a rebuilt one, or the
 *    next guard's baseline, ran against the previous mutation's bundle);
 *  - the shared-account waiter lets other runs in between legs, and does not
 *    call a long legged chain a ghost while its jobs still move.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs modules
import { groupByGuard, makeDistKeeper, mutationKey, nextDone, NOT_REACHED, parseSlice, readDone, remainingAfter, runWithinBudget, sliceOf } from "../../scripts/vacuity/legs.mjs";
import { collectMutations, selectKind } from "../../scripts/vacuity/run.mjs";
// @ts-expect-error — plain .mjs module
import { apply, LEGS, BUDGET_MIN, GATE_STEP_MINUTES, LEG_MINUTES, WORKFLOW } from "../../scripts/ci/vacuity-legs.mjs";
import { decide, ACTIVE_WITHIN_MS, STALE_RUN_MS, YIELDS_BETWEEN_LEGS } from "../../scripts/e2e/wait-shared-accounts.mjs";

type M = { guard: string; target: string; find: string; verdict?: string };
const m = (guard: string, find: string): M => ({ guard, target: "src/x.ts", find });
const regs = [m("e2e/a.spec.ts", "1"), m("e2e/a.spec.ts", "2"), m("e2e/b.spec.ts", "1"), m("e2e/c.spec.ts", "1")];

describe("vacuity.yml's e2e legs are generated (Q1270)", () => {
  const src = readFileSync(WORKFLOW, "utf8");
  const jobs = (parse(src) as { jobs: Record<string, { "timeout-minutes"?: number; steps?: { id?: string; run?: string; "timeout-minutes"?: number }[] }> }).jobs;
  const legs = Object.keys(jobs).filter((k) => /^vacuity-e2e(-\d+)?$/.test(k));

  it("the committed workflow is exactly scripts/ci/vacuity-legs.mjs's output", () => {
    expect(apply(src) === src, "run `node scripts/ci/vacuity-legs.mjs`").toBe(true);
  });

  it("every leg is under the hour, its gate step inside it, and resumes from the leg before", () => {
    expect(legs.length).toBe(LEGS);
    // The one-hour cap itself is sharedAccountLockJobsAreShort.test.ts's, over every locked job.
    expect(GATE_STEP_MINUTES).toBeLessThan(LEG_MINUTES);
    // A run started just before the budget ends (13 min measured) still finishes inside the step.
    expect(BUDGET_MIN + 13).toBeLessThanOrEqual(GATE_STEP_MINUTES);
    legs.forEach((key, i) => {
      const n = i + 1;
      const gate = jobs[key].steps?.find((s) => s.id === "gate");
      expect(jobs[key]["timeout-minutes"], key).toBe(LEG_MINUTES);
      expect(gate?.["timeout-minutes"], key).toBe(GATE_STEP_MINUTES);
      const lines = (gate?.run ?? "").split("\n").filter((l) => l.includes("npm run vacuity"));
      expect(lines.length, key).toBe(3);
      for (const l of lines) {
        expect(l, key).toContain(`--budget-min ${BUDGET_MIN} --done-out vacuity-legs/done-${n}.json`);
        expect(l.includes(`--done vacuity-legs/done-${n - 1}.json`), key).toBe(n > 1);
        expect(l.includes("--last-leg"), key).toBe(n === LEGS);
      }
    });
  });
});

describe("a leg resumes, stops at its deadline, and hands on only what it ran (legs.mjs)", () => {
  it("skips what earlier legs ran, in the original order", () => {
    expect(remainingAfter(regs, [mutationKey(regs[1]), mutationKey(regs[3])])).toEqual([regs[0], regs[2]]);
    expect(groupByGuard(regs).map((g: M[]) => g.length)).toEqual([2, 1, 1]);
  });

  it("runs whole guard groups until the deadline, and the rest are not reached", () => {
    let t = 0;
    const calls: string[] = [];
    const run = (group: M[], { deadline }: { deadline: number }) => {
      calls.push(group[0].guard);
      expect(deadline).toBe(10);
      t += 6; // each group takes 6 "minutes"
      return group.map((x) => ({ ...x, verdict: "killed" }));
    };
    const out = runWithinBudget(regs, { deadline: 10, run, now: () => t });
    expect(calls).toEqual(["e2e/a.spec.ts", "e2e/b.spec.ts"]);
    expect(out.map((r: M) => r.verdict)).toEqual(["killed", "killed", "killed", NOT_REACHED]);
    const done = nextDone(["earlier"], out);
    expect(done).toEqual(["earlier", ...regs.slice(0, 3).map(mutationKey)]);
    expect(remainingAfter(regs, done)).toEqual([regs[3]]);
  });

  it("a missing or malformed done list fails closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "vacuity-legs-"));
    try {
      expect(() => readDone(join(dir, "nope.json"))).toThrow(/missing/);
      writeFileSync(join(dir, "bad.json"), "{}");
      expect(() => readDone(join(dir, "bad.json"))).toThrow(/no "done" array/);
      writeFileSync(join(dir, "ok.json"), JSON.stringify({ done: ["a"], remaining: 1 }));
      expect(readDone(join(dir, "ok.json"))).toEqual(["a"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the gate fails the last leg on leftovers, and skips the not-reached in its verdicts", () => {
    const code = readFileSync(join(__dirname, "../../scripts/vacuity/index.mjs"), "utf8");
    expect(code).toMatch(/if \(LAST_LEG && remaining\)\n\s+fail\(/);
    expect(code).toContain("const results = legResults.filter((r) => r.verdict !== NOT_REACHED);");
    const run = readFileSync(join(__dirname, "../../scripts/vacuity/run.mjs"), "utf8");
    // The deadline is checked before the mutation is written, not after.
    expect(run.indexOf("if (pastDeadline(deadline)) {")).toBeGreaterThan(-1);
    expect(run.indexOf("if (pastDeadline(deadline)) {")).toBeLessThan(run.indexOf("fs.writeFileSync(abs, mutated);"));
  });
});

describe("a weekly run proves one slice of the e2e set, decided once (legs.mjs sliceOf)", () => {
  it("the slices partition the real e2e set, keep guards whole, and are balanced", () => {
    const e2e = selectKind(collectMutations().mutations, "e2e");
    expect(e2e.length).toBeGreaterThan(50);
    const k = 4;
    const slices = Array.from({ length: k }, (_, i) => sliceOf(e2e, i, k) as M[]);
    const all = slices.flat().map(mutationKey);
    expect(new Set(all).size, "a registration in two slices").toBe(all.length);
    expect([...all].sort()).toEqual(e2e.map(mutationKey).sort());
    const owner = new Map<string, number>();
    slices.forEach((s, i) =>
      s.forEach((x) => {
        expect(owner.get(x.guard) ?? i, `${x.guard} split across slices`).toBe(i);
        owner.set(x.guard, i);
      }),
    );
    const sizes = slices.map((s) => s.length);
    const biggestGuard = Math.max(...groupByGuard(e2e).map((g: M[]) => g.length));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(biggestGuard);
    expect(() => sliceOf(e2e, 4, 4)).toThrow();
    expect(() => parseSlice("2-4")).toThrow();
    expect(parseSlice("2/4")).toEqual({ i: 2, k: 4 });
  });

  it("the scope job picks the week's slice once; every leg's weekly command uses that output", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    const wf = parse(src) as { jobs: Record<string, { outputs?: Record<string, string>; steps?: { id?: string; run?: string; env?: Record<string, string> }[] }> };
    expect(wf.jobs.scope.outputs?.slice).toBe("${{ steps.scope.outputs.slice }}");
    const scopeRun = wf.jobs.scope.steps?.find((s) => s.id === "scope")?.run ?? "";
    expect(scopeRun).toContain('scope.mjs --all --slice "$(( 10#$(date -u +%V) % E2E_SLICES ))/${E2E_SLICES}"');
    for (const [key, job] of Object.entries(wf.jobs).filter(([k]) => /^vacuity-e2e(-\d+)?$/.test(k))) {
      const gate = job.steps?.find((s) => s.id === "gate");
      expect(gate?.env?.SLICE, key).toBe("${{ needs.scope.outputs.slice }}");
      expect(gate?.run, key).toMatch(/npm run vacuity:all -- --e2e --slice "\$\{SLICE\}" /);
    }
  });
});

describe("dist/ is the clean build before a baseline or a non-bundle mutation", () => {
  it("builds once, restores the copy after a mutated rebuild, and never serves a mutated bundle as clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "vacuity-dist-"));
    try {
      const dist = join(dir, "dist");
      const snapshot = join(dir, "snap", "dist");
      mkdirSync(join(dir, "snap"));
      let builds = 0;
      let source = "clean";
      const build = () => {
        builds++;
        rmSync(dist, { recursive: true, force: true });
        mkdirSync(dist);
        writeFileSync(join(dist, "app.js"), source);
        return { ok: true, out: "" };
      };
      const keeper = makeDistKeeper({ dist, snapshot, build });
      expect(keeper.clean().ok).toBe(true);
      expect(builds).toBe(1);
      expect(existsSync(join(snapshot, "app.js"))).toBe(true);
      keeper.clean();
      expect(builds, "already clean: no rebuild").toBe(1);
      // A bundle-affecting mutation rebuilds from mutated source, then the source is restored.
      keeper.mutated();
      source = "MUTATED";
      build();
      source = "clean";
      keeper.clean();
      expect(readFileSync(join(dist, "app.js"), "utf8")).toBe("clean");
      expect(builds, "restored from the copy, not rebuilt").toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runMutations brings dist/ back before a baseline and before a non-bundle mutation", () => {
    const run = readFileSync(join(__dirname, "../../scripts/vacuity/run.mjs"), "utf8");
    expect(run).toContain("const r = runPlaywright(g, { clean: true });");
    expect(run).toContain("const again = runPlaywright(g, { clean: true });");
    expect(run).toContain("clean: pwGuard && !needsRebuild(m.target)");
  });
});

describe("the shared-account queue around a legged chain", () => {
  const inv = { ".github/workflows/vacuity.yml": [{ key: "vacuity-e2e", name: "Playwright guards shown able to fail" }, { key: "vacuity-e2e-2", name: "Playwright guards shown able to fail (leg 2 of 20)" }] };
  const at = (h: number) => new Date(Date.UTC(2026, 9, 11, 0) + h * 3_600_000).toISOString();
  const me = { id: 9, created_at: at(12), now: Date.parse(at(12)) };

  it("vacuity.yml yields between legs, like press", () => {
    expect([...YIELDS_BETWEEN_LEGS]).toContain(".github/workflows/vacuity.yml");
    const between = { id: 1, created_at: at(1), name: "vacuity", path: ".github/workflows/vacuity.yml", html_url: "x", jobs: [{ name: "Playwright guards shown able to fail", status: "completed", conclusion: "success", completed_at: at(11.5) }] };
    expect(decide(me, [between], inv).go).toBe(true);
  });

  it("a chain older than STALE_RUN_MS is still queued ahead while its jobs move; a still one is a ghost", () => {
    expect(Date.parse(me.created_at) - Date.parse(at(1))).toBeGreaterThan(STALE_RUN_MS);
    const waiting = (last: string) => ({
      id: 1, created_at: at(1), name: "vacuity", path: ".github/workflows/vacuity.yml", html_url: "x",
      jobs: [
        { name: "Playwright guards shown able to fail", status: "completed", conclusion: "success", completed_at: last },
        { name: "Playwright guards shown able to fail (leg 2 of 20)", status: "waiting" },
      ],
    });
    expect(decide(me, [waiting(at(11.5))], inv).go, "moving chain").toBe(false);
    expect(Date.parse(at(12)) - Date.parse(at(2))).toBeGreaterThan(ACTIVE_WITHIN_MS);
    expect(decide(me, [waiting(at(2))], inv).go, "ghost").toBe(true);
  });
});
