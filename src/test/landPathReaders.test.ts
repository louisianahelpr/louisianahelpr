// @mutate scripts/lib/landPathReaders.mjs |   { changed: /^supabase\/migrations\//, reads: | { changed: /^never\//, reads:
// @mutate scripts/lib/landPathReaders.mjs |   { changed: /^docs\/OPEN\.md$\|^docs\/archive\/OPEN-done-[^/]+\.md$/, reads: | { changed: /^never$/, reads:
// @mutate scripts/land.sh | $(node scripts/lib/landPathReaders.mjs $CHANGED_ALL | $(true $CHANGED_ALL
/*
 * GUARD: land.sh's local pass runs every test that READS a changed migration
 * or a queue file by path (scripts/lib/landPathReaders.mjs).
 *
 * 2026-10-07: cronLivenessCoverage, offerDeadlineBeforeStart, openFeedsMirrored
 * and hireRefusedAcrossBlock passed land.sh's local pass and went red only on
 * GitHub (~20 minutes a round): each reads supabase/migrations/ or
 * docs/OPEN.md by path, which `vitest --changed` (the import graph) and the
 * basename grep cannot see.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module
import { pathReaders } from "../../scripts/lib/landPathReaders.mjs";

const ROOT = join(__dirname, "..", "..");

describe("land.sh runs the tests that read a changed file by path", () => {
  it("a changed migration brings in the migration readers that went red only on CI", () => {
    const list: string[] = pathReaders(["supabase/migrations/20990101000000_x.sql"], { cwd: ROOT });
    expect(list).toEqual(expect.arrayContaining([
      "src/test/cronLivenessCoverage.test.ts",
      "src/test/offerDeadlineBeforeStart.test.ts",
      "src/test/hireRefusedAcrossBlock.test.ts",
    ]));
    expect(list.length).toBeGreaterThan(100); // ~300 tests read supabase/migrations on 2026-10-07
  });

  it("a changed docs/OPEN.md (or archive) brings in the queue readers", () => {
    const list: string[] = pathReaders(["docs/OPEN.md"], { cwd: ROOT });
    expect(list).toContain("src/test/openFeedsMirrored.test.ts");
    expect(list.length).toBeGreaterThan(50);
    expect(pathReaders(["docs/archive/OPEN-done-2026-10.md"], { cwd: ROOT })).toContain("src/test/openFeedsMirrored.test.ts");
  });

  it("a change to neither brings in nothing extra", () => {
    expect(pathReaders(["src/components/Foo.tsx", "README.md"], { cwd: ROOT })).toEqual([]);
  });

  it("land.sh adds them to the named-test run", () => {
    const land = readFileSync(join(ROOT, "scripts", "land.sh"), "utf8");
    const add = land.indexOf('NAMED_TESTS="$NAMED_TESTS $(node scripts/lib/landPathReaders.mjs $CHANGED_ALL');
    expect(add).toBeGreaterThan(-1);
    expect(add).toBeLessThan(land.indexOf("npx vitest run $NAMED_TESTS"));
  });
});
