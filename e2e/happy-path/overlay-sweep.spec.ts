// Overlay sweep — dialogs, sheets, popovers, dropdowns, alert dialogs.
//
// WHY THIS EXISTS
// The route sweep (visual-audit-sweep.spec.ts) captures each of the 68 routes
// in its RESTING state. Anything that needs a tap to appear was invisible to
// it: ~91 components in src/ render an overlay, and exactly none of them were
// ever audited. So "0 contrast failures, 0 overflow, correct headings" was
// only ever a statement about flat pages.
//
// That gap matters more than a normal coverage hole, because overlays fail in
// ways flat pages cannot: focus not trapped, Escape not closing, the page
// behind still scrolling, a sheet's primary action under the home indicator,
// content taller than the viewport with no internal scroll, and no accessible
// name on the dialog itself. Both of the last two owner-reported UI bugs (the
// select-mode dead band, the attach sheet) were overlay bugs found by eye.
//
// APPROACH
// Hand-writing 91 open sequences would be brittle and would only ever cover
// the overlays somebody remembered to list. Instead this PROBES: on each
// route it clicks every plausible trigger, detects whether an overlay
// appeared, and runs the check set against it. Anything reachable gets
// audited, including overlays nobody wrote down.
//
// Supabase is fully mocked (installSupabaseMocks), so clicking arbitrary
// buttons cannot write to a real backend. Navigation IS possible, so the
// prober snapshots the URL and returns if a click routed away.
//
// Run:
//   RUN_OVERLAY_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path overlay-sweep
//
// IMPORTANT: kill anything on :4173 first. playwright.config.ts sets
// reuseExistingServer: !CI, so a stale preview server is reused and you will
// silently measure an old dist/.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  installSupabaseMocks,
  mockTable,
  seedAuthedSession,
} from "./fixtures";
import { ADMIN_VIEWS, catalogLandingFor } from "./auditRoutes";
import { detectButtonGeometry } from "./buttonGeometry";

const OUTPUT_DIR = "/tmp/ui-review";
mkdirSync(OUTPUT_DIR, { recursive: true });

interface OverlayFinding {
  route: string;
  trigger: string;
  kind: string;
  issues: string[];
  violations: { id: string; impact: string | null; detail: string[] }[];
}

const findings: OverlayFinding[] = [];
const probed: string[] = [];
/** requested route -> the path the router actually landed on. */
const landings: Record<string, string> = {};

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTING, not reporting.
//
// Until 2026-09-21 this file had 66 route probes and exactly ONE assertion:
// `expect(probed.length).toBeGreaterThan(0)`. Every check below — missing
// accessible name, focus not trapped, Escape not closing, background not
// scroll-locked, sub-9px text, sub-43.5px tap targets, sibling mismatch, and a
// scoped axe run at wcag2aa — could fire on all 66 routes and the run still
// exited 0, because `findings` had no consumer but a writeFileSync to /tmp.
// It is wired into ui-sweep.yml (weekly, Friday), so it had been green-on-blind
// rather than dormant, across the only audit that exists of ~91 overlays.
//
// The two mechanisms that make it a guard:
//
//   1. FINDINGS RATCHET. Today's findings are checked in as a baseline keyed by
//      route + overlay role + rule CLASS (never an array index, never a px
//      number, never button order — all three drift run to run). A key not in
//      the baseline fails the route that produced it. A baseline key that stops
//      being observed also fails, with instructions to delete it: the file may
//      only SHRINK, same direction of travel as
//      src/test/guardsDoNotDeleteSource.test.ts.
//
//   2. ROUTE BOUNCE. `probeRoute` has always captured the landed URL and used
//      it only to notice navigation DURING probing — it was never compared to
//      the route that was REQUESTED. So an alias that forwards was probed as
//      its destination and its overlays filed under the requesting route's
//      name. Same hole empty-state-sweep.spec.ts had; same fix.
// ─────────────────────────────────────────────────────────────────────────────

// Shown able to fail, one mutation per mechanism. Both act on routes inside the
// OVERLAY_SWEEP_ROUTES scope the vacuity gate sets (see scripts/vacuity/run.mjs):
// a full 66-route sweep is ~21 minutes and runPlaywright's spawn timeout is 900s,
// so an unscoped registration would score `killed` off the TIMEOUT rather than
// off the guard noticing anything.
//
// 1. the findings ratchet — strip the notification popover's only label and
//    `/home :: dialog :: no-accessible-name` appears, which is not in the
//    baseline.
// @mutate src/components/NotificationPanel.tsx | aria-labelledby={titleId} | data-unlabelled="1"
// 2. the bounce check — signed-in /browse is declared to land on /home.
//    Send it somewhere else and the sweep must notice it audited the wrong
//    screen. (It used to mutate the /settings <Navigate>; that route was
//    deleted, Q194.)
// @mutate src/components/MarketingRedirect.tsx |   to = "/home", |   to = "/jobs",

const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "overlay-sweep.baseline.json");

/**
 * Collapse one issue string to a stable rule class.
 *
 * Everything variable is stripped: pixel measurements (sub-pixel layout moves
 * them run to run), the button label inside a tap-target message, and the
 * specific colour pair inside an axe detail. What remains is "this route's
 * dialogs have no accessible name", which is the claim worth ratcheting.
 */
function ruleClass(issue: string): string {
  if (issue.startsWith("no accessible name")) return "no-accessible-name";
  if (issue.startsWith("taller than viewport")) return "taller-than-viewport-no-internal-scroll";
  if (issue.startsWith("wider than viewport")) return "wider-than-viewport";
  if (issue === "focus not moved into the overlay") return "focus-not-moved-into-overlay";
  if (issue === "background not scroll-locked") return "background-not-scroll-locked";
  if (issue.startsWith("text below")) return "text-below-9px-floor";
  if (issue.startsWith("tap target")) return "tap-target-under-43.5px";
  if (issue.startsWith("sibling buttons differ")) return "sibling-buttons-differ";
  if (issue === "Escape did not close it") return "escape-did-not-close";
  return `other: ${issue.slice(0, 48)}`;
}

/** Every stable key a finding contributes. */
function keysFor(f: OverlayFinding): string[] {
  const out = new Set<string>();
  for (const i of f.issues) out.add(`${f.route} :: ${f.kind} :: ${ruleClass(i)}`);
  for (const v of f.violations) out.add(`${f.route} :: ${f.kind} :: axe:${v.id}`);
  return [...out];
}

interface Baseline {
  keys: Record<string, string>;
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return { keys: {} };
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

const baseline = readBaseline();

/**
 * WHAT THIS RATCHET CAN AND CANNOT ASSERT — measured, not assumed.
 *
 * The prober clicks up to 40 visible buttons per route and audits whatever
 * opens. Which overlays that reaches is NOT stable. Five consecutive full
 * sweeps on an unchanging app, 2026-09-21:
 *
 *   overlay opens per run    84 / 86 / 82 / 79 / 84
 *   /posts opened         Escalate|More|SOS (runs 1,2,3,5)
 *                            Timeline & Evidence|No-Show (run 4)
 *   /availability contrast   seen on runs 1-4, absent on run 5
 *
 * Two real causes: the seeded job fixtures carry dates relative to NOW, so a
 * card's action chips depend on whether its start has passed; and the 40-button
 * cap plus click ordering changes what is reached even on an identical screen.
 *
 * That splits the ratchet, and only one half survives:
 *
 *   ADDED — strict, and sound. A finding is derived from the DOM the app
 *   actually rendered, so nondeterminism can only ever HIDE a finding, never
 *   invent one. A rule class absent from the baseline is a real defect on the
 *   run that saw it, full stop.
 *
 *   "NO LONGER REPRODUCES" — NOT assertable, and asserting it was a mistake
 *   worth recording. It is meant to claim the app changed; here it mostly
 *   reports which overlays a run happened to reach. Runs 4 and 5 each failed on
 *   it for a DIFFERENT key with no code change between them. A gate that reds
 *   for nothing is a gate people mute, and a real failure gets muted with it.
 *
 * So the shrink direction is enforced statically instead (see the `orphaned`
 * check below). Restoring the full ratchet needs a deterministic prober —
 * pinned fixture dates and a stable trigger enumeration — which lives in
 * e2e/happy-path/fixtures.ts, not here. Recorded rather than absorbed.
 */

/**
 * ROUTE BOUNCE allowlist — the sweep's own fixture-dependent half. Measured
 * 2026-09-21 by running the sweep and diffing each requested route against
 * `landings`: EIGHT of 66 routes landed somewhere else.
 *
 * Six of the eight were catalog aliases: /settings, /schedule, /earnings,
 * /availability, /saved-helprs and /saved-helpers all resolved into the
 * Profile shell, so six of this sweep's 66 "routes probed" were re-probes of
 * Profile tabs it had already probed under their own names. All six routes
 * were deleted on 2026-09-23 (Q194) and left this list with them; any alias
 * still declared on a catalog row (`redirectsTo` in auditRoutes.ts) is read
 * back through `catalogLandingFor`.
 *
 * A NEW bounce is a failure. If ProtectedRoute, AdminRoute or a router redirect
 * regresses, every route collapses onto one destination — and without this
 * check the sweep would stay green while probing one screen 66 times.
 */
const EXPECTED_LANDING: Record<string, string> = {
  // `/browse` is wrapped in <MarketingRedirect>, which sends a SIGNED-IN
  // visitor into the app (owner: once someone is signed in there should be no
  // references back to the landing site). This sweep is always signed in, so
  // its `/browse` row has never probed the browse screen's overlays — it
  // probed the dashboard's, a second time, under browse's name. Real redirect,
  // real coverage gap: the browse filter sheet is audited by nobody here.
  "/browse": "/home",

  // JobDetail forwards every signed-in visitor away. NOT to /home, which
  // is what auditRoutes.ts's comment and empty-state-sweep both say: with the
  // seeded mocks the fixture customer OWNS this job, so it lands on the poster
  // view. Both are true of their own fixture, which is why this is measured
  // here rather than inherited from the catalog.
  "/jobs/10000000-0000-4000-8000-000000000001": "/posts",
};

/**
 * Catalog aliases (`redirectsTo` in auditRoutes.ts) are the shared half and
 * are NOT repeated above. The local map holds only what depends on this
 * sweep's own fixture and session.
 */
const expectedLandingFor = (path: string): string | undefined =>
  EXPECTED_LANDING[path] ?? catalogLandingFor(path);

/** Selector matching any open overlay Radix renders. */
const OPEN_OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]';

/**
 * Routes to probe. Every route that carries interactive chrome — the static
 * legal/marketing pages are skipped because they have no triggers to click,
 * and probing them is pure wall-clock.
 */
const ROUTES = [
  "/home",
  "/posts",
  "/jobs",
  "/messages",
  "/post-job",
  "/browse",
  "/profile",
  "/profile?tab=profile",
  "/profile?tab=payment",
  "/profile?tab=security",
  "/profile?tab=credentials",
  "/profile?tab=notifications",
  "/profile?tab=subscription",
  "/profile?tab=saved_helpers",
  "/profile?tab=schedule",
  "/profile?tab=availability",
  "/profile?tab=reviews",
  "/profile?tab=warnings",
  "/profile?tab=referral",
  "/profile?tab=support",
  "/profile?tab=legal",
  "/profile?tab=earnings",
  // posted_jobs / completed_jobs were removed from the Tab union. `resolveTab`
  // (src/pages/profile/types.ts) now maps any unrecognised ?tab= to `landing`,
  // so sweeping those two URLs just probed /profile a second and third time
  // under two names that no longer exist — while `accessibility`, the tab that
  // replaced them, went unprobed. Same correction auditRoutes.ts made.
  "/profile?tab=accessibility",
  "/profile?tab=pets",
  // REMOVED 2026-09-21: "/family", "/subscription", "/job-history". None is a
  // registered route — /family is behind FAMILY_ENABLED (off), and the other
  // two had their redirect stubs deleted. All three rendered the NotFound page,
  // found no overlays on it, and were counted as three more routes probed. That
  // is the same over-count auditRoutes.ts removed from its own catalog on
  // 2026-08-22/23; this list is a SECOND catalog and kept them. The 404 screen
  // has no overlays, so nothing is lost by dropping them — and the guard in
  // src/test/auditCatalogRoutes.test.ts now fails if this list drifts again.
  "/profile?tab=analytics",
  "/profile?tab=str_settings",
  "/profile?tab=auto_tip",
  "/profile?tab=work_record",
  "/profile?tab=home_history",
  "/jobs/10000000-0000-4000-8000-000000000001",
  `/user/${FAKE_CUSTOMER.id}`,
  // Every admin ?view=, not just the default one. `/admin` alone probed the
  // `home` view, so the dialogs that actually carry risk — ban, delete user,
  // escrow release, dispute resolution — were never opened by this sweep at
  // all. Same one-entry blind spot ADMIN_SCREENS had; shared list so the two
  // cannot drift apart again.
  "/admin",
  ...ADMIN_VIEWS.map((v) => `/admin?view=${v}`),
];

/**
 * The onboarding tour is a MODAL Radix dialog that auto-opens 1.5s after load
 * for any account younger than two minutes — which every seeded sweep session
 * is. Left running it sat on top of the whole sweep and forged two findings on
 * every other overlay it coexisted with:
 *
 *   - it holds focus, so the overlay under test looked like "focus not moved
 *     into the overlay" when focus was really inside the TOUR;
 *   - it is the topmost dismissable layer, so it ate the Escape press and the
 *     overlay under test looked like "Escape did not close it".
 *
 * Both were artifacts of the test session, not app defects. Suppressing the
 * tour probes each route in its normal returning-user state. (`completed`
 * short-circuits the auto-show effect before any other branch; the dismissed_at
 * key is set too so neither the dialog nor the "Resume tour" pill appears.)
 * The tour is worth auditing on its own terms — it just cannot be audited by
 * sitting on top of everything else.
 */
async function suppressOnboardingTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "helpr_onboarding",
        JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }),
      );
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
    } catch { /* storage unavailable — tour will show and be reported */ }
  });
}

/**
 * Check an OPEN overlay. Everything here is a failure mode a screenshot
 * cannot show, which is the whole point of probing rather than capturing.
 *
 * Tags the element it judged with `data-sweep-target` so the Escape check
 * afterwards can ask "did THIS overlay close", instead of "is the document
 * free of overlays" — see probeRoute.
 */
async function checkOpenOverlay(page: Page): Promise<{ kind: string; issues: string[] }> {
  return page.evaluate((sel) => {
    const issues: string[] = [];
    // LAST match, not first. Portals append, so the last open overlay is the
    // topmost one — the one the click just opened. Reading the first match
    // judged whatever happened to be earlier in the DOM and attributed its
    // faults to this trigger.
    const all = [...document.querySelectorAll(sel)] as HTMLElement[];
    const el = all[all.length - 1] ?? null;
    if (!el) return { kind: "none", issues };
    document.querySelectorAll("[data-sweep-target]").forEach((n) => n.removeAttribute("data-sweep-target"));
    el.setAttribute("data-sweep-target", "1");

    const kind = el.getAttribute("role") ?? "popper";
    const r = el.getBoundingClientRect();

    // 1. Accessible name. A dialog announced as just "dialog" tells a screen
    //    reader user nothing about what they just opened.
    if (kind === "dialog" || kind === "alertdialog") {
      const labelled =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent?.trim());
      if (!labelled) issues.push("no accessible name (aria-label / aria-labelledby)");
    }

    // 2. Fits the viewport, or scrolls internally. A dialog taller than the
    //    screen with no internal scroll strands its own buttons off-screen.
    if (r.height > window.innerHeight + 1) {
      const cs = getComputedStyle(el);
      const scrolls =
        ["auto", "scroll"].includes(cs.overflowY) ||
        !!el.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]');
      if (!scrolls) issues.push(`taller than viewport (${Math.round(r.height)}px) with no internal scroll`);
    }
    if (r.width > window.innerWidth + 1) issues.push(`wider than viewport (${Math.round(r.width)}px)`);

    // 3. Focus must have moved inside. If it is still on the trigger, a
    //    keyboard user tabs through the PAGE BEHIND the overlay.
    //
    //    Only for overlays that are SUPPOSED to take focus. `kind === "popper"`
    //    means the topmost match was a bare [data-radix-popper-content-wrapper]
    //    carrying no role of its own — a tooltip. (A menu, listbox or popover
    //    renders a roled element INSIDE that wrapper, and document order puts
    //    the child last, so those still land in the branches above.) A tooltip
    //    must never take focus, so demanding it does inverts the rule: the
    //    /admin sidebar was reported for this when focus was correctly on the
    //    sidebar's Dashboard item and the "overlay" being judged was that
    //    item's own tooltip.
    if (kind !== "popper") {
      const active = document.activeElement;
      if (active && active !== document.body && !el.contains(active)) {
        issues.push("focus not moved into the overlay");
      }
    }

    // 4. Background scroll lock. Without it the page behind scrolls under the
    //    overlay on touch, which reads as the app coming apart.
    //    MODALS ONLY, and `role` is not how you tell. Radix gives
    //    PopoverContent `role="dialog"` as well, and a Popover is NON-modal by
    //    design: the page behind it is SUPPOSED to stay scrollable, and Radix
    //    correctly does not lock the body for one. Keyed on role, this rule
    //    reported the /user/:id badge popover (RecognitionRow.tsx) as a defect
    //    for doing exactly what a popover must do — a rule that is wrong about
    //    a whole component family is worse than no rule, because the finding it
    //    files is indistinguishable from a real one.
    //
    //    `aria-modal="true"` is the discriminator: Radix sets it on a modal
    //    Dialog/AlertDialog and not on a non-modal Popover. That is also the
    //    exact property that makes the rule's own rationale true — the page
    //    behind is unreachable, so it must not scroll.
    const bodyLocked =
      getComputedStyle(document.body).overflow === "hidden" ||
      getComputedStyle(document.documentElement).overflow === "hidden" ||
      document.body.hasAttribute("data-scroll-locked");
    if (el.getAttribute("aria-modal") === "true" && !bodyLocked) {
      issues.push("background not scroll-locked");
    }

    // 5. Text below the type floor inside the overlay.
    el.querySelectorAll("*").forEach((n) => {
      if (n.children.length === 0 && (n.textContent ?? "").trim()) {
        const fs = parseFloat(getComputedStyle(n).fontSize);
        if (fs < 9) issues.push(`text below 9px floor: ${fs}px`);
      }
    });

    // 6. Tap targets inside the overlay.
    //
    // Two exclusions, both to stop the check crying wolf:
    //
    //  - role=switch. A Radix Switch renders 51x31 — Apple's exact UISwitch
    //    geometry. It clears the WCAG 2.2 AA target-size floor (24x24) and
    //    every native iOS toggle is this size, so "fixing" it to 44 would make
    //    the app look wrong to hit a AAA number nothing else on iOS hits.
    //  - a 0.5px tolerance. Sub-pixel layout put chips at 43.6px on some runs
    //    and 44.0px on others, and the report rounded 43.6 to the nonsensical
    //    `tap target 44px`. Three /jobs category chips flapped on exactly this.
    el.querySelectorAll("button, a[href], [role=button]").forEach((n) => {
      const b = n.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      if (n.getAttribute("role") === "switch") return;
      if (b.height < 43.5 && !n.closest("p")) {
        issues.push(`tap target ${Math.round(b.height)}px: "${(n.textContent ?? "").trim().slice(0, 18)}"`);
      }
    });

    return { kind, issues };
  }, OPEN_OVERLAY);
}

async function probeRoute(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  const landed = new URL(page.url()).pathname + new URL(page.url()).search;
  // Recorded for the bounce assertion in `zz`. Everything measured below this
  // line describes `landed`, not `route`.
  landings[route] = landed;

  // Candidate triggers: every visible control. Radix triggers are plain
  // buttons, so there is no reliable attribute to filter on — aria-haspopup
  // is set by some primitives and not others.
  const count = await page.locator("#root button:visible").count();
  const max = Math.min(count, 40); // per-route cap; logged below if it bites

  for (let i = 0; i < max; i++) {
    const btn = page.locator("#root button:visible").nth(i);
    let label: string;
    try {
      label = ((await btn.textContent({ timeout: 1500 })) ?? "").trim().slice(0, 30) ||
        (await btn.getAttribute("aria-label"))?.slice(0, 30) || `button[${i}]`;
    } catch { continue; }

    try {
      await btn.click({ timeout: 2500, noWaitAfter: true });
    } catch { continue; }
    await page.waitForTimeout(320);

    const open = await page.locator(OPEN_OVERLAY).count();
    if (open === 0) {
      // Not an overlay trigger. If it navigated, go back and continue.
      const now = new URL(page.url()).pathname + new URL(page.url()).search;
      if (now !== landed) {
        await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page.waitForTimeout(350);
      }
      continue;
    }

    probed.push(`${route} :: ${label}`);
    const { kind, issues } = await checkOpenOverlay(page);

    // Sibling buttons of unequal height INSIDE the overlay. The visual sweep
    // runs this same detector on every route, but it never opens a dialog or
    // sheet, so a footer with a 56px primary beside a 44px cancel was
    // unreachable by it. Scoped to the overlay checkOpenOverlay just tagged;
    // the page behind is the visual sweep's job.
    try {
      const geometry = await page.evaluate(detectButtonGeometry, "[data-sweep-target]");
      for (const m of geometry.siblingMismatch) issues.push(`sibling buttons differ: ${m}`);
    } catch { /* overlay closed mid-scan */ }

    // axe, scoped to the open overlay.
    let violations: OverlayFinding["violations"] = [];
    try {
      const axe = await new AxeBuilder({ page })
        // The TAGGED overlay, not the OPEN_OVERLAY multi-selector.
        //
        // checkOpenOverlay deliberately judges the LAST match (portals append,
        // so the last one is the one the click just opened) and tags it
        // `data-sweep-target`. The Escape check and the geometry check both
        // already ask about that element; this scan was the one place still
        // handed the broad selector, so axe scanned whichever overlay came
        // first in the DOM — a different element than every other check in the
        // same iteration was judging.
        //
        // It made the sweep NONDETERMINISTIC, which is worse than being wrong:
        // across three consecutive full runs the /posts SOS dialog's
        // colour-contrast violation (#fdfdfd on #b95e35 = 4.37:1) appeared
        // once. Under a findings ratchet that is a phantom — a real,
        // long-standing defect that reads as a NEW regression on whichever run
        // happens to see it, which is exactly how a gate teaches people to
        // ignore it.
        .include("[data-sweep-target]")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      violations = axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        detail: v.nodes.slice(0, 2).flatMap((n) =>
          [...(n.any ?? []), ...(n.all ?? [])]
            .filter((c) => c.data && typeof c.data === "object")
            .map((c) => {
              const d = c.data as Record<string, unknown>;
              return d.contrastRatio
                ? `${String(d.fgColor)} on ${String(d.bgColor)} = ${String(d.contrastRatio)}:1 (needs ${String(d.expectedContrastRatio ?? "?")})`
                : "";
            })
            .filter(Boolean),
        ),
      }));
    } catch { /* overlay closed mid-scan */ }

    // Escape must close it. A modal you cannot dismiss from the keyboard is a
    // trap, and this is the cheapest possible check for it.
    //
    // Ask whether THIS overlay closed — the one checkOpenOverlay tagged — not
    // whether the document is now free of overlays. The old wording failed
    // whenever layers legitimately stacked: opening the admin sidebar moves
    // focus onto a nav item, that item's tooltip opens a popper on top, the
    // first Escape dismisses the tooltip (correctly — Radix dismisses the
    // topmost layer), and the sheet was reported as un-closable. Hence also the
    // repeat: a real keyboard user presses Escape again. Something that never
    // closes after three presses is a genuine trap; something that needs two
    // because a tooltip was above it is not.
    let escaped = false;
    for (let attempt = 0; attempt < 3 && !escaped; attempt++) {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(280);
      escaped = await page
        .evaluate(() => {
          const t = document.querySelector("[data-sweep-target]");
          // Gone from the DOM, or still mounted for its exit animation but no
          // longer flagged open, both count as closed.
          return !t || t.getAttribute("data-state") === "closed" || !(t as HTMLElement).isConnected;
        })
        .catch(() => true);
    }
    if (!escaped) {
      issues.push("Escape did not close it");
      // Force it shut so the next trigger is testable.
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(350);
    }

    if (issues.length || violations.length) {
      findings.push({ route, trigger: label, kind, issues, violations });
    }
  }
}

/**
 * Scope the sweep to a few routes. Comma-separated substrings.
 *
 * Exists for the vacuity gate. `scripts/vacuity/run.mjs` spawns a mutated spec
 * with a 900s timeout and a full sweep is ~22 minutes, so spawnSync would kill
 * it, the run would exit non-zero, and a non-zero run under mutation is scored
 * `killed` — a green verdict manufactured out of a timeout, with the guard
 * having noticed nothing. The assertion path is identical at 2 routes and 66.
 *
 * Safe for both assertions: the added half only ever judges what it saw, and the
 * orphaned half is computed from ROUTES (the full list), not from what ran.
 */
const ROUTE_FILTER = process.env.OVERLAY_SWEEP_ROUTES;
const SWEPT = ROUTE_FILTER
  ? ROUTES.filter((r) => ROUTE_FILTER.split(",").some((f) => r.includes(f.trim())))
  : ROUTES;
const sweepDescribe = process.env.RUN_OVERLAY_SWEEP ? test.describe : test.describe.skip;

test.describe.configure({ mode: "serial" });

sweepDescribe("overlay sweep", () => {
  test.afterAll(() => {
    const observed: Record<string, string> = {};
    for (const f of findings) {
      for (const k of keysFor(f)) {
        if (!observed[k]) observed[k] = `${f.trigger} — ${[...f.issues, ...f.violations.map((v) => `axe:${v.id}`)][0] ?? ""}`;
      }
    }
    writeFileSync(
      resolve(OUTPUT_DIR, "overlay-report.json"),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), probed, landings, observedKeys: observed, findings },
        null,
        2,
      ),
    );
  });

  for (const route of SWEPT) {
    test(`probe ${route}`, async ({ context, page, baseURL }) => {
      test.setTimeout(180_000);
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await suppressOnboardingTour(page);
      await installSupabaseMocks(page, {
        user: FAKE_CUSTOMER,
        seed: true,
        rules: route.startsWith("/admin") ? [mockTable("user_roles", [{ role: "admin" }])] : [],
      });
      await probeRoute(page, route);
    });
  }

  // The three assertions the file spent its life without. They run LAST and
  // over the whole sweep on purpose: `mode: serial` skips the rest of a describe
  // after the first failure, so asserting inside each route test would have let
  // one new finding on /home hide the other 65 routes.
  test("zz probed something", () => {
    expect(probed.length).toBeGreaterThan(0);
  });

  test("zz every route audited the route that was requested", () => {
    const bounced = Object.entries(landings)
      .map(([route, landed]) => {
        const requestedPath = route.split("?")[0];
        const landedPath = landed.split("?")[0];
        if (!landedPath || landedPath === requestedPath) return null;
        const allowed = expectedLandingFor(requestedPath);
        if (!allowed) return `${route} -> ${landed}`;
        // Compare at the granularity the expectation was WRITTEN at. Six of the
        // seven Profile aliases forward to a specific `?tab=`, and comparing
        // path-only there would accept /earnings landing on the Schedule tab —
        // a wrong redirect reading as a correct one. (empty-state-sweep is
        // path-only because every other measurement it takes is.)
        const ok = allowed.includes("?") ? landed === allowed : landedPath === allowed;
        return ok ? null : `${route} -> ${landed} (expected ${allowed})`;
      })
      .filter(Boolean);
    expect(
      bounced,
      `ROUTE_BOUNCE: these routes were probed, but the overlays found belong to a\n` +
        `DIFFERENT screen — the router forwarded before a single button was clicked.\n` +
        `Every finding filed under the requested name actually describes the landing\n` +
        `page. If the redirect is correct, add it to EXPECTED_LANDING with the reason;\n` +
        `if it is not, the redirect is the bug.\n  ${bounced.join("\n  ")}`,
    ).toEqual([]);
  });

  test("zz no overlay finding outside the checked-in baseline", () => {
    const observed = new Set<string>();
    for (const f of findings) for (const k of keysFor(f)) observed.add(k);

    const added = [...observed].filter((k) => !(k in baseline.keys)).sort();
    const example = (k: string) =>
      findings.find((f) => keysFor(f).includes(k))?.trigger ?? "?";
    expect(
      added.map((k) => `${k}  (trigger: ${example(k)})`),
      `NEW OVERLAY FINDINGS. Each line is a route + overlay role + rule that was\n` +
        `not failing when ${BASELINE_PATH.split("/").pop()} was recorded. Fix the overlay;\n` +
        `adding the key to the baseline is only correct when you have shown the\n` +
        `finding is not a defect, and it is a regression in this guard either way.\n` +
        `Full detail: ${OUTPUT_DIR}/overlay-report.json`,
    ).toEqual([]);

    // The shrink direction, enforced on the one thing here that IS
    // deterministic: a baseline key naming a route this sweep no longer probes
    // describes nothing and can never be re-checked, so it is dead weight. See
    // the note beside the baseline for why "no longer reproduces" is NOT
    // asserted — on a prober this nondeterministic it reports which overlays a
    // run happened to reach, not whether anything was fixed.
    const probedRoutes = new Set<string>(ROUTES);
    const orphaned = Object.keys(baseline.keys)
      .filter((k) => !probedRoutes.has(k.split(" :: ")[0]))
      .sort();
    expect(
      orphaned,
      `ORPHANED BASELINE ENTRIES: these name a route this sweep does not probe\n` +
        `any more, so nothing can ever confirm or clear them. Delete them from\n` +
        `${BASELINE_PATH.split("/").pop()} — the file is a record of what is actually\n` +
        `broken, and an entry nothing can re-check is just a permission slip.`,
    ).toEqual([]);
  });
});
