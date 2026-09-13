import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Every Playwright project or spec NAMED by a local hook or script must exist.
 *
 * 2026-09-12: 605df3d6f deleted e2e/happy-path/visual-audit-sweep.spec.ts, but
 * scripts/check-changed.mjs (run by .husky/pre-push) still ran
 * `playwright test --project=happy-path visual-audit-sweep`. Playwright found no
 * test, exited nonzero, and every push failed. Nothing checked that the names a
 * hook passes to Playwright still refer to something on disk.
 *
 * Both sides come from the world: the invocations are parsed out of
 * scripts/*.mjs, every .husky hook and package.json scripts; the projects out of
 * playwright.config.ts; the specs from the e2e/ tree.
 */
const ROOT = resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export const PROJECTS = [...readFileSync(join(ROOT, "playwright.config.ts"), "utf8").matchAll(/^\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]);
const SPECS = walk(join(ROOT, "e2e"))
  .filter((f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f))
  .map((f) => relative(ROOT, f));

/** Args of every `playwright test` call in a source: shell form or a JS spawn array. */
export function playwrightInvocations(src: string): string[][] {
  const out: string[][] = [];
  for (const m of src.matchAll(/playwright test([^&|;\n"`]*)/g)) out.push(m[1].trim().split(/\s+/).filter(Boolean));
  for (const m of src.matchAll(/\[\s*"playwright"\s*,\s*"test"\s*((?:,\s*"[^"]*"\s*)*)\]/g)) {
    out.push([...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]));
  }
  return out;
}

/** Project names and positional spec filters that resolve to nothing. */
export function missingTargets(args: string[], projects: string[], specs: string[]): string[] {
  const missing: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--project")) {
      const name = a.includes("=") ? a.split("=")[1] : args[++i];
      if (!projects.includes(name)) missing.push(`project "${name}"`);
    } else if (a.startsWith("-")) {
      if (!a.includes("=") && /^--(workers|grep|config|reporter|retries|shard|timeout|output)$/.test(a)) i++;
    } else if (!specs.some((s) => new RegExp(a).test(s))) {
      missing.push(`spec filter "${a}"`);
    }
  }
  return missing;
}

function sources(): { file: string; src: string }[] {
  const files = [
    ...readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => join("scripts", f)),
    ...readdirSync(join(ROOT, ".husky")).filter((f) => !f.startsWith("_") && statSync(join(ROOT, ".husky", f)).isFile()).map((f) => join(".husky", f)),
  ];
  const out = files.map((file) => ({ file, src: readFileSync(join(ROOT, file), "utf8") }));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const [k, v] of Object.entries(pkg.scripts)) out.push({ file: `package.json#${k}`, src: v });
  return out;
}

describe("Playwright targets named by hooks and scripts exist", () => {
  it("reads a real inventory", () => {
    expect(PROJECTS).toContain("a11y-prod");
    expect(SPECS.length).toBeGreaterThan(5);
    expect(existsSync(join(ROOT, "scripts/check-changed.mjs"))).toBe(true);
  });

  it("can fail: the 605df3d6f invocation is flagged", () => {
    const [args] = playwrightInvocations('spawnSync("npx", ["playwright", "test", "--project=happy-path", "visual-audit-sweep"], {');
    expect(missingTargets(args, PROJECTS, SPECS)).toEqual(['spec filter "visual-audit-sweep"']);
    expect(missingTargets(["--project=nope"], PROJECTS, SPECS)).toEqual(['project "nope"']);
  });

  it("every invocation resolves", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const { file, src } of sources()) {
      for (const args of playwrightInvocations(src)) {
        seen++;
        for (const m of missingTargets(args, PROJECTS, SPECS)) bad.push(`${file}: ${m}`);
      }
    }
    expect(seen).toBeGreaterThan(1);
    expect(bad).toEqual([]);
  });
});
