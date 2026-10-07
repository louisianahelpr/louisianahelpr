/**
 * CLASS GUARD (docs/OPEN.md Q551): vacuity.yml never drives the shared prod test
 * accounts outside the shared-accounts lock.
 *
 * The vacuity job held the poster/helper secrets so a registered Playwright
 * guard could sign in, on every push, with no lock: it drove the accounts beside
 * a press run or a journey. Taking the lock for the whole job was no answer
 * (each push's proof would queue behind a 5-hour run and be cancelled by the
 * next push). So the mutation phase is split by kind: scripts/vacuity run.mjs
 * `kindOf` sends a registration whose guard is under e2e/ to `vacuity-e2e`, which
 * holds `prod-lifecycle-shared-accounts` behind the Q743 waiter and exists only
 * when the lock-free `scope` job (scripts/vacuity/scope.mjs) found one; every
 * other registration runs in the credential-free `vacuity` job (--no-e2e).
 *
 * Built from the workflow and the real registrations, and each @mutate line
 * breaks one link of the chain.
 */
// @mutate .github/workflows/vacuity.yml |             npm run vacuity -- --no-e2e --only "${ONLY}" |             npm run vacuity -- --only "${ONLY}"
// @mutate .github/workflows/vacuity.yml |             npm run vacuity:all -- --no-e2e |             npm run vacuity:all
// @mutate .github/workflows/vacuity.yml |             npm run vacuity -- --e2e --only "${ONLY}" |             npm run vacuity -- --only "${ONLY}"
// @mutate .github/workflows/vacuity.yml |     needs: [scope, wait-accounts]\n    if: needs.scope.outputs.have_e2e == 'true' |     needs: [scope, wait-accounts]\n    if: always()
// @mutate .github/workflows/vacuity.yml |   vacuity:\n    name: Guards shown able to fail\n    runs-on: ubuntu-latest | name: Guards shown able to fail\n    runs-on: ubuntu-latest\n    env:\n      PLAYWRIGHT_POSTER_PASSWORD: ${{ secrets.PLAYWRIGHT_POSTER_PASSWORD }}
// @mutate scripts/vacuity/run.mjs | export const kindOf = (m) => (isPlaywrightGuard(m.guard) ? "e2e" : "unit"); | export const kindOf = (m) => "unit";
// @mutate scripts/vacuity/run.mjs |   return kind === "all" ? mutations : mutations.filter((m) => kindOf(m) === kind); |   return mutations;
// @mutate scripts/vacuity/index.mjs | const kinded = selectKind(sel.scoped, KIND); | const kinded = sel.scoped;
// @mutate scripts/vacuity/index.mjs | const KIND = has("--e2e") ? "e2e" : has("--no-e2e") ? "unit" : "all"; | const KIND = "all";
// @mutate scripts/vacuity/scope.mjs | have_e2e=${e2e > 0} | have_e2e=true
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { collectMutations, isPlaywrightGuard, kindOf, scopeMutations, selectKind } from "../../scripts/vacuity/run.mjs";

const ROOT = resolve(__dirname, "../..");
type Step = { run?: string; env?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; env?: Record<string, unknown>; steps?: Step[]; concurrency?: { group?: string } | string };
const wf = parse(readFileSync(join(ROOT, ".github/workflows/vacuity.yml"), "utf8")) as { jobs: Record<string, Job> };
const needsOf = (j: Job) => (j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs : [j.needs]);
const runs = (j: Job) => (j.steps ?? []).map((s) => String(s.run ?? "")).join("\n");
const harness = (j: Job) => runs(j).split("\n").filter((l) => /npm run vacuity(?!:report)/.test(l));
const secretsIn = (j: Job) => JSON.stringify([j.env, ...(j.steps ?? []).map((s) => s.env)]).match(/secrets\.PLAYWRIGHT_\w+/g) ?? [];

const m = (guard: string, target = "src/x.ts") => ({ guard, target, find: "a", replace: "b" });
const sample = [m("e2e/a.spec.ts"), m("e2e/b.spec.ts", "src/y.ts"), m("src/test/c.test.ts"), m("scripts/d.test.ts")];

describe("Q551: registrations split by who may run them", () => {
  it("a guard under e2e/ is an e2e registration, anything else is unit", () => {
    expect(sample.map(kindOf)).toEqual(["e2e", "e2e", "unit", "unit"]);
    expect(selectKind(sample, "e2e").map((x) => x.guard)).toEqual(["e2e/a.spec.ts", "e2e/b.spec.ts"]);
    expect(selectKind(sample, "unit").map((x) => x.guard)).toEqual(["src/test/c.test.ts", "scripts/d.test.ts"]);
    expect(selectKind(sample, "all")).toHaveLength(4);
  });

  it("the split agrees with what actually runs under Playwright, over the real registrations", () => {
    const { mutations } = collectMutations();
    expect(mutations.length, "found almost no registrations").toBeGreaterThan(1000);
    const e2e = selectKind(mutations, "e2e");
    expect(e2e.length, "no Playwright registrations: the e2e job would never run").toBeGreaterThan(20);
    expect(e2e.every((x) => isPlaywrightGuard(x.guard))).toBe(true);
    expect(e2e.length + selectKind(mutations, "unit").length).toBe(mutations.length);
  });

  it("scopeMutations picks --only, the full set, or what changed, before the split", () => {
    expect(scopeMutations(sample, { only: ["e2e/a.spec.ts"] }).scoped.map((x) => x.guard)).toEqual(["e2e/a.spec.ts"]);
    expect(scopeMutations(sample, { only: ["nope.ts"] }).errors).toHaveLength(1);
    expect(scopeMutations(sample, { all: true }).scoped).toHaveLength(4);
    expect(scopeMutations(sample, { changed: new Set(["src/y.ts"]) }).scoped.map((x) => x.guard)).toEqual(["e2e/b.spec.ts"]);
    expect(scopeMutations(sample, { changed: null }).scoped).toHaveLength(4);
  });

  const scope = (...args: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "vacuity-scope-"));
    try {
      const out = join(dir, "out");
      execFileSync("node", [join(ROOT, "scripts/vacuity/scope.mjs"), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out } });
      return Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => l.split("=")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("scope.mjs says the lock job is needed exactly when an e2e registration is selected", () => {
    const { mutations } = collectMutations();
    const e2eGuard = mutations.find((x) => isPlaywrightGuard(x.guard))!.guard;
    const unitGuard = mutations.find((x) => !isPlaywrightGuard(x.guard))!.guard;
    expect(scope("--only", e2eGuard)).toMatchObject({ have_e2e: "true", unit_count: "0" });
    expect(scope("--only", unitGuard)).toMatchObject({ have_e2e: "false", e2e_count: "0" });
    expect(Number(scope("--all").e2e_count)).toBeGreaterThan(20);
  });
});

describe("Q551: the gate honours --e2e / --no-e2e", () => {
  const code = readFileSync(join(ROOT, "scripts/vacuity/index.mjs"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("reads both flags and filters the scoped registrations by kind before mutating", () => {
    expect(code).toContain('const KIND = has("--e2e") ? "e2e" : has("--no-e2e") ? "unit" : "all";');
    expect(code).toContain("const kinded = selectKind(sel.scoped, KIND);");
    expect(code).toContain("const scoped = SHARD ? selectShard(kinded, Number(SHARD[1]), Number(SHARD[2])) : kinded;");
    expect(code.indexOf("selectKind(sel.scoped, KIND)")).toBeLessThan(code.indexOf("runMutations(scoped"));
  });

  it("refuses both flags at once", () => {
    expect(code).toMatch(/has\("--e2e"\) && has\("--no-e2e"\)\) fail\(/);
  });
});

describe("Q551: vacuity.yml runs the Playwright registrations only under the lock", () => {
  const { scope: scopeJob, "wait-accounts": waiter, vacuity, "vacuity-e2e": e2e } = wf.jobs;

  it("the credential-free job names no shared-account secret and runs only --no-e2e", () => {
    expect(secretsIn(vacuity)).toEqual([]);
    const cmds = harness(vacuity);
    expect(cmds.length, "found no harness command in the vacuity job").toBeGreaterThan(2);
    for (const c of cmds) expect(c, c).toContain("--no-e2e");
  });

  it("the lock job holds the shared accounts, queues behind the waiter, and runs only --e2e", () => {
    expect(secretsIn(e2e).length, "vacuity-e2e must carry the credentials the e2e guards sign in with").toBeGreaterThan(3);
    expect(e2e.concurrency).toEqual({ group: "prod-lifecycle-shared-accounts", "cancel-in-progress": false });
    expect(needsOf(e2e)).toEqual(expect.arrayContaining(["scope", "wait-accounts"]));
    const cmds = harness(e2e);
    expect(cmds.length).toBeGreaterThan(2);
    for (const c of cmds) {
      expect(c, c).toContain("--e2e");
      expect(c, c).not.toContain("--no-e2e");
    }
  });

  it("neither the lock job nor its queue exists unless scope found e2e work", () => {
    for (const j of [waiter, e2e]) {
      expect(j.if, "must be gated on scope's output").toContain("needs.scope.outputs.have_e2e == 'true'");
      expect(j.if).not.toMatch(/always\(\)/);
    }
    expect(needsOf(waiter)).toEqual(["scope"]);
  });

  it("scope is lock-free and credential-free, and asks scope.mjs the same three questions the gate does", () => {
    expect(scopeJob.concurrency).toBeUndefined();
    expect(secretsIn(scopeJob)).toEqual([]);
    const text = runs(scopeJob);
    for (const mode of ['scope.mjs --only "${ONLY}"', "scope.mjs --all", "scope.mjs\n"]) expect(text + "\n", mode).toContain(mode);
    expect(runs(vacuity)).toContain('--only "${ONLY}"');
    expect(runs(vacuity)).toContain("vacuity:all");
  });

  it("the nightly report fails when the lock job was needed and did not succeed", () => {
    const status = String((wf.jobs.notify as { steps: { with?: { status?: string } }[] }).steps.find((s) => s.with?.status)?.with?.status);
    expect(status).toContain("needs.vacuity-e2e.result == 'success'");
    expect(status).toContain("needs.scope.outputs.have_e2e != 'true'");
    expect(needsOf(wf.jobs.notify)).toEqual(expect.arrayContaining(["scope", "vacuity", "vacuity-e2e"]));
  });
});
