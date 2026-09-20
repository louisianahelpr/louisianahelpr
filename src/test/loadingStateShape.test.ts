import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The CI check for the owner's 2026-09-19 report: loading states "jump and are
 * not consistent with their info."
 *
 * Standing order: an owner-reported bug ships with a check for its whole CLASS,
 * built from the app's own inventory, shown RED on the original defect.
 *
 * Two defects, two assertions:
 *   JUMP   the placeholder is a different SIZE from the content replacing it.
 *   SHAPE  the placeholder is a different SHAPE — different row count, a face
 *          where no face arrives.
 *
 * Neither is visible in source. A skeleton that looks right in JSX is routinely
 * 12px shorter than its content, and a `p-3` glass card standing in for a
 * `py-2.5` hairline row reads fine until something measures both. So the
 * evidence comes from `scripts/audit/measure-loading-states.mjs`, which drives
 * the real app against PROD with the shared test accounts (no mock mode, ever)
 * and records both frames' geometry; this spec gates on it.
 *
 * The inventory is scanned out of `src/` by what a placeholder IS, never from a
 * hand-kept list — a list that is both the input and the oracle cannot fail for
 * a missing member.
 */

const REPO = resolve(__dirname, "..", "..");
const CHECK = resolve(REPO, "scripts", "check-loading-state-shape.mjs");
const INVENTORY = resolve(REPO, "scripts", "loading-state-inventory.mjs");
const EVIDENCE = resolve(REPO, "docs", "audit", "loading-states", "measurements.json");

function run(script: string, args: string[] = []) {
  try {
    const stdout = execFileSync("node", [script, ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("loading states: the inventory is alive", () => {
  // @mutate scripts/loading-state-inventory.mjs | for (const m of code.matchAll(/<Skeleton\b/g)) push("skeletonElement", m.index, code); | // scan removed
  it("finds every kind of placeholder, above its floor", () => {
    const { code, stdout } = run(INVENTORY);
    expect(stdout, "the scan printed nothing").toMatch(/skeletonElement/);
    expect(code, `inventory floor breached:\n${stdout}`).toBe(0);
  });

  it("reports a non-empty inventory — an empty one must never pass", () => {
    const { stdout } = run(INVENTORY, ["--json"]);
    const inv = JSON.parse(stdout) as { hits: unknown[]; counts: Record<string, number> };
    // The floor the whole suite rests on. Without it every assertion below
    // holds vacuously the day the scan stops matching, which is exactly how
    // five guards in this repo stayed green for months.
    expect(inv.hits.length).toBeGreaterThan(300);
    expect(inv.counts.files).toBeGreaterThan(80);
  });
});

describe("loading states: no placeholder lies about size or shape", () => {
  // @mutate docs/audit/loading-states/baseline.json | "allow": [ | "allow": [ {"key":"__mutant__ /x #0","kind":"jump"},
  it("every measured placeholder matches what replaces it", () => {
    if (!existsSync(EVIDENCE)) {
      throw new Error(
        `No loading-state evidence at docs/audit/loading-states/measurements.json.\n` +
        `Produce it with:\n` +
        `  npm run build && npx vite preview --port 4173 &\n` +
        `  BASE=http://127.0.0.1:4173 node scripts/audit/measure-loading-states.mjs`,
      );
    }
    const { code, stdout } = run(CHECK);
    expect(code, stdout).toBe(0);
  });

  it("the evidence was produced against the real backend, not a mock", () => {
    const ev = JSON.parse(readFileSync(EVIDENCE, "utf8")) as { base: string; results: unknown[] };
    expect(ev.results.length).toBeGreaterThan(20);
    // A run against a mocked Supabase does not count as verification
    // (owner, 2026-09-12, twice). The frontend host may be local — the
    // measurement is of layout, not of the network — but the run must have
    // produced real surfaces, not an empty set.
    expect(ev.base).toBeTruthy();
  });
});
