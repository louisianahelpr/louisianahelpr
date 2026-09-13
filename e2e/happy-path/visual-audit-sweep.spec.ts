// Pre-TestFlight visual + a11y evidence sweep.
//
// Captures screenshots + axe-core violation reports for ~40 key screens at
// the iPhone-13 viewport (375x812), across anon / authed-customer /
// authed-helper roles. Outputs to /tmp/ui-review/:
//   - <N>-<slug>.png       (one per screen)
//   - a11y-report.json     (per-screen violation summary)
//
// Read-only: no app code is modified. Network calls to Supabase are mocked
// with empty arrays via installSupabaseMocks(); authed routes use a
// pre-seeded session via seedAuthedSession() so we don't have to drive the
// multi-step Signup form.
//
// Screens are declared as data (ANON_SCREENS / CUSTOMER_SCREENS /
// HELPER_SCREENS) and registered in a loop, so adding coverage is a
// one-line edit. Indices are assigned sequentially across all groups.
//
// This produces evidence (screenshots + an a11y JSON report) AND gates on it:
// the final `zz gate` test fails the run if any screen failed to render, if
// axe reported ANY wcag2a/2aa/21a/21aa violation, or if a colour-contrast
// result comes back below AA or undecided. It used to record
// `totalViolations` and assert nothing, which is how a real 1.92:1 contrast
// failure sat green in it — and even after that was fixed, contrast itself was
// still invisible, because axe files every contrast result on a gradient
// canvas under `incomplete` rather than `violations`. Run it on demand with:
//   RUN_VISUAL_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path visual-audit-sweep
//
// Spec lives under e2e/happy-path/ because the playwright.config.ts
// happy-path project already wires the 375x812 viewport, mobile UA, and
// the vite-preview webServer block. (The mission spec said "e2e/visual-audit/"
// but the file MUST be under happy-path/ for the preview server + mobile
// viewport to apply; symlink or move discouraged because the chromium
// project explicitly testIgnore's /happy-path/.)

import {
  test,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
} from "./fixtures";
// Route catalog is shared with empty-state-sweep.spec.ts — see auditRoutes.
import { ADMIN_SCREENS, ANON_SCREENS, AUTHED_SCREENS } from "./auditRoutes";
// The capture, the report and the gate now live in sweepCore.ts so the prod
// sweep (e2e/a11y-prod) runs the identical checks. See its header.
import { VARIANTS, captureScreen, writeReport, inScope, assertSweepGate } from "./sweepCore";

test.afterAll(() => {
  writeReport();
});

test.describe.configure({ mode: "serial" });

// Evidence sweep: opt-in only (see header). CI skips it; run locally with
// RUN_VISUAL_SWEEP=1.
const sweepDescribe = process.env.RUN_VISUAL_SWEEP ? test.describe : test.describe.skip;

// SWEEP_SEED=heavy: answer from the stress seed (e2e/happy-path/seedDataHeavy.ts:
// very long names, 40+ applicants, 100+ jobs, a 200+ message thread, huge money).
// Unset → the normal seed, exactly as before.
const SWEEP_SEED: true | "heavy" = process.env.SWEEP_SEED === "heavy" ? "heavy" : true;

sweepDescribe("UI audit evidence sweep", () => {
  // FAIL FAST when there is nothing to sweep. Without this, a local run with no
  // preview server reported "147 passed" in 15 seconds: each screen's error is
  // caught and recorded, so only the final gate noticed, and the per-screen
  // lines all read green. A beforeAll failure in a serial describe fails every
  // test with the real reason.
  test.beforeAll(async ({ request, baseURL }) => {
    const res = await request.get(baseURL ?? "/", { timeout: 15_000 }).catch((e: Error) => e);
    if (res instanceof Error || !res.ok()) {
      throw new Error(
        `Preview server at ${baseURL} is not serving (${res instanceof Error ? res.message : `HTTP ${res.status()}`}). ` +
          "Run `npm run build` and let playwright.config.ts's webServer start it, or start `vite preview` on that port.",
      );
    }
  });

  // Each test owns one screen — Playwright's per-test timeout from the
  // global config applies; the catch in captureScreen flags a screen
  // failed and the next one still runs.
  let index = 0;

  for (const v of VARIANTS) {
    for (const screen of inScope(ANON_SCREENS)) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (anon/${v.tag})`, async ({ page }) => {
        await installSupabaseMocks(page, { seed: SWEEP_SEED, rules: screen.rules });
        await captureScreen(page, i, screen.name, screen.url, "anon", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
      });
    }
  }

  // The exhaustive matrix: every authed screen under BOTH roles.
  const ROLES = [
    { tag: "customer", user: FAKE_CUSTOMER },
    { tag: "helper", user: FAKE_HELPER },
  ] as const;

  for (const v of VARIANTS) {
    for (const role of ROLES) {
      for (const screen of inScope(AUTHED_SCREENS)) {
        const i = ++index;
        const name = `${role.tag}-${screen.name}`;
        test(`${String(i).padStart(3, "0")} ${name} (${role.tag}/${v.tag})`, async ({ context, page, baseURL }) => {
          await seedAuthedSession(context, role.user, baseURL ?? "");
          await installSupabaseMocks(page, { user: role.user, rules: screen.rules, seed: SWEEP_SEED });
          await captureScreen(page, i, name, screen.url, "authed", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
        });
      }
    }
  }

  // Admin (role-elevated customer).
  for (const v of VARIANTS) {
    for (const screen of inScope(ADMIN_SCREENS)) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (admin/${v.tag})`, async ({ context, page, baseURL }) => {
        await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
        await installSupabaseMocks(page, { user: FAKE_CUSTOMER, rules: screen.rules, seed: SWEEP_SEED });
        await captureScreen(page, i, screen.name, screen.url, "authed", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
      });
    }
  }

  // THE GATE — see assertSweepGate in sweepCore.ts for what fails the run and
  // why it asserts once, here, instead of per screen (this describe is serial).
  test("zz gate: every screen rendered and axe is clean", () => {
    assertSweepGate(test.info());
  });
});
