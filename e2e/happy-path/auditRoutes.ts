/**
 * Shared route catalog + mechanical layout measurement for the audit sweeps.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * There are now two sweeps over the SAME surface:
 *
 *   - visual-audit-sweep.spec.ts   — seeded (populated) screens, evidence only
 *   - empty-state-sweep.spec.ts    — every collection empty, assertions
 *
 * If each kept its own route list they would drift the moment someone adds a
 * route to one of them, and the drift is silent: the sweep still passes, it
 * just stops looking at the new screen. So the route catalog and the
 * `measureLayout()` probe live here and both specs import them. Adding a route
 * is still a one-line edit; it just covers both sweeps now.
 *
 * Nothing in this file registers a Playwright test — it is a plain module, so
 * importing it does not duplicate anyone's tests.
 */

import type { Page } from "@playwright/test";
import { FAKE_CUSTOMER, FAKE_HELPER, mockTable, type MockSupabaseOptions } from "./fixtures";

type MockRules = NonNullable<MockSupabaseOptions["rules"]>;

export interface ScreenSpec {
  name: string;
  url: string;
  extraSetup?: (page: Page) => Promise<void>;
  // Extra REST/RPC overrides layered on top of the per-role defaults.
  // Used for screens that need a different mock shape (e.g. admin needs
  // user_roles to report role=admin so AdminRoute doesn't redirect).
  rules?: MockRules;
  /**
   * Routes whose whole point is the SEEDED data — six job-detail ids that each
   * exercise a different `job_status` branch, for instance. With every table
   * empty they all collapse onto the identical "job not found" screen, so the
   * empty-state sweep would audit the same rendering six times and report six
   * copies of any finding. Marked here rather than maintaining a second list.
   */
  seededOnly?: boolean;
}

/**
 * Toggle the dashboard map view. The control has been a Tabs/Switch/Button
 * across iterations, so we probe several selector variants. Returns false when
 * no candidate matched, so the caller can note it rather than silently
 * auditing the un-toggled screen twice.
 */
export async function toggleDashboardMap(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("tab", { name: /map/i }).first(),
    page.getByRole("button", { name: /map/i }).first(),
    page.getByRole("switch", { name: /map/i }).first(),
    page.locator("[data-testid='map-toggle']").first(),
    page.getByLabel(/map view/i).first(),
  ];
  for (const c of candidates) {
    try {
      if (await c.count()) {
        await c.click({ timeout: 2_000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * One open job as the RLS-public `open_jobs_browse` view serves it, so the
 * guest job preview at `/jobs/:id` can be audited in its POPULATED state.
 * Only the columns JobDetail.tsx selects are present — anything else the view
 * exposes is masked from guests anyway. `date_needed` is a Postgres DATE, so
 * it must be "YYYY-MM-DD": a full ISO timestamp makes the dialog's date math
 * throw and the page falls into its error boundary.
 */
const GUEST_PREVIEW_JOB = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Help me move a couch up one flight",
  description: "Sofa and two chairs from the truck into a second-floor apartment. Should take about an hour.",
  category: "moving",
  budget: 120,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00",
  location: "New Orleans, LA",
  customer_id: "33333333-3333-4333-8333-333333333333",
  status: "open",
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_urgent: false,
  urgent_fee: 0,
  is_recurring: false,
  is_group_job: false,
  helpers_needed: 1,
  estimated_hours: 1,
  special_requirements: null,
  photos: [],
  boost_expires_at: null,
  // Must be in the future: JobDetail treats an elapsed `expires_at` as "no
  // longer browsable" and renders the not-found branch instead.
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  recurrence_interval: null,
  pricing_mode: "fixed",
};

// Public / unauthenticated surfaces. Every non-redirect anon route in
// src/App.tsx, plus the catch-all NotFound.
export const ANON_SCREENS: ScreenSpec[] = [
  { name: "landing", url: "/" },
  { name: "signup", url: "/signup" },
  { name: "login", url: "/login" },
  { name: "forgot-password", url: "/forgot-password" },
  { name: "reset-password", url: "/reset-password" },
  { name: "signup-pending", url: "/signup-pending" },
  { name: "account-pending", url: "/account-pending" },
  { name: "account-denied", url: "/account-denied" },
  { name: "account-banned", url: "/account-banned" },
  { name: "for-business", url: "/for-business" },
  { name: "legal-terms", url: "/legal?tab=terms" },
  { name: "legal-privacy", url: "/legal?tab=privacy" },
  { name: "legal-community", url: "/legal?tab=community" },
  // Public marketing / info routes — added 2026-08-15 with the coverage audit
  // (see the note in AUTHED_SCREENS). These are reachable without a session,
  // so they are the routes a stranger and a search crawler actually hit.
  { name: "help", url: "/help" },
  { name: "support", url: "/support" },
  { name: "accessibility", url: "/accessibility" },
  { name: "how-it-works", url: "/how-it-works" },
  { name: "become-a-partner", url: "/become-a-partner" },
  { name: "benefits", url: "/benefits" },
  { name: "community", url: "/community" },
  { name: "enterprise", url: "/enterprise" },
  { name: "evacuation", url: "/evacuation" },
  { name: "gift-card", url: "/gift-card" },
  { name: "impact", url: "/impact" },
  { name: "local-guide", url: "/local-guide" },
  { name: "parishes", url: "/parishes" },
  { name: "parish-orleans", url: "/parish/orleans" },
  // Slug variants: a two-word parish (hyphen), a saint-prefixed one, and a
  // slug that does not exist. Punctuation and unknown slugs are where a
  // params-driven page throws or renders a blank title.
  { name: "parish-east-baton-rouge", url: "/parish/east-baton-rouge" },
  { name: "parish-st-tammany", url: "/parish/st-tammany" },
  { name: "parish-unknown", url: "/parish/not-a-real-parish" },
  { name: "browse-jobs", url: "/browse-jobs" },
  { name: "privacy", url: "/privacy" },
  { name: "terms", url: "/terms" },
  { name: "rules", url: "/rules" },
  { name: "data-rights", url: "/data-rights" },
  { name: "browse-guest", url: "/browse" },
  // The GUEST job preview — the page a shared `/jobs/{id}?ref=share` link opens.
  //
  // Added 2026-08-17. This is the only way JobDetail is ever rendered:
  // src/pages/JobDetail.tsx:79 returns `<Navigate to="/dashboard?quickApply=…">`
  // for any signed-in user, so the seven `/jobs/*` entries in AUTHED_SCREENS all
  // land on the dashboard and JobDetail itself had ZERO coverage in either
  // sweep, despite the catalog claiming six job-status variants. Verified from
  // the empty-state sweep's `landedOn` field, which is why that field exists.
  // …and the two entries below must render DIFFERENT branches, which they did
  // not until 2026-08-17. Neither sweep's default mocks cover
  // `open_jobs_browse` (the RLS-public masked view JobDetail reads), so the
  // fetch came back empty for BOTH ids and both rows audited the identical
  // "This job isn't available." screen — the populated branch, which is what a
  // shared link actually opens, was measured zero times. The rule below gives
  // the first id a real row so `job-detail-guest` audits the job, while
  // `…-dead` keeps its unmocked miss and stays the not-found case.
  {
    name: "job-detail-guest",
    url: "/jobs/10000000-0000-4000-8000-000000000001",
    // A single object, not an array: the page reads it with `.maybeSingle()`.
    rules: [mockTable("open_jobs_browse", GUEST_PREVIEW_JOB)],
  },
  { name: "job-detail-guest-missing", url: "/jobs/10000000-0000-4000-8000-00000000dead" },
  { name: "not-found", url: "/this-route-does-not-exist" },
];

// Authenticated surfaces. EVERY protected route in src/App.tsx + EVERY one
// of the 18 Profile tabs (see Tab union in src/pages/Profile.tsx). Each of
// these is captured under BOTH the customer and helper roles, since the
// same route renders different content per role (earnings/schedule/
// availability/credentials are helper-rich; payment/subscription/saved-
// helpers are customer-rich) — so this is the exhaustive matrix.
export const AUTHED_SCREENS: ScreenSpec[] = [
  { name: "dashboard", url: "/dashboard" },
  {
    name: "dashboard-map",
    url: "/dashboard",
    extraSetup: async (page) => {
      await toggleDashboardMap(page);
    },
  },
  { name: "my-posts", url: "/my-posts" },
  { name: "my-jobs", url: "/my-jobs" },
  { name: "jobs", url: "/jobs" },
  { name: "messages", url: "/messages" },
  { name: "post-job", url: "/post-job" },
  { name: "payment-success", url: "/payment-success" },
  { name: "complete-profile", url: "/complete-profile" },
  { name: "business-team", url: "/business/team" },
  { name: "user-profile", url: `/user/${FAKE_HELPER.id}` },
  // All 18 Profile tabs.
  { name: "profile-landing", url: "/profile" },
  { name: "profile-edit", url: "/profile?tab=profile" },
  { name: "profile-earnings", url: "/profile?tab=earnings" },
  { name: "profile-schedule", url: "/profile?tab=schedule" },
  { name: "profile-availability", url: "/profile?tab=availability" },
  { name: "profile-payment", url: "/profile?tab=payment" },
  { name: "profile-security", url: "/profile?tab=security" },
  { name: "profile-legal", url: "/profile?tab=legal" },
  { name: "profile-reviews", url: "/profile?tab=reviews" },
  { name: "profile-referral", url: "/profile?tab=referral" },
  { name: "profile-subscription", url: "/profile?tab=subscription" },
  { name: "profile-support", url: "/profile?tab=support" },
  { name: "profile-notifications", url: "/profile?tab=notifications" },
  { name: "profile-posted-jobs", url: "/profile?tab=posted_jobs" },
  { name: "profile-completed-jobs", url: "/profile?tab=completed_jobs" },
  { name: "profile-warnings", url: "/profile?tab=warnings" },
  { name: "profile-credentials", url: "/profile?tab=credentials" },
  { name: "profile-saved-helpers", url: "/profile?tab=saved_helpers" },

  // ── Routes added 2026-08-15 after a coverage audit ────────────────────────
  // The sweep reported "75 screens" but that counted theme/role VARIANTS, not
  // distinct routes — it was actually reaching 26 of the router's 68 paths.
  // A headline screen count that flatters coverage is worse than no count, so
  // every remaining route is enumerated here. Dynamic segments get concrete
  // fixture values; a route that redirects (many of these do, depending on
  // profile state) still gets audited, just as whatever it lands on.
  { name: "activity", url: "/activity" },
  { name: "analytics", url: "/analytics" },
  { name: "auto-tip", url: "/auto-tip" },
  { name: "availability", url: "/availability" },
  { name: "earnings", url: "/earnings" },
  { name: "family", url: "/family" },
  { name: "family-accept", url: "/family/accept/test-invite-token" },
  { name: "family-accept-empty", url: "/family/accept/" },
  { name: "home-history", url: "/home-history" },
  { name: "job-history", url: "/job-history" },
  // ⚠ These seven `/jobs/*` rows do NOT audit JobDetail. JobDetail.tsx:79
  // redirects every SIGNED-IN visitor to `/dashboard?quickApply={id}` by
  // design (the dashboard owns the apply flow), so all seven land on the
  // dashboard and audit it a seventh time. The intent below — one row per
  // job_status so cancelled/disputed/in-progress each get looked at — has
  // never actually happened. They are kept because the redirect itself is a
  // contract worth regressing on, and because they cost nothing under
  // `seededOnly`; the page they were meant to cover is now audited as
  // `job-detail-guest` in ANON_SCREENS, which is the only role that renders it.
  { name: "job-detail-1", url: "/jobs/10000000-0000-4000-8000-000000000001" },
  { name: "job-detail-2", url: "/jobs/10000000-0000-4000-8000-000000000002", seededOnly: true },
  { name: "job-detail-3", url: "/jobs/10000000-0000-4000-8000-000000000003", seededOnly: true },
  { name: "job-detail-4", url: "/jobs/10000000-0000-4000-8000-000000000004", seededOnly: true },
  { name: "job-detail-5", url: "/jobs/10000000-0000-4000-8000-000000000005", seededOnly: true },
  { name: "job-detail-6", url: "/jobs/10000000-0000-4000-8000-000000000006", seededOnly: true },
  // A job id that does not exist — the not-found branch is a real screen and
  // is the one most likely to render an empty shell with no heading.
  { name: "job-detail-missing", url: "/jobs/10000000-0000-4000-8000-00000000dead" },
  { name: "user-profile-customer", url: `/user/${FAKE_CUSTOMER.id}` },
  { name: "user-profile-missing", url: "/user/10000000-0000-4000-8000-00000000dead" },
  { name: "pay-it-forward", url: "/pay-it-forward" },
  { name: "pets", url: "/pets" },
  { name: "saved-helpers", url: "/saved-helpers" },
  { name: "schedule", url: "/schedule" },
  { name: "settings", url: "/settings" },
  { name: "settings-profile", url: "/settings/profile" },
  { name: "str-settings", url: "/str-settings" },
  { name: "subscription", url: "/subscription" },
  { name: "work-record", url: "/work-record" },
  { name: "wrapped", url: "/wrapped" },
  { name: "post-login", url: "/dashboard/post-login" },
  { name: "business-billing", url: "/business/billing" },
  { name: "business-exports", url: "/business/exports" },
  { name: "business-onboarding", url: "/business/onboarding" },
];

// Admin surface — gated by AdminRoute, which redirects to /dashboard unless
// user_roles reports role=admin. Override that one table so the real Admin
// page renders. Captured once (admin is a single role-elevated customer).
export const ADMIN_SCREENS: ScreenSpec[] = [
  {
    name: "admin",
    url: "/admin",
    rules: [mockTable("user_roles", [{ role: "admin" }])],
  },
];

/**
 * Layout measurements taken per screen.
 *
 * The sweep used to capture only a screenshot + an axe report, which meant a
 * human had to open 78 PNGs to notice anything. These are the checks that CAN
 * be decided mechanically, so they land in the JSON report as findings rather
 * than as pictures someone has to interpret.
 */
export interface LayoutReport {
  /** documentElement.scrollWidth - clientWidth. Must be 0. */
  overflowPx: number;
  /**
   * Elements wider than the viewport that NOTHING between them and <body>
   * clips — the CAUSE of real horizontal overflow, not just the symptom.
   *
   * The ancestor walk stops at <body> on purpose. `index.css` sets
   * `body { overflow-x: hidden }` as a global guard for the .full-bleed
   * negative-margin trick, so a naive "does any ancestor clip?" test finds
   * body every time and the check becomes vacuously empty. Excluding body
   * means: a decorative blur contained by its own `overflow-hidden` section is
   * fine (it is designed that way), while content that spills to the viewport
   * edge and is only saved by the global guard still reports — because that
   * content is clipped off-screen and unreachable, which is a real defect.
   */
  overflowOffenders: string[];
  /**
   * Wide elements that ARE clipped by an intermediate ancestor. Kept separate
   * rather than dropped: they are the known false-positive class (decorative
   * `-inset-*` halos, blurred gradient washes), and a reviewer chasing an
   * overflow report needs to see that they were considered and excluded.
   */
  clippedWideElements: string[];
  /** Visible text computed below the ds-9 (9px) floor. */
  belowTypeFloor: string[];
  /** Standalone controls under the 44px HIG/WCAG-2.5.5 minimum. */
  smallTapTargets: string[];
  /** Should be exactly 1. */
  h1Count: number;
  /** The text of each h1 found, so a 0/2 count is diagnosable from the report. */
  h1Texts: string[];
  /**
   * `document.title`. Captured because a page that never calls usePageMeta
   * shows either index.html's landing title (cold load) or the bare "Helpr"
   * that usePageMeta's cleanup resets to when the PREVIOUS page unmounts —
   * so the tab, history entry and bookmark all fail to name the page, and a
   * screen reader announces nothing useful on an SPA route change. Neither
   * failure is visible on the page itself, which is why a screenshot sweep
   * missed it entirely.
   */
  documentTitle: string;
  /**
   * Length of the VISIBLE text inside <main id="main-content">.
   *
   * This is the check the seeded sweep structurally could not make: with rows
   * present, every screen has text. The failure mode being hunted is a screen
   * that renders its chrome and then nothing — no empty-state copy, no "you
   * have no X yet", just a blank panel. Measured on #main-content specifically
   * so the persistent nav/banner chrome cannot mask a blank page.
   */
  mainTextLength: number;
  /** First ~120 chars of that text, so a low count is diagnosable. */
  mainTextSample: string;
  /** console.error / warn / unhandled rejection seen while loading. */
  consoleIssues: string[];
}

/**
 * Measure the layout rules that can be decided without a human eye.
 *
 * Runs in the page. Every check filters to VISIBLE elements first — a hidden
 * 0x0 desktop-only node measured at 375px was a false-positive class in a
 * previous audit, so absence of that filter is itself a bug.
 */
export async function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(e);
      return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
    };

    // Does an ancestor STRICTLY BETWEEN this element and <body> clip on the
    // x-axis? See the note on `overflowOffenders` for why body/html are
    // excluded from the walk.
    const clippedByAncestor = (e: Element): boolean => {
      let p = e.parentElement;
      while (p && p !== document.body && p !== de) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
        p = p.parentElement;
      }
      return false;
    };

    const overflowOffenders: string[] = [];
    const clippedWideElements: string[] = [];
    document.querySelectorAll("#root *").forEach((e) => {
      if (!vis(e)) return;
      const r = e.getBoundingClientRect();
      if (r.width <= de.clientWidth + 1) return;
      const label = `${e.tagName}.${String((e as HTMLElement).className || "").slice(0, 36)} @${Math.round(r.width)}px`;
      if (clippedByAncestor(e)) clippedWideElements.push(label);
      else overflowOffenders.push(label);
    });

    const belowTypeFloor: string[] = [];
    const smallTapTargets: string[] = [];
    document.querySelectorAll("#root *").forEach((e) => {
      if (!vis(e)) return;
      if (e.children.length === 0 && (e.textContent ?? "").trim()) {
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 9) belowTypeFloor.push(`${fs}px "${(e.textContent ?? "").trim().slice(0, 24)}"`);
      }
    });
    document.querySelectorAll("#root button,#root a[href],#root [role=button]").forEach((e) => {
      if (!vis(e)) return;
      // Skip links inside running prose — an inline link in a sentence is not
      // a standalone control and is not expected to be 44px tall.
      if (e.closest("p") || e.closest("li")) return;
      if (getComputedStyle(e).display === "inline") return;
      // Skip-to-content links are deliberately 1px until focused; they are an
      // accessibility feature, not an undersized control.
      if (/skip to/i.test((e.textContent ?? "").trim())) return;
      const r = e.getBoundingClientRect();
      if (r.height < 44) {
        const label = (e.textContent ?? "").trim().slice(0, 20) || e.getAttribute("aria-label") || e.tagName;
        smallTapTargets.push(`${label} @${Math.round(r.height)}px`);
      }
    });

    // innerText, not textContent: innerText already respects display:none and
    // visibility:hidden, so an sr-only-but-present heading still counts (it is
    // read aloud) while a hidden tab panel's copy does not inflate the count.
    const main = document.querySelector<HTMLElement>("#main-content");
    const mainText = (main?.innerText ?? "").replace(/\s+/g, " ").trim();

    const h1s = Array.from(document.querySelectorAll("#root h1"));

    return {
      overflowPx: de.scrollWidth - de.clientWidth,
      overflowOffenders: overflowOffenders.slice(0, 5),
      clippedWideElements: [...new Set(clippedWideElements)].slice(0, 5),
      belowTypeFloor: [...new Set(belowTypeFloor)].slice(0, 5),
      smallTapTargets: [...new Set(smallTapTargets)].slice(0, 8),
      h1Count: h1s.length,
      h1Texts: h1s.map((h) => (h.textContent ?? "").trim().slice(0, 60)),
      documentTitle: document.title,
      mainTextLength: mainText.length,
      mainTextSample: mainText.slice(0, 120),
      consoleIssues: [],
    };
  });
}
