// @mutate .github/workflows/open-done-when.yml | npm install --no-audit --no-fund --legacy-peer-deps | npm ci

/*
 * CLASS GUARD: every CI dependency install resolves peers the way the
 * committed package-lock.json was written — with --legacy-peer-deps.
 *
 * 2026-09-28 (#1951, open-done-when run 36361269174): a bare `npm ci` on
 * Node 22 refused the lockfile ("Missing: @emnapi/core@1.11.3 from lock
 * file; Missing: @emnapi/wasi-threads@1.2.3"). It was the only install in
 * .github/ without --legacy-peer-deps; every install that carries the flag
 * (test.yml, vitest.yml, sentry-release.yml's `npm ci`) was green on the
 * same lockfile.
 *
 * Reads every workflow and composite action (parsed YAML, so comments are
 * never scanned) and fails on any `npm ci` / bare `npm install` step that
 * lacks the flag. `npm install <pkg>` of a single named package is exempt:
 * it installs outside the lockfile on purpose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(__dirname, "..", "..", ".github");

function yamlFiles(): string[] {
  const out: string[] = [];
  const wf = join(ROOT, "workflows");
  for (const f of readdirSync(wf)) if (f.endsWith(".yml") || f.endsWith(".yaml")) out.push(join(wf, f));
  const actions = join(ROOT, "actions");
  if (existsSync(actions)) {
    for (const d of readdirSync(actions)) {
      for (const n of ["action.yml", "action.yaml"]) {
        const p = join(actions, d, n);
        if (existsSync(p)) out.push(p);
      }
    }
  }
  return out;
}

function runScripts(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) for (const v of node) runScripts(v, acc);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "run" && typeof v === "string") acc.push(v);
      else runScripts(v, acc);
    }
  }
  return acc;
}

/** Every lockfile install command in a shell script, one per line. */
export function lockfileInstalls(script: string): string[] {
  return script
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => /\bnpm\s+(ci|install|i)\b/.test(l))
    .filter((l) => {
      const m = l.match(/\bnpm\s+(ci|install|i)\b(.*)$/);
      if (!m) return false;
      if (m[1] === "ci") return true;
      // `npm install pg@8` names a package: not a lockfile install.
      const args = m[2].split(/[\s;&|]+/).filter(Boolean);
      const firstNonFlag = args.find((a) => !a.startsWith("-"));
      return firstNonFlag === undefined;
    });
}

export function offenders(installs: string[]): string[] {
  return installs.filter((l) => !/--legacy-peer-deps\b/.test(l));
}

describe("CI installs resolve peers the way the lockfile was written", () => {
  const all: { file: string; line: string }[] = [];
  for (const f of yamlFiles()) {
    const doc = parse(readFileSync(f, "utf8"));
    for (const s of runScripts(doc)) for (const line of lockfileInstalls(s)) all.push({ file: f.replace(ROOT, ".github"), line });
  }

  it("finds the installs it guards (inventory floor)", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it("every npm ci / bare npm install passes --legacy-peer-deps", () => {
    const bad = all.filter((a) => offenders([a.line]).length > 0).map((a) => `${a.file}: ${a.line}`);
    expect(bad).toEqual([]);
  });

  it("the matcher catches the exact line that went red, and exempts a named package", () => {
    expect(offenders(lockfileInstalls("npm ci"))).toEqual(["npm ci"]);
    expect(offenders(lockfileInstalls("npm ci --no-audit --legacy-peer-deps"))).toEqual([]);
    expect(lockfileInstalls("npm install --silent --no-audit --no-fund pg@8")).toEqual([]);
    expect(offenders(lockfileInstalls("npm install --no-audit"))).toEqual(["npm install --no-audit"]);
  });
});
