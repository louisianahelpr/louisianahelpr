// @mutate e2e/prod-audit/fundedApplicantJob.ts | await api.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, {\n          headers: headers(poster),\n          data: { p_job_id: r.id, p_reason: "prod-audit fixture teardown" }, | await api.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${r.id}&select=id`, {\n          headers: headers(poster),\n          data: { status: "cancelled" },
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Prod refuses a direct `jobs.status = 'cancelled'` write (42501: "Jobs may
 * only be cancelled through a cancellation RPC"). On 2026-09-24 the prod-audit
 * applicant fixture still PATCHed it and the whole prod-audit run went red.
 * Class: no harness code that talks to the live REST API may PATCH a job to
 * cancelled; it calls poster_cancel_job / helper_cancel_booking /
 * create-payment cancel_escrow like the app does.
 */
const ROOT = resolve(__dirname, "..", "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs|js)$/.test(n) ? [p] : [];
  });
}

describe("harness code never PATCHes a job to cancelled", () => {
  const patches: { file: string; call: string }[] = [];
  for (const file of [...walk(join(ROOT, "e2e")), ...walk(join(ROOT, "scripts"))]) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.patch\(\s*`[^`]*\/rest\/v1\/jobs\?[^`]*`[\s\S]{0,400}?\n\s*\}\s*\)/g)) patches.push({ file, call: m[0] });
  }

  it("finds the job PATCH calls it checks", () => {
    expect(patches.length).toBeGreaterThan(0);
  });

  it("none of them sets status to cancelled", () => {
    const bad = patches.filter((p) => /status:\s*["']cancelled["']/.test(p.call)).map((p) => p.file.slice(ROOT.length + 1));
    expect(bad).toEqual([]);
  });
});
