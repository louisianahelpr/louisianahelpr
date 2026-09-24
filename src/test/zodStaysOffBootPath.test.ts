/**
 * PD-020: zod (the `forms` chunk, ~80 KB raw) was on the boot path of every
 * signed-in page because useProfile statically imported validateResult and a
 * schema, for a check whose result every caller discarded. The check now runs
 * through checkDrift(), which loads zod after the data is on screen.
 *
 * Class rule: the only modules that may statically import zod, the schemas or
 * validateResult are those three modules themselves; everything else goes
 * through checkDrift() (a dynamic import). The bundler half (vite.config.ts
 * pins zodConfig into the forms chunk, or app-shared captures it and imports
 * zod statically) is held by the built-bundle budget: without it /posts
 * measured 361 KB gz against a 337 budget, over the +5% band
 * (scripts/perf/critical-path.mjs --check, bundle-size.yml).
 *
 * @mutate src/hooks/useProfile.ts | import { checkDrift } from "@/lib/checkDrift"; | import { checkDrift } from "@/lib/checkDrift";\nimport "@/lib/validateResult";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const ZOD_HOMES = new Set(["src/lib/schemas.ts", "src/lib/validateResult.ts", "src/lib/zodConfig.ts"]);
const STATIC = /(?:^|\n)\s*import\s+(?:[^"';]*?\s+from\s+)?["'](zod|zod\/[^"']+|react-hook-form|@hookform\/[^"']+|@\/lib\/(?:schemas|validateResult|zodConfig)|\.{1,2}\/(?:[^"']*\/)?(?:schemas|validateResult|zodConfig))["']/g;

describe("zod stays off the boot path", () => {
  it("no app module statically imports zod, the schemas or validateResult", () => {
    const files = walkSource([join(ROOT, "src")]).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\/test\//.test(f),
    );
    expect(files.length).toBeGreaterThan(500); // ~1,000 app modules on 2026-09-24
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((f) => !ZOD_HOMES.has(f))
      .flatMap((f) => [...blankComments(readFileSync(join(ROOT, f), "utf8")).matchAll(STATIC)].map((m) => `${f} → ${m[1]}`));
    expect(offenders).toEqual([]);
  });

  it("checkDrift reaches them only by dynamic import", () => {
    const src = readFileSync(join(ROOT, "src/lib/checkDrift.ts"), "utf8");
    expect(src).toMatch(/import\("\.\/schemas"\)/);
    expect(src).toMatch(/import\("\.\/validateResult"\)/);
  });
});
