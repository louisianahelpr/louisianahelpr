/**
 * docs/OPEN.md Q1718: `npm run typecheck` was red in every Claude Code cloud
 * session, because its edge half (scripts/typecheck-edge.mjs) required `deno`
 * on PATH and the cloud image has none. The script now resolves Deno through
 * scripts/lib/resolveDeno.mjs: PATH first, else the pinned `deno` npm package
 * installed once into a cache outside the repo, and still a hard failure (never
 * a skip) when neither runs.
 *
 * Proven live on 2026-10-12 with PATH=/usr/local/bin:/usr/bin:/bin (no Deno):
 * origin/main's script exited 1 "Deno is not installed"; this one installed
 * deno@2.9.6 from npm in 4 s and checked 222 files, 0 errors.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PINNED_DENO, denoCacheDir, resolveDeno } from "../../scripts/lib/resolveDeno.mjs";
import { blankComments } from "./helpers/blankNonCode";

// @mutate scripts/typecheck-edge.mjs | const deno = resolveDeno(); | const deno = { bin: "deno", source: "path" };
// @mutate scripts/typecheck-edge.mjs | const run = spawnSync(DENO, ["check" | const run = spawnSync("deno", ["check"
// @mutate scripts/lib/resolveDeno.mjs |     if (!install(dir)) return null; |     return null;
// @mutate scripts/lib/resolveDeno.mjs |   return runs(bin) ? { bin, source: "npm" } : null; |   return { bin, source: "npm" };

const SCRIPT = blankComments(readFileSync(resolve(__dirname, "../../scripts/typecheck-edge.mjs"), "utf8"));

describe("typecheck:edge finds a Deno where none is installed (Q1718)", () => {
  it("the script resolves Deno through resolveDeno and runs every deno spawn on that binary", () => {
    expect(SCRIPT).toContain("const deno = resolveDeno();");
    const spawns = [...SCRIPT.matchAll(/spawnSync\(\s*([^,]+),/g)].map((m) => m[1].trim());
    // Inventory floor: the Stripe canary and the full check.
    expect(spawns.length).toBeGreaterThan(1);
    expect(spawns.filter((s) => s !== "DENO"), "a spawn that names a literal deno bypasses the npm fallback").toEqual([]);
    expect(SCRIPT).not.toMatch(/execFileSync\(\s*["']deno["']/);
  });

  const base = { env: {}, home: "/home/u", log: () => {} };
  const npmBin = `/home/u/.cache/lh-deno/${PINNED_DENO}/node_modules/.bin/deno`;

  it("PATH first: an installed deno is used and nothing is fetched", () => {
    const installs: string[] = [];
    const got = resolveDeno({ ...base, runs: (b) => b === "deno", install: (d) => (installs.push(d), true), exists: () => false });
    expect(got).toEqual({ bin: "deno", source: "path" });
    expect(installs).toEqual([]);
  });

  it("no deno on PATH: the pinned npm package is installed outside the repo and used", () => {
    const installed = new Set<string>();
    const installs: string[] = [];
    const runs = (b: string) => b !== "deno" && installed.has(b);
    const install = (d: string) => {
      installs.push(d);
      installed.add(`${d}/node_modules/.bin/deno`);
      return true;
    };
    const exists = (p: string) => installed.has(p);
    expect(resolveDeno({ ...base, runs, install, exists })).toEqual({ bin: npmBin, source: "npm" });
    expect(installs).toEqual([`/home/u/.cache/lh-deno/${PINNED_DENO}`]);
    // Second run: already cached, no second install.
    expect(resolveDeno({ ...base, runs, install, exists })).toEqual({ bin: npmBin, source: "npm" });
    expect(installs).toHaveLength(1);
    expect(denoCacheDir({ LH_DENO_CACHE: "/x/deno" })).toBe("/x/deno");
    expect(PINNED_DENO).toMatch(/^2\.\d+\.\d+$/);
  });

  it("never a skip: a failed install, or an installed binary that does not run, resolves to null", () => {
    expect(resolveDeno({ ...base, runs: () => false, install: () => false, exists: () => false })).toBeNull();
    expect(resolveDeno({ ...base, runs: () => false, install: () => true, exists: () => true })).toBeNull();
    expect(SCRIPT).toMatch(/if \(!deno\) \{[\s\S]*?process\.exit\(1\)/);
  });
});
