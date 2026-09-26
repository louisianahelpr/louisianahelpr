/**
 * docs/OPEN.md Q164: the set of deployed edge functions must equal
 * supabase/functions/*. scripts/check-deployed-functions.mjs runs nightly in
 * db-drift-detect.yml against the Management API; this pins its comparison and
 * its wiring. Its fail-closed exits (no credentials, a failed read, an empty
 * list) are run in src/test/liveCheckScriptsFailClosed.test.ts.
 *
 * The original incident: tmp-q156-stripe-events, deployed at 13:19Z on
 * 2026-09-23, was gone a minute later, and nothing would have said so. The
 * mirror case is a temporary function a lane forgot to delete.
 */
// @mutate scripts/check-deployed-functions.mjs |     notInRepo: [...d].filter((f) => !r.has(f)).sort(), |     notInRepo: [],
// @mutate scripts/check-deployed-functions.mjs |     notDeployed: [...r].filter((f) => !d.has(f)).sort(), |     notDeployed: [],
// @mutate scripts/check-deployed-functions.mjs | .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(dir, d.name, "index.ts"))) | .filter((d) => d.isDirectory())
// @mutate .github/workflows/db-drift-detect.yml |           if [ "${DEPLOYED_FUNCTIONS:-success}" = "failure" ]; then | if false; then
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { compareFunctions, repoFunctions } from "../../scripts/check-deployed-functions.mjs";

const ROOT = resolve(__dirname, "../..");

describe("Q164: deployed edge functions are exactly the repo's", () => {
  const repo = repoFunctions(resolve(ROOT, "supabase/functions")) as string[];

  it("reads the repo's functions, not _shared (inventory floor)", () => {
    expect(repo.length).toBeGreaterThan(60);
    expect(repo).toContain("create-payment");
    expect(repo.some((f) => f.startsWith("_"))).toBe(false);
  });

  it("identical sets are clean", () => {
    expect(compareFunctions(repo, [...repo].reverse())).toEqual({ notDeployed: [], notInRepo: [] });
  });

  it("a leftover temporary function is caught", () => {
    expect(compareFunctions(repo, [...repo, "tmp-q164-probe"]).notInRepo).toEqual(["tmp-q164-probe"]);
  });

  it("a vanished function is caught (the Q164 incident)", () => {
    expect(compareFunctions(repo, repo.filter((f) => f !== "stripe-webhook")).notDeployed).toEqual(["stripe-webhook"]);
  });

  it("db-drift-detect runs it nightly and fails the run on its failure", () => {
    const src = readFileSync(resolve(ROOT, ".github/workflows/db-drift-detect.yml"), "utf8");
    const wf = parse(src) as { jobs: Record<string, { steps: Array<{ id?: string; run?: string; env?: Record<string, string> }> }> };
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
    const step = steps.find((s) => s.run === "node scripts/check-deployed-functions.mjs");
    expect(step?.id).toBe("deployed_functions");
    expect(step?.env?.SUPABASE_ACCESS_TOKEN).toBe("${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    const fail = steps.find((s) => (s.run ?? "").includes('"${DEPLOYED_FUNCTIONS:-success}" = "failure"'));
    expect(fail?.env?.DEPLOYED_FUNCTIONS).toBe("${{ steps.deployed_functions.outcome }}");
    expect(fail?.run).toMatch(/DEPLOYED_FUNCTIONS:-success}" = "failure" \]; then\n[^\n]*\n\s*failed=1/);
  });
});
