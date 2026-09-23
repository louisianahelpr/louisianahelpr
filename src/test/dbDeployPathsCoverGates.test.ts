/*
 * GUARD: every gate db-deploy.yml runs re-runs db-deploy when it changes.
 *
 * db-deploy triggers on a `paths:` list. A gate script (or a file it reads)
 * missing from that list can be edited on main without the gate ever running
 * against the change. Measured 2026-09-23 (Q120): an acknowledgement added to
 * scripts/audit/migration-provenance.json did not trigger a deploy, so the
 * provenance check it answered never re-ran until someone dispatched it.
 *
 * Inventory, from the workflow itself: every `node scripts/<x>.mjs` it runs,
 * plus each script's `./lib/*.mjs` imports and the `scripts/audit/*.json`
 * files it reads.
 */
// @mutate .github/workflows/db-deploy.yml |       - "scripts/audit/migration-provenance.json"\n | 
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const wf = read(".github/workflows/db-deploy.yml");

function pathsList(): Set<string> {
  const block = wf.slice(wf.indexOf("    paths:"), wf.indexOf("workflow_dispatch:"));
  return new Set([...block.matchAll(/^\s+- "([^"]+)"/gm)].map((m) => m[1]));
}

function depsOf(script: string): string[] {
  if (!existsSync(join(ROOT, script))) return [];
  const src = read(script);
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+"(\.\/lib\/[\w.-]+\.mjs)"/g)) out.push(join(dirname(script), m[1]));
  for (const m of src.matchAll(/"(scripts\/audit\/[\w.-]+\.json)"/g)) out.push(m[1]);
  return out;
}

// Reporting-only steps: they never decide the run's colour. Exact list; a
// stale entry fails below.
// @two-way src/test/dbDeployPathsCoverGates.test.ts:"stale EXEMPT entry — remove it"
const EXEMPT: Record<string, string> = {
  "scripts/ops-alert-ledger.mjs": "records the run outcome in the ops alert ledger after the gates; not a gate",
};

describe("db-deploy.yml re-runs when a gate it runs changes", () => {
  const scripts = [...new Set([...wf.matchAll(/node (scripts\/[\w./-]+\.m?js)/g)].map((m) => m[1]))];
  const paths = pathsList();

  it("reads a real inventory", () => {
    expect(scripts.length).toBeGreaterThan(5);
    expect(paths.size).toBeGreaterThan(10);
  });

  it("every gate script and what it reads is in the push paths filter", () => {
    const needed = scripts.filter((s) => !(s in EXEMPT)).flatMap((s) => [s, ...depsOf(s)]);
    const missing = [...new Set(needed)].filter((f) => !paths.has(f)).sort();
    expect(missing, "add these to db-deploy.yml on.push.paths").toEqual([]);
    const staleExempt = Object.keys(EXEMPT).filter((s) => !scripts.includes(s));
    expect(staleExempt, "stale EXEMPT entry — remove it").toEqual([]);
  });
});
