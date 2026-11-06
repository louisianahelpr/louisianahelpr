/*
 * GUARD: every script the web build runs is a deploy path.
 *
 * scripts/deploy-paths.sh is the ONE list that decides whether main ships
 * (scripts/prod-deploy.mjs) and whether Vercel builds it (scripts/vercel-ignore.sh).
 * `npm run build` runs post-processors after vite (`node scripts/<x>.mjs`) that
 * rewrite dist/. One missing from the list can change on main and never reach prod.
 * Measured 2026-11-05: the desktop-rail fix in scripts/inline-shell-css.mjs (#4170,
 * 3c6b54fe4d) was skipped by prod-deploy run 42167969958 as "no deploy path changed".
 *
 * Inventory, from package.json itself: every `node scripts/<x>.mjs` in "build",
 * plus each script's relative imports, followed transitively.
 */
// @mutate scripts/deploy-paths.sh | scripts/csp scripts/inline-shell-css.mjs | scripts/csp
// @mutate scripts/deploy-paths.sh |  scripts/csp |
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, relative } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function buildScripts(): string[] {
  const build: string = JSON.parse(read("package.json")).scripts.build;
  return [...build.matchAll(/\bnode (scripts\/[\w./-]+\.mjs)/g)].map((m) => m[1]);
}

function withImports(entry: string[]): string[] {
  const seen = new Set<string>();
  const todo = [...entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f) || !existsSync(join(ROOT, f))) continue;
    seen.add(f);
    for (const m of read(f).matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      todo.push(relative(ROOT, resolve(dirname(join(ROOT, f)), m[1])));
    }
  }
  return [...seen].sort();
}

function deployPaths(): string[] {
  return execFileSync("bash", ["scripts/deploy-paths.sh"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((l) => l && !l.startsWith(":("));
}

const covered = (file: string, paths: string[]) =>
  paths.some((p) => file === p || (existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isDirectory() && file.startsWith(p + "/")));

describe("the web build's own scripts ship when they change", () => {
  it("package.json's build runs at least the known post-processors (inventory is not empty)", () => {
    expect(buildScripts()).toEqual(expect.arrayContaining(["scripts/inline-shell-css.mjs", "scripts/check-csp-inline-scripts.mjs"]));
  });

  it("every build script and every file it imports is in scripts/deploy-paths.sh", () => {
    const paths = deployPaths();
    const files = withImports(buildScripts());
    // Floor (vacuity class a): measured 2026-11-06: 6 files (5 build scripts + 1 import), 20 deploy paths.
    expect(files.length).toBeGreaterThan(5);
    expect(paths.length).toBeGreaterThan(19);
    const missing = files.filter((f) => !covered(f, paths));
    expect(missing, `add these to scripts/deploy-paths.sh, or a change to them never reaches prod`).toEqual([]);
  });
});
