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
 * @mutate scripts/vacuity/run.mjs | if (!only.length) errors.push("--only was given no guard file"); | ;
 * @mutate scripts/vacuity/run.mjs | errors.push(`--only names ${g}, which registers no @mutate line`); | ;
 * @mutate scripts/vacuity/run.mjs | scoped: mutations.filter((m) => only.includes(m.guard)), | scoped: mutations,
 */
import { beforeAll, describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

// The one place the planted-fixture directory is named: the SURVIVED case and
// the Tailwind-exclusion case below must agree on it.
const fixtureDir = (runId: string) => join(process.cwd(), "src", "test", "fixtures", `vacuitySelfTest-${runId}`);

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
    const dir = fixtureDir(runId);
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

  // Shown able to fail 2026-09-23 (Q136): drop the exclusion and the planted class compiles.
  // @mutate tailwind.config.ts | "!./src/test/fixtures/vacuitySelfTest-*/**", | "!./src/test/fixtures/nothing-*/**",
  it("Tailwind's content globs never read the planted fixture (Q136)", async () => {
    // Tailwind compiling the app's config in the same run (arbitraryWidthVariantsCompile)
    // globbed this test's fixture and then hit ENOENT when the SURVIVED case
    // deleted it. Proof the exclusion holds for the real directory name: plant a
    // class that exists nowhere else, compile with the app's own config, and it
    // must be absent — while the same class in a normal src/ file IS emitted, so
    // the check cannot pass by Tailwind emitting nothing.
    const runId = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const dir = fixtureDir(runId);
    const control = join(process.cwd(), "src", "test", "fixtures", `q136Control-${runId}.ts`);
    mkdirSync(dir, { recursive: true });
    // Built at runtime: a literal class in THIS file would itself be scanned and compiled.
    const px = (n: number) => `${n}px`;
    const cls = (n: number) => ["w-[", px(n), "]"].join("");
    writeFileSync(join(dir, "planted.spec.ts"), `export const c = "${cls(4321)}";\n`);
    writeFileSync(control, `export const c = "${cls(4322)}";\n`);
    try {
      const [{ default: postcss }, { default: tailwindcss }, { default: config }] = await Promise.all([
        import("postcss"),
        import("tailwindcss"),
        import(/* @vite-ignore */ resolve(process.cwd(), "tailwind.config.ts")) as Promise<{ default: unknown }>,
      ]);
      const css = (await postcss([tailwindcss(config as never)]).process("@tailwind utilities;", { from: undefined })).css;
      expect(css).toContain(px(4322)); // the control: an ordinary src/ file is scanned
      expect(css).not.toContain(px(4321)); // the fixture is not
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(control, { force: true });
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

/*
 * THE MUTATION PHASE MUST NOT BE INERT ON THE BRANCH THAT SHIPS.
 *
 * `changedFiles` diffed against `origin/main`, and on a push to main HEAD IS
 * origin/main — so the range was empty and every run printed "nothing in scope".
 * Measured 2026-09-21: not one push to main that day mutated a single
 * registration. The scan and ratchet halves worked; the PROOF half did nothing
 * on the only branch that matters.
 *
 * That is how a registration reached main unproven and left the grandfather
 * list without ever being scored — the nightly would have caught it, which
 * means "eventually" was doing all the work.
 */
describe("--only: a dispatch re-proves exactly the named guards (Q52/Q89)", () => {
  it("selects only the named guards' registrations and errors on a name that matches nothing", async () => {
    const { selectOnly } = (await import(/* @vite-ignore */ url("run.mjs"))) as {
      selectOnly: (m: Array<{ guard: string }>, only: string[]) => { scoped: Array<{ guard: string }>; errors: string[] };
    };
    const ms = [{ guard: "e2e/a.spec.ts" }, { guard: "e2e/a.spec.ts" }, { guard: "src/test/b.test.ts" }];
    const hit = selectOnly(ms, ["e2e/a.spec.ts"]);
    expect(hit.scoped).toHaveLength(2);
    expect(hit.errors).toEqual([]);
    // A typo must be red, never an empty green run.
    expect(selectOnly(ms, ["e2e/typo.spec.ts"]).errors).toEqual(["--only names e2e/typo.spec.ts, which registers no @mutate line"]);
    expect(selectOnly(ms, []).errors).toEqual(["--only was given no guard file"]);
  });
});

describe("the diff base is not the commit it is comparing", () => {
  const LIB = readFileSync(resolve(__dirname, "..", "..", "scripts", "vacuity", "lib.mjs"), "utf8");

  it("falls back to the previous commit when HEAD already equals the base", () => {
    expect(LIB, "changedFiles must resolve its base, not use it raw").toMatch(/effectiveBase/);
    expect(
      LIB,
      'without a HEAD~1 fallback, every push to main reports "nothing in scope" and proves nothing',
    ).toMatch(/HEAD~1/);
  });

  it("the resolved base is what the diff actually uses", () => {
    // A correct helper nobody calls is how the other three fake-proof channels
    // survived; pin the wiring, not just the function.
    const at = LIB.indexOf("git\", [\"diff\", \"--name-only\", `${resolved}...HEAD`]");
    expect(at, "changedFiles still interpolates the raw base into its diff range").toBeGreaterThan(0);
  });
});

// Remove the fallback and the mutation phase goes inert on every push to main —
// the state in which an unproven registration reached main and left the
// grandfather list unscored.
// @mutate scripts/vacuity/lib.mjs | return "HEAD~1"; | return base;
