/*
 * GUARD (Q83): zod runs jitless, so it never probes `new Function("")` and the
 * CSP (no unsafe-eval) stops logging a blocked-eval report on every page.
 */
// @mutate src/lib/zodConfig.ts | config({ jitless: true }); | config({});
// @mutate src/lib/schemas.ts | import "./zodConfig";\n | 
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

describe("zod never probes eval", () => {
  it("is jitless once the app's schemas are loaded", async () => {
    await import("@/lib/schemas");
    const { config } = await import("zod");
    expect(config().jitless).toBe(true);
  });

  it("every app module that imports zod loads zodConfig first", () => {
    const files = walkSource([join(ROOT, "src")]).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\/test\//.test(f) && !f.endsWith("zodConfig.ts"),
    );
    const importers = files.filter((f) => /from\s+"zod"/.test(blankComments(readFileSync(f, "utf8"))));
    expect(importers.length).toBeGreaterThanOrEqual(2); // 2 on 2026-09-23
    const late = importers.filter((f) => {
      const src = blankComments(readFileSync(f, "utf8"));
      const cfg = src.search(/import\s+"(?:\.\/|@\/lib\/)zodConfig"/);
      const zod = src.search(/from\s+"zod"/);
      return cfg < 0 || cfg > zod;
    });
    expect(late.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
