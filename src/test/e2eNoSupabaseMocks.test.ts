import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * NO MOCK MODE, EVER (owner, 2026-09-12, said twice).
 *
 * A Playwright file that answers Supabase from `page.route()` / `route.fulfill()`
 * proves only that the mocks agree with themselves. That is the exact shape that
 * let guest browse 401 for months, kept a dead RPC dead, and described six
 * fixture rows the real database rejects — every one of them green.
 *
 * This guard is a RATCHET, not a snapshot:
 *   - a file that intercepts the Supabase origin and is NOT in BASELINE fails;
 *   - a file in BASELINE that no longer intercepts fails too, so the list can
 *     only ever shrink and a migrated spec cannot quietly regress.
 *
 * BASELINE is therefore a debt register with a fixed direction of travel. The
 * end state is `BASELINE = []` and this file becoming a plain assertion that
 * nothing under e2e/ mocks Supabase.
 *
 * Legitimate non-mock uses of route() — latency injection and a dropped request
 * in e2e/journeys/fixtures.ts's rotation profiles, which call `route.continue()`
 * — are NOT mocks and are excluded by the classifier below: a handler that only
 * delays, aborts or continues answers nothing itself.
 */

const REPO = resolve(__dirname, "../..");
const E2E = join(REPO, "e2e");

/**
 * Files that still intercept Supabase. Every line is debt.
 * Migration tracked in docs/OPEN.md ("Mocked Playwright specs -> prod").
 */
const BASELINE: string[] = [
  "happy-path/activity-card-density.spec.ts",
  "happy-path/apply-dialog-fit.spec.ts",
  "happy-path/apply-single-sheet.spec.ts",
  "happy-path/apply-sticky-overlap.spec.ts",
  "happy-path/appstore-screenshots.spec.ts",
  "happy-path/auditRoutes.ts",
  "happy-path/browse-feed-completeness.spec.ts",
  "happy-path/customer-post-job.spec.ts",
  "happy-path/customer-sees-application.spec.ts",
  "happy-path/device-pass-measure.spec.ts",
  "happy-path/earnings-length.spec.ts",
  "happy-path/earnings-views.spec.ts",
  "happy-path/empty-state-sweep.spec.ts",
  "happy-path/error-state-sweep.spec.ts",
  "happy-path/fixtures.ts",
  "happy-path/guest-feed-progressive.spec.ts",
  "happy-path/helper-apply.spec.ts",
  "happy-path/home-chrome.spec.ts",
  "happy-path/iap-review-screenshot.spec.ts",
  "happy-path/ipad-render-check.spec.ts",
  "happy-path/messages-thread.spec.ts",
  "happy-path/nav-hide-on-scroll.spec.ts",
  "happy-path/overlay-sweep.spec.ts",
  "happy-path/replaceState-churn.spec.ts",
  "happy-path/seedData.ts",
  "happy-path/seedDataHeavy.ts",
  "happy-path/stale-deploy.spec.ts",
  "happy-path/state-matrix/state-sweep.spec.ts",
  "happy-path/visual-audit-sweep.spec.ts",
  "happy-path/zz-recurring-picker.spec.ts",
  "happy-path/zz-runtime-probe.spec.ts",
  "happy-path/zz-senior-probe.spec.ts",
  "payment-lifecycle.spec.ts",
  "prod-audit/interruptions.spec.ts",
  "visual-audit/desktop-fill.spec.ts",
  "visual-audit/responsive.spec.ts",
];

/** Every .ts under e2e/, relative to e2e/. */
function allFiles(dir = E2E, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...allFiles(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out.sort();
}

/**
 * Does this file ANSWER a Supabase request itself?
 *
 * Derived from the source, never declared: a `route(` whose pattern names the
 * Supabase origin or its REST/auth/functions paths, in a file that also
 * fulfills. `route.continue()`/`abort()` alone is pass-through (slow-network
 * and dropped-write rotations), which is instrumentation, not a mock.
 */
export function mocksSupabaseOrigin(src: string): boolean {
  const routesSupabase =
    /\.route\(\s*[^)]*(supabase\.co|SUPABASE_URL|\/rest\/v1|\/auth\/v1|\/functions\/v1|\/rpc\/)/.test(src) ||
    /installSupabaseMocks|mockTable\(|mockRpc\(/.test(src);
  if (!routesSupabase) return false;
  return /route\.fulfill\(|installSupabaseMocks|mockTable\(|mockRpc\(|fulfill\(\s*\{/.test(src);
}

const files = allFiles();
const offenders = files.filter((f) => mocksSupabaseOrigin(readFileSync(join(E2E, f), "utf8")));

describe("no e2e file mocks Supabase (ratchet)", () => {
  it("the classifier can see a mock and can see a pass-through", () => {
    // Guards the guard. Without this, a broken regex reports zero offenders and
    // the whole ratchet passes for the worst possible reason.
    expect(
      mocksSupabaseOrigin(`await page.route("**/rest/v1/jobs*", (r) => r.fulfill({ body: "[]" }));`),
    ).toBe(true);
    expect(mocksSupabaseOrigin(`await ctx.route(\`\${SUPABASE_URL}/**\`, (r) => r.continue());`)).toBe(false);
    expect(mocksSupabaseOrigin(`await page.goto("/dashboard");`)).toBe(false);
  });

  it("adds no NEW Supabase mock", () => {
    const added = offenders.filter((f) => !BASELINE.includes(f));
    expect(
      added,
      `These e2e files answer Supabase from a mock and are not in the BASELINE debt list:\n` +
        added.map((f) => `  - e2e/${f}`).join("\n") +
        `\n\nOwner rule: NO MOCK MODE, EVER. Drive prod with the shared test accounts ` +
        `(getSession from e2e/journeys/fixtures.ts) and the is_seed rows from scripts/prod-seed.mjs. ` +
        `If a state cannot be seeded on prod, state the GAP in the spec — never pass quietly.`,
    ).toEqual([]);
  });

  it("the baseline only shrinks", () => {
    const stale = BASELINE.filter((f) => !offenders.includes(f));
    expect(
      stale,
      `These files are listed as mocking Supabase but no longer do:\n` +
        stale.map((f) => `  - e2e/${f}`).join("\n") +
        `\n\nDelete them from BASELINE in this file — the debt list must match reality, ` +
        `or a migrated spec can silently regress back onto mocks.`,
    ).toEqual([]);
  });

  it("reports the remaining debt, so the number is visible rather than inferred", () => {
    console.log(`\nSupabase-mocking e2e files: ${offenders.length}\n${offenders.map((f) => `  - e2e/${f}`).join("\n")}\n`);
    expect(offenders.length).toBeLessThanOrEqual(BASELINE.length);
  });
});
