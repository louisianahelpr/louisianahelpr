/**
 * A WHOLE-REPO SCANNER MUST SURVIVE A FILE DISAPPEARING MID-WALK.
 *
 * `vacuityGate.test.ts` plants a fixture under `src/test/fixtures/` and deletes
 * it seconds later — it has to live under `src/` because vitest only runs test
 * files from there, so the planted guard would otherwise never execute and the
 * mutation would report "inconclusive" instead of the SURVIVED verdict that
 * case exists to produce.
 *
 * Under parallel vitest that fixture is therefore visible, then gone, while
 * other specs are walking the repo. `check-discarded-query-filters.mjs` guarded
 * its `readdirSync` but not the `statSync` that followed, so an entry that
 * vanished in between threw ENOENT and killed the ENTIRE scan — surfacing as a
 * guard failure in a file the guard had never read, which is the shape people
 * learn to dismiss as flake.
 *
 * The fixture is not the defect. Any transient file does this: an editor swap
 * file, a build artifact, a concurrent checkout. A file that is gone is not a
 * violation.
 *
 * Fixed in `6f5a696d6`, which guards BOTH racing calls — the `statSync` in the
 * walk and the `readFileSync` in `scan()` — and narrows each catch to ENOENT so
 * a permissions error still surfaces instead of being silently skipped. This
 * file exists so neither guard can quietly come off again: the race is
 * invisible in a serial run and only bites under parallel vitest, which is
 * exactly when a red gets dismissed as flake.
 *
 * WHY A DANGLING SYMLINK. Reproducing the real race means deleting a file
 * during a synchronous walk, which a timer in the same thread can never do —
 * the first attempt at this test "passed" against the broken scanner for
 * exactly that reason. A dangling symlink is the same condition made
 * deterministic: `readdirSync` lists the entry, `statSync` throws ENOENT on it.
 * It is also a real thing to find in a working tree.
 *
 * @mutate scripts/check-discarded-query-filters.mjs |       let st;\n      try {\n        st = statSync(full);\n      } catch (e) {\n        if (e.code === "ENOENT") continue;\n        throw e;\n      } |       const st = statSync(full);
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations. Same convention as
// src/test/discardedQueryFilters.test.ts, which imports the same module.
import * as guard from "../../scripts/check-discarded-query-filters.mjs";

/**
 * OUTSIDE the repo, and the first version of this file got that wrong.
 *
 * It planted the dangling symlink under `src/test/fixtures/` — inside a root
 * that every repo scanner walks — so while this spec ran, OTHER suites hit the
 * unstattable entry. `loadingStateShape.test.ts` duly died on it with ENOENT.
 * A test for "scanners must tolerate vanishing files" that hands every other
 * scanner a vanishing file is not a test, it is the bug with a bow on it.
 *
 * `listFiles`/`scan` both take (roots, repo), so the probe can live in a real
 * temp directory and be scanned explicitly. Nothing else can see it.
 */
const BASE = mkdtempSync(join(tmpdir(), "vanish-probe-"));
const ROOT_NAME = "probe";
const DIR = join(BASE, ROOT_NAME);

afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe("the repo scanner tolerates entries it cannot stat", () => {
  it("does not throw when a listed entry no longer resolves", () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    symlinkSync(join(DIR, "never-existed.ts"), join(DIR, "vanished.ts"));
    expect(
      () => guard.scan([ROOT_NAME], BASE),
      "a file that disappeared between readdir and stat crashed the whole scan",
    ).not.toThrow();
  });

  it("still finds real files around the unreadable one — it skips, not aborts", () => {
    // The lazy fix is to swallow the error and return early, which would make
    // the scanner silently stop at the first odd entry and report a clean repo.
    // The dangler sorts FIRST, so an aborting walk loses everything after it.
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    symlinkSync(join(DIR, "never-existed.ts"), join(DIR, "aaa-vanished.ts"));
    writeFileSync(join(DIR, "bbb-real.ts"), "export const a = 1;\n");
    writeFileSync(join(DIR, "ccc-real.ts"), "export const b = 2;\n");
    const files: string[] = guard.listFiles([ROOT_NAME], BASE);
    expect(
      files.filter((f: string) => f.endsWith("-real.ts")).length,
      "the walk aborted at the unreadable entry instead of skipping past it",
    ).toBe(2);
  });
});
