// The UI audit evidence sweep against PRODUCTION, in Chromium and in WebKit.
//
// WHY A SECOND SWEEP
// ------------------
// visual-audit-sweep.spec.ts runs the same capture against a local preview
// with every Supabase call mocked. The owner's standing order (2026-09-12,
// CLAUDE.md "NO MOCK MODE, EVER") is that mocked results do not count as
// verification, and the axe gate only ever ran in Chromium while every iPhone
// user gets WKWebView. This spec is that gap closed: the deployed site, the
// real backend, the two shared E2E accounts (plus the admin account when its
// secret is present), and two engines — the `a11y-prod` (Chromium, 375) and
// `a11y-prod-webkit` (real WebKit, iPhone 13) projects in playwright.config.ts.
//
// WHAT IT CHECKS
// --------------
// Exactly what the mocked sweep checks, through the SAME code — sweepCore.ts
// (captureScreen + assertSweepGate): axe wcag2a/2aa/21a/21aa, the composited
// colour-contrast resolver against knownContrastFailures.ts, error-boundary
// and blank-screen detection, button geometry, new-tab destinations, layout
// overflow, console noise. One report per engine so the two can be diffed:
// scripts/audit/a11y-engine-diff.mjs lists what only WebKit reports.
//
// WHAT IS DIFFERENT FROM THE MOCKED SWEEP
// ---------------------------------------
//   - Screens keyed to FIXTURE ids (six seeded job-detail states, the fake
//     profile ids) cannot exist on prod. Those are replaced by one real open
//     job from `open_jobs_browse` (as anon) and the two accounts' own /user
//     pages; the rest of the catalog is imported unchanged from auditRoutes.
//   - `rules`/`extraSetup` are mock plumbing and are ignored here, except that
//     a screen whose extraSetup drives the UI (dashboard map) still runs it.
//   - Read-only. Nothing is posted, applied to, paid or deleted; the accounts
//     are only signed in and looked at, so the two engines may run in
//     parallel without the shared-account concurrency group.
//
// Run (CI: .github/workflows/a11y-webkit-prod.yml):
//   npx playwright test --project=a11y-prod-webkit
//   SWEEP_OUTPUT_DIR=/tmp/a11y-prod/webkit npx playwright test --project=a11y-prod-webkit
// Locally, sessions are minted from .env by scripts/test-signin-link.mjs; in CI
// from the PLAYWRIGHT_*_EMAIL/_PASSWORD secrets (see e2e/journeys/fixtures.ts).

import { test, type Browser, type BrowserContext } from "@playwright/test";
import { ADMIN_SCREENS, ANON_SCREENS, AUTHED_SCREENS, type ScreenSpec } from "../happy-path/auditRoutes";
import { VARIANTS, captureScreen, writeReport, inScope, assertSweepGate, OUTPUT_DIR, reportMeta } from "../happy-path/sweepCore";
import { ANON, AUTH_STORAGE_KEY, SUPABASE_URL, getSession, optionalSession, sessionsAvailable, type Session } from "../journeys/fixtures";

const FIXTURE_ID = /10000000-0000-4000-8000-/;

/**
 * A context signed in (or not) BEFORE first paint, with the onboarding tour
 * dismissed — the same seeding e2e/journeys/fixtures.ts newUserContext does,
 * but on the project's own device (iPhone 13 for WebKit) rather than a fixed
 * 390 viewport, because the variant sets the viewport itself.
 */
async function sweepContext(browser: Browser, session: Session | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        if (val && !window.sessionStorage.getItem("__sweep_seeded")) {
          window.localStorage.setItem(key, val);
          window.sessionStorage.setItem("__sweep_seeded", "1");
        }
      } catch {
        /* storage blocked: the screen renders signed out and the capture says so */
      }
    },
    { key: AUTH_STORAGE_KEY, val: session ? JSON.stringify(session) : "" },
  );
  return ctx;
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  writeReport();
});

test.describe("UI audit evidence sweep (prod)", () => {
  let poster: Session;
  let helper: Session;
  let admin: Session | null = null;
  let incomplete: Session | null = null;
  /** Real ids resolved from prod at start, replacing the fixture ids. */
  let realJobId: string | null = null;

  test.beforeAll(async ({ request, baseURL }) => {
    const avail = sessionsAvailable();
    if (!avail.ok) throw new Error(`prod sweep cannot sign in: ${avail.why}`);
    // FAIL FAST if the site is not serving — see the mocked sweep's beforeAll.
    const res = await request.get(baseURL ?? "/", { timeout: 20_000 }).catch((e: Error) => e);
    if (res instanceof Error || !res.ok()) {
      throw new Error(`Deployed site at ${baseURL} is not serving (${res instanceof Error ? res.message : `HTTP ${res.status()}`}).`);
    }
    poster = await getSession(request, "poster");
    helper = await getSession(request, "helper");
    // Optional seed accounts (scripts/audit/prod-seed.mjs): minted locally,
    // password secrets in CI; when neither exists their screens SKIP visibly.
    admin = await optionalSession(request, "admin");
    incomplete = await optionalSession(request, "incomplete");

    // One real, currently-open job — what the public sees on /browse. Anon
    // read of the same view the app uses; no id is assumed.
    const jobs = await request.get(`${SUPABASE_URL}/rest/v1/open_jobs_browse?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (jobs.ok()) {
      const rows = (await jobs.json()) as { id: string }[];
      realJobId = rows[0]?.id ?? null;
    }
    // The engine goes into the report so scripts/audit/a11y-engine-diff.mjs
    // can tell the two apart without trusting a directory name.
    reportMeta.engine = test.info().project.name;
    reportMeta.baseURL = baseURL ?? "";
    console.log(`prod sweep: engine=${reportMeta.engine} out=${OUTPUT_DIR} job=${realJobId ?? "none"} admin=${admin ? "yes" : "no"} incomplete=${incomplete ? "yes" : "no"}`);
  });

  /** The authed catalog with fixture-keyed screens swapped for real prod ids. */
  function authedScreens(me: Session, other: Session): ScreenSpec[] {
    const out: ScreenSpec[] = [];
    for (const s of AUTHED_SCREENS) {
      if (s.seededOnly) continue;
      if (s.name === "job-detail-1") {
        if (realJobId) out.push({ name: "job-detail", url: `/jobs/${realJobId}` });
        continue;
      }
      // Swept under the incomplete seed account below; for these two the gate
      // redirects to /dashboard (their profiles are complete).
      if (s.name === "complete-profile-incomplete") continue;
      if (s.name === "user-profile") { out.push({ name: "user-profile", url: `/user/${other.user.id}` }); continue; }
      if (s.name === "user-profile-customer") { out.push({ name: "user-profile-self", url: `/user/${me.user.id}` }); continue; }
      if (FIXTURE_ID.test(s.url) && !/dead/.test(s.url)) continue;
      out.push({ name: s.name, url: s.url, extraSetup: s.extraSetup });
    }
    return out;
  }

  let index = 0;

  for (const v of VARIANTS) {
    for (const screen of inScope(ANON_SCREENS)) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (anon/${v.tag})`, async ({ browser }) => {
        const ctx = await sweepContext(browser, null);
        const page = await ctx.newPage();
        try {
          await captureScreen(page, i, screen.name, screen.url, "anon", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  const ROLES = [
    { tag: "customer", me: () => poster, other: () => helper },
    { tag: "helper", me: () => helper, other: () => poster },
  ] as const;

  for (const v of VARIANTS) {
    for (const role of ROLES) {
      // The catalog is built lazily (sessions exist only after beforeAll), but
      // test titles must exist at collection time — so iterate the static list
      // and resolve each screen inside the test.
      for (const spec of inScope(AUTHED_SCREENS.filter((s) => !s.seededOnly && s.name !== "complete-profile-incomplete"))) {
        const i = ++index;
        test(`${String(i).padStart(3, "0")} ${role.tag}-${spec.name} (${role.tag}/${v.tag})`, async ({ browser }) => {
          const screen = authedScreens(role.me(), role.other()).find(
            (s) => s.name === spec.name || (spec.name === "job-detail-1" && s.name === "job-detail") ||
              (spec.name === "user-profile-customer" && s.name === "user-profile-self"),
          );
          test.skip(!screen, `${spec.name}: keyed to a fixture id that does not exist on prod`);
          const ctx = await sweepContext(browser, role.me());
          const page = await ctx.newPage();
          try {
            await captureScreen(page, i, `${role.tag}-${screen!.name}`, screen!.url, "authed", screen!.extraSetup ? () => screen!.extraSetup!(page) : undefined, v);
          } finally {
            await ctx.close();
          }
        });
      }
    }
  }

  // /complete-profile only renders for a profile the Big-7 gate rejects — the
  // `incomplete` seed account (no avatar, not legacy). Both owner-found bugs
  // of 2026-09-12 lived on this screen.
  for (const v of VARIANTS) {
    const screen = inScope(AUTHED_SCREENS).find((s) => s.name === "complete-profile-incomplete");
    if (!screen) continue;
    const i = ++index;
    test(`${String(i).padStart(3, "0")} ${screen.name} (incomplete/${v.tag})`, async ({ browser }) => {
      test.skip(!incomplete, "PLAYWRIGHT_INCOMPLETE_EMAIL/_PASSWORD not set — /complete-profile not swept on prod");
      const ctx = await sweepContext(browser, incomplete);
      const page = await ctx.newPage();
      try {
        await captureScreen(page, i, screen.name, screen.url, "authed", undefined, v);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const v of VARIANTS) {
    for (const screen of inScope(ADMIN_SCREENS)) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (admin/${v.tag})`, async ({ browser }) => {
        test.skip(!admin, "PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD not set — admin surface not swept on prod");
        const ctx = await sweepContext(browser, admin);
        const page = await ctx.newPage();
        try {
          await captureScreen(page, i, screen.name, screen.url, "authed", undefined, v);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  // THE GATE — identical to the mocked sweep's (sweepCore.assertSweepGate).
  test("zz gate: every screen rendered and axe is clean", () => {
    assertSweepGate(test.info());
  });
});
