/**
 * Q894 CLASS GUARD: every direct dependency installed in node_modules is the
 * version package-lock.json pins, so a local run tests what CI tests.
 *
 * 2026-10-01 (measured again 2026-10-06): the shared checkout's node_modules
 * held vitest 4.1.11 while the lockfile (and so CI's `npm ci`) had 5.0.3.
 * Every worktree that symlinks that node_modules ran a test runner CI never
 * runs, and nothing said so. The fix there is `npm ci`; this makes the drift
 * fail the local vitest run instead of hiding in it. In CI it holds by
 * construction (every job installs from the lockfile).
 *
 * Inventory: package.json's dependencies + devDependencies + optional, each
 * read from node_modules/<name>/package.json directly (not require(), which
 * a package's `exports` map can refuse).
 *
 * @mutate package-lock.json |     "node_modules/vitest": { |     "node_modules/vitest-renamed": {
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));

type LockEntry = { version?: string; optional?: boolean };

/** One line per direct dependency whose install disagrees with the lockfile. */
function driftedDeps(
  names: string[],
  lockPackages: Record<string, LockEntry>,
  installedVersion: (name: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const name of names) {
    const entry = lockPackages[`node_modules/${name}`];
    if (!entry?.version) {
      out.push(`${name}: in package.json but has no package-lock.json entry`);
      continue;
    }
    const installed = installedVersion(name);
    if (installed === null) {
      // An optional dependency for another platform is legitimately absent.
      if (!entry.optional) out.push(`${name}: locked ${entry.version}, not installed`);
      continue;
    }
    if (installed !== entry.version) out.push(`${name}: locked ${entry.version}, installed ${installed}`);
  }
  return out;
}

function installedVersion(name: string): string | null {
  const p = resolve(ROOT, "node_modules", name, "package.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")).version ?? null;
}

describe("installed dependencies match package-lock.json (Q894)", () => {
  const names = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...(pkg.optionalDependencies ?? {}),
  });

  it("reads every direct dependency", () => {
    // Inventory floor: 95 direct dependencies on 2026-10-12.
    expect(names.length).toBeGreaterThan(80);
    expect(names).toContain("vitest");
  });

  it("every direct dependency is installed at its locked version (run `npm ci` if not)", () => {
    expect(driftedDeps(names, lock.packages, installedVersion)).toEqual([]);
  });

  it("the check flags a stale install, a missing install and a missing lock entry", () => {
    const lockPackages = {
      "node_modules/a": { version: "5.0.3" },
      "node_modules/b": { version: "1.0.0" },
      "node_modules/c": { version: "2.0.0", optional: true },
    };
    const installed: Record<string, string | null> = { a: "4.1.11", b: null, c: null, d: "1.0.0" };
    expect(driftedDeps(["a", "b", "c", "d"], lockPackages, (n) => installed[n])).toEqual([
      "a: locked 5.0.3, installed 4.1.11",
      "b: locked 1.0.0, not installed",
      "d: in package.json but has no package-lock.json entry",
    ]);
  });
});
