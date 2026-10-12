/**
 * Every vacuity e2e leg repairs the seed fixtures before its prod-backed guards
 * run (Q1426), as prod-audit.yml does before the same specs.
 *
 * Push run 38173155817 (2026-10-11): leg 2's only guard file,
 * e2e/prod-audit/search-x-off-center-press.spec.ts, was RED before any
 * mutation. Its saved-helprs cases waited 45 s for a Search button that
 * /profile?tab=saved_helpers renders only when the poster has saved Helprs, and
 * the poster's favorite_helpers rows were re-created by the NEXT prod-audit's
 * `prod-seed.mjs --apply` (00:10:50Z), after the leg. So both registrations
 * came back INCONCLUSIVE after 20 minutes holding the shared accounts. The
 * vacuity legs never ran the repair; prod-audit's legs do.
 *
 * @mutate .github/workflows/vacuity.yml |             node scripts/audit/prod-seed.mjs --apply \|\| { sleep 10; node scripts/audit/prod-seed.mjs --apply; }\n |             echo skipped\n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { E2E_LEGS } from "../../scripts/vacuity/run.mjs";

type Step = { name?: string; run?: string; env?: Record<string, string> };
const WF = parse(readFileSync(join(__dirname, "..", "..", ".github", "workflows", "vacuity.yml"), "utf8")) as {
  jobs: Record<string, { steps?: Step[] }>;
};
const GATE = "Vacuity gate (Playwright registrations)";
const SEED = /node scripts\/audit\/prod-seed\.mjs --apply\b/;

describe("vacuity's e2e legs repair the seed fixtures before the gate (Q1426)", () => {
  const legs = Object.entries(WF.jobs).filter(([, j]) => (j.steps ?? []).some((s) => s.name === GATE));

  it("finds every leg (inventory floor)", () => {
    expect(legs.length).toBeGreaterThanOrEqual(E2E_LEGS);
  });

  it("each leg runs prod-seed --apply after the service-role key and before its gate", () => {
    const missing: string[] = [];
    for (const [name, job] of legs) {
      const steps = job.steps ?? [];
      const gate = steps.findIndex((s) => s.name === GATE);
      const key = steps.findIndex((s) => /SUPABASE_SERVICE_ROLE_KEY=/.test(s.run ?? ""));
      const seed = steps.findIndex((s) => SEED.test(s.run ?? ""));
      if (seed < 0 || seed > gate || seed < key) missing.push(`${name}: seed step ${seed}, key ${key}, gate ${gate}`);
      else {
        // The two CI-password accounts: a re-created one must get the password CI signs in with.
        expect(steps[seed].env, name).toMatchObject({
          SEED_PASSWORD_INCOMPLETE: "${{ secrets.PLAYWRIGHT_INCOMPLETE_PASSWORD }}",
          SEED_PASSWORD_ADMIN: "${{ secrets.PLAYWRIGHT_ADMIN_PASSWORD }}",
        });
      }
    }
    expect(missing).toEqual([]);
  });
});
