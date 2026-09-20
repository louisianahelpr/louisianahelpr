/**
 * THE GATE'S OWN GUARD — `npm run vacuity` shown able to fail.
 *
 * CLAUDE.md: "every check must be shown able to fail." That applies hardest to
 * the mechanism that enforces it: a vacuity gate that cannot itself fail is
 * the most expensive kind of green there is, because everything downstream
 * trusts it.
 *
 * So this plants deliberately vacuous guards and asserts the gate flags each
 * one, and plants sound guards and asserts it does NOT. The last case is a
 * real end-to-end mutation run: a planted guard, a planted target, the guard
 * survives breaking the target, and the runner must return SURVIVED.
 *
 * @mutate scripts/vacuity/scan.mjs | res.classA = res.inventoryDriven && res.floors.length === 0; | res.classA = false;
 * @mutate scripts/vacuity/run.mjs | verdict = r.green ? "SURVIVED" : "killed"; | verdict = "killed";
 */
import { beforeAll, describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Loaded by URL at runtime, not by a static specifier: scripts/ is outside
// tsconfig.app.json's `include`, and a composite project refuses to compile an
// import that resolves outside its rootDir. The gate lives in scripts/ on
// purpose (it must run without vite), so the test reaches across rather than
// the mechanism moving into src/.
const url = (f: string) => pathToFileURL(join(process.cwd(), "scripts", "vacuity", f)).href;

type Scan = { classA: boolean; classD: boolean };
let scanGuard: (rel: string, src?: string) => Scan;
let collectMutations: (guards: string[]) => {
  mutations: Array<Record<string, unknown>>;
  errors: string[];
};
let runMutations: (
  m: Array<Record<string, unknown>>,
  o?: { allowDirty?: boolean },
) => Array<{ verdict: string }>;
let parseDirectives: (rel: string) => { mutations: unknown[] };
let guardFiles: () => string[];

beforeAll(async () => {
  ({ scanGuard } = await import(/* @vite-ignore */ url("scan.mjs")));
  ({ collectMutations, runMutations } = await import(/* @vite-ignore */ url("run.mjs")));
  ({ parseDirectives, guardFiles } = await import(/* @vite-ignore */ url("lib.mjs")));
});

const VACUOUS_EMPTY_INVENTORY = `
import { readdirSync, readFileSync } from "node:fs";
it("checks every file", () => {
  const files = readdirSync("src/lib/does-not-exist");
  const offenders = files.filter((f) => readFileSync(f, "utf8").includes("BANNED"));
  expect(offenders).toEqual([]);
});
`;

const SOUND_WITH_FLOOR = `
import { readdirSync, readFileSync } from "node:fs";
it("checks every file", () => {
  const files = readdirSync("src/lib");
  expect(files.length).toBeGreaterThan(10);
  const offenders = files.filter((f) => readFileSync(f, "utf8").includes("BANNED"));
  expect(offenders).toEqual([]);
});
`;

const SELF_REFERENTIAL = `
const REGISTRY = ["a", "b", "c"];
it("covers the registry", () => {
  for (const key of REGISTRY) {
    expect(REGISTRY).toContain(key);
  }
});
`;

describe("the vacuity gate can itself fail", () => {
  it("flags an inventory with no floor (class a) and clears one with a floor", () => {
    expect(scanGuard("planted.test.ts", VACUOUS_EMPTY_INVENTORY).classA).toBe(true);
    expect(scanGuard("planted.test.ts", SOUND_WITH_FLOOR).classA).toBe(false);
  });

  it("flags a list that is both input and oracle (class d)", () => {
    expect(scanGuard("planted.test.ts", SELF_REFERENTIAL).classD).toBe(true);
    expect(scanGuard("planted.test.ts", SOUND_WITH_FLOOR).classD).toBe(false);
  });

  it("rejects a registration that cannot actually mutate anything", () => {
    const dir = join(process.cwd(), "node_modules", ".vacuity-selftest");
    mkdirSync(dir, { recursive: true });
    const guard = "node_modules/.vacuity-selftest/bad.test.ts";
    writeFileSync(
      join(process.cwd(), guard),
      [
        "// @mutate src/lib/utils.ts | THIS_STRING_IS_NOT_IN_THAT_FILE_12345 | x",
        "// @mutate src/lib/nope-does-not-exist.ts | a | b",
        "// @mutate src/lib/utils.ts",
        "// @mutate src/lib/utils.ts | cn | cn",
        "// @mutate src/lib/utils.ts | import | x",
        "",
      ].join("\n"),
    );
    const { mutations, errors } = collectMutations([guard]);
    expect(mutations).toHaveLength(0);
    expect(errors).toHaveLength(5);
    expect(errors.join("\n")).toMatch(/is not in/);
    expect(errors.join("\n")).toMatch(/does not exist/);
    expect(errors.join("\n")).toMatch(/malformed/);
    expect(errors.join("\n")).toMatch(/no-op/);
    expect(errors.join("\n")).toMatch(/ambiguous/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports SURVIVED when a planted guard does not notice its target breaking", () => {
    // End-to-end: a guard that asserts nothing about its target, and a target
    // that gets broken. The runner must call this SURVIVED, because that is
    // the single verdict the whole gate exists to produce.
    //
    // The fixture MUST live under src/: runMutations() spawns a real `vitest
    // run` on guardRel, and vitest's own config only discovers test files
    // matching `src/**/*.{test,spec}.{ts,tsx}` — a temp dir elsewhere would
    // never be picked up. But src/** is exactly what
    // discardedQueryFilters.test.ts's guard.scan() walks in the same suite
    // run, and a scan reading a file at the instant this test's `finally`
    // deletes it throws ENOENT (proven: `npx vitest run
    // src/test/vacuityGate.test.ts src/test/discardedQueryFilters.test.ts`
    // failed discardedQueryFilters with "ENOENT ... vacuitySelfTest/
    // planted.spec.ts" before this fix). A fixed directory name also means
    // two overlapping runs of THIS file (retries, sharding) can stomp each
    // other's fixture mid-run. Suffixing the directory with the pid and a
    // random id makes every run's fixture a distinct path, so no concurrent
    // reader or writer — this test's own retries included — can ever collide
    // on it; scripts/check-discarded-query-filters.mjs additionally treats a
    // file vanishing mid-scan as "not present" rather than a crash, which is
    // the other half of the fix (a scanner walking a live tree must tolerate
    // that regardless of any one fixture's naming).
    const runId = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const dir = join(process.cwd(), "src", "test", "fixtures", `vacuitySelfTest-${runId}`);
    mkdirSync(dir, { recursive: true });
    const target = `src/test/fixtures/vacuitySelfTest-${runId}/target.ts`;
    const guardRel = `src/test/fixtures/vacuitySelfTest-${runId}/planted.spec.ts`;
    writeFileSync(join(process.cwd(), target), "export const LOAD_BEARING = true;\n");
    writeFileSync(
      join(process.cwd(), guardRel),
      [
        `// @mutate ${target} | export const LOAD_BEARING = true; | export const LOAD_BEARING = false;`,
        `import { it, expect } from "vitest";`,
        `it("asserts nothing about the target", () => { expect(1).toBe(1); });`,
        "",
      ].join("\n"),
    );
    try {
      const { mutations, errors } = collectMutations([guardRel]);
      expect(errors).toEqual([]);
      expect(mutations).toHaveLength(1);
      // allowDirty: the planted target is untracked by design.
      const [r] = runMutations(mutations, { allowDirty: true });
      expect(r.verdict).toBe("SURVIVED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("watches every guard in src/test — the set is derived, not listed", () => {
    const guards = guardFiles();
    expect(guards.length).toBeGreaterThan(100);
    expect(guards).toContain("src/test/shellConsistency.test.ts");
    // and the directive parser really reads them
    expect(parseDirectives("src/test/shellConsistency.test.ts").mutations.length).toBeGreaterThan(0);
  });
});
