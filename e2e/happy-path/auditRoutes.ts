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
// The REAL flag, not a mirrored copy — a duplicate boolean here would
// drift silently, which is the whole failure mode this guards against.
import { BUSINESS_ENABLED } from "../../src/config/businessEnabled";
import { FAKE_CUSTOMER, FAKE_HELPER, mockRpc, mockTable, type MockSupabaseOptions } from "./fixtures";
import {
  BUSINESS_ID,
  SEED_BUSINESS_ACTIVITY,
  SEED_BUSINESS_PENDING_JOBS,
  SEED_BUSINESS_SPEND,
  makeSeedBusinessMembers,
  makeSeedBusinessVerification,
  type BusinessVerification,
} from "./seedData";

type MockRules = NonNullable<MockSupabaseOptions["rules"]>;

/**
 * Everything a `/business/*` screen needs to render an ACTUAL business account
 * instead of `BusinessNoAccountState`.
 *
 * Why a hand-rolled rule instead of `mockTable("business_members", rows)`:
 * `business_members` is read by two queries with incompatible expectations on
 * the SAME path.
 *   - `useMyBusiness` / `useBusinessSeatTier` embed `businesses!inner(…)` and
 *     call `.maybeSingle()` — handing them the 3-row roster makes maybeSingle
 *     fail with PGRST116 and the hook returns null, i.e. the empty state again.
 *   - `useTeamMembers` wants the whole roster, flat.
 * A static body can only satisfy one of them, so the rule branches on the
 * `select` param (membership lookup ⇄ roster) and resolves the `user_id`
 * filter itself — `rules` bypass `applyPostgrestQuery` entirely.
 *
 * `verification` picks the branch BusinessLayout renders: "verified" (no
 * banner) vs "none"/"pending"/"rejected" (the "Verify your business to start
 * posting" banner on pages that opt into `requiresVerification`). They are
 * visibly different screens, so both are in the catalog.
 */
export function businessRules(
  verification: BusinessVerification = "verified",
  options: { pendingApprovals?: boolean } = {},
): MockRules {
  const members = makeSeedBusinessMembers(verification);
  const rules: MockRules = [
    {
      match: (url, method) => method === "GET" && url.pathname === "/rest/v1/business_members",
      handle: (url) => {
        const select = url.searchParams.get("select") ?? "";
        // Membership lookup: embedded `businesses`, resolved with maybeSingle.
        // Must return 0 or 1 row, scoped to whoever is asking.
        if (select.includes("businesses")) {
          const wanted = (url.searchParams.get("user_id") ?? "").replace(/^eq\./, "");
          return {
            status: 200,
            body: members.filter((m) => m.status === "active" && m.user_id === wanted),
          };
        }
        // Roster: every non-removed seat.
        return { status: 200, body: members.filter((m) => m.status !== "removed") };
      },
    },
    // BusinessVerificationCard (rendered by the Team page only).
    //
    // `is_owner: true` is fixed rather than derived: a rule only sees the URL,
    // not who is asking, and the same static rules array serves both the
    // customer (the real owner) and helper passes. So on the HELPER pass this
    // one card shows the owner's upload controls while the rest of the page
    // correctly renders the member view. Known fixture limitation, called out
    // here so a screenshot of it is not mistaken for a permissions bug.
    mockRpc("get_my_business_verification", makeSeedBusinessVerification(verification, true)),
    mockRpc("business_activity_feed", SEED_BUSINESS_ACTIVITY),
    mockRpc("business_spend_summary", SEED_BUSINESS_SPEND),
  ];

  if (options.pendingApprovals) {
    // Scoped to the pending-approval query specifically rather than to the
    // whole `jobs` table, so nothing else on the page is fed approval rows.
    rules.push({
      match: (url, method) =>
        method === "GET" &&
        url.pathname === "/rest/v1/jobs" &&
        url.searchParams.get("status") === "eq.pending_approval" &&
        url.searchParams.get("business_id") === `eq.${BUSINESS_ID}`,
      handle: () => ({ status: 200, body: SEED_BUSINESS_PENDING_JOBS }),
    });
  }

  return rules;
}

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
  // The BUSINESS signup variant. Same route, different form: SignupStep1
  // paints an account-type banner and Signup.tsx adds a company-name field and
  // an extra `businesses` insert on submit. It was unaudited until 2026-08-17 —
  // `/signup` alone never renders the business branch.
  { name: "signup-business", url: "/signup?type=business" },
  { name: "login", url: "/login" },
  { name: "forgot-password", url: "/forgot-password" },
  { name: "reset-password", url: "/reset-password" },
  { name: "signup-pending", url: "/signup-pending" },
  { name: "account-pending", url: "/account-pending" },
  { name: "account-denied", url: "/account-denied" },
  { name: "account-banned", url: "/account-banned" },
  { name: "legal-terms", url: "/legal?tab=terms" },
  { name: "legal-privacy", url: "/legal?tab=privacy" },
  { name: "legal-community", url: "/legal?tab=community" },
  // Public marketing / info routes — added 2026-08-15 with the coverage audit
  // (see the note in AUTHED_SCREENS). These are reachable without a session,
  // so they are the routes a stranger and a search crawler actually hit.
  { name: "help", url: "/help" },
  { name: "support", url: "/support" },
  // REMOVED 2026-08-24: /accessibility. The standalone page was orphaned —
  // no link anywhere reached it — and its one real control (Simple Mode)
  // duplicated the Profile Accessibility tab's Senior Mode. Accessibility
  // settings live in Profile → Accessibility on every surface.
  // REMOVED 2026-08-22: /how-it-works, /become-a-partner, /community,
  // /enterprise, /evacuation, /impact, /local-guide, /parishes,
  // /parish/:slug (x3) and /browse-jobs. Their redirect stubs were deleted in
  // 2352466e, so every one of them rendered the NotFound page — the sweep
  // opened `/parishes`, measured the 404 screen, found it clean, and counted a
  // parish page as audited. Thirteen catalog rows, one screen, thirteen
  // "covered" ticks. `not-found` below already covers that screen once, on
  // purpose. The zz-catalog-routes-resolve test keeps this from recurring.
  //
  // /benefits and /gift-card moved to AUTHED_SCREENS: both sit behind
  // ProtectedRoute, so on an ANON pass they render /login, not themselves.
  { name: "privacy", url: "/privacy" },
  { name: "terms", url: "/terms" },
  { name: "rules", url: "/rules" },
  // Redirect since 2026-08-18 (page merged into /profile?tab=legal). Kept
  // for the same reason /privacy, /terms and /rules are: the Privacy Policy
  // and the App Store listing both publish this URL, so the catalog should
  // keep proving it does not 404. Note what this row actually captures — for
  // an ANON sweep it lands on /login (the destination is behind
  // ProtectedRoute), exactly as it did before the merge. The real screen is
  // covered by `profile-legal` in AUTHED_SCREENS below.
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

// /for-business is registered as `{BUSINESS_ENABLED && <Route …>}`, so with the
// flag off it 404s exactly like the /business/* screens. Verified in a browser.
if (BUSINESS_ENABLED) ANON_SCREENS.push({ name: "for-business", url: "/for-business" });

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
  // REMOVED 2026-08-23: /analytics is a <Navigate> to /profile?tab=earnings
  // now, not a screen. Left in, this row would have audited the Earnings tab
  // under the wrong name and counted it twice — the over-counting the catalog
  // guard exists to catch. `profile-earnings` already covers the destination.
  { name: "auto-tip", url: "/auto-tip" },
  { name: "availability", url: "/availability" },
  { name: "earnings", url: "/earnings" },
  // REMOVED 2026-08-23: Family & Care is behind FAMILY_ENABLED, which is off
  // (owner: "it seems pointless — you literally just post the job on their
  // behalf"). With the routes unregistered both rows rendered NotFound and
  // counted as two clean screens — exactly the over-counting this catalog's
  // guard test exists to catch. Restore both when the flag flips back.
  // REMOVED 2026-08-22: `family-accept-empty` pointed at "/family/accept/".
  // The route is "/family/accept/:token" and React Router will not match an
  // EMPTY path segment, so that row rendered the 404 page, not the page's
  // bad-token branch. Verified in a browser. The branch it meant to reach is
  // already covered by the row above — `test-invite-token` is not a real
  // invite either, so it takes the same "invalid token" path.
  { name: "home-history", url: "/home-history" },
  // REMOVED 2026-08-22: /job-history's redirect stub was deleted in 2352466e,
  // so this row rendered the 404 page while reporting as the job-history
  // screen. The real screen is /profile?tab=completed_jobs, already covered.
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
  // Both were listed as ANON until 2026-08-22, where ProtectedRoute meant they
  // rendered the login screen and the sweep filed it under their name.
  { name: "gift-card", url: "/gift-card" },
  { name: "benefits", url: "/benefits" },
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
  // Business screens are appended below, behind the real BUSINESS_ENABLED flag.
];

/**
 * The /business/* screens, audited ONLY when the Business product is on.
 *
 * All five business routes are registered as `{BUSINESS_ENABLED && <Route …>}`
 * (App.tsx), and the flag has been false since 2026-08-20. With it off the
 * routes are not registered at all, so every one of these rows rendered the
 * NotFound page — under BOTH roles, at every variant — and each 404 was
 * recorded as a clean audit of a business screen. Verified in a browser:
 * /business/billing returns the 404 page today.
 *
 * Kept rather than deleted, because businessEnabled.ts is explicit that nothing
 * was removed and flipping the flag restores the feature; deleting these rows
 * would silently drop the coverage on the day it comes back.
 */
const BUSINESS_SCREENS: ScreenSpec[] = [
  { name: "business-team", url: "/business/team" },
  { name: "business-billing", url: "/business/billing" },
  { name: "business-exports", url: "/business/exports" },
  { name: "business-onboarding", url: "/business/onboarding" },

  // ── /business/* WITH a business attached (added 2026-08-17) ───────────────
  // The four rows above have only ever rendered BusinessNoAccountState — no
  // fixture created a `businesses` row, so the entire B2B product was
  // invisible to both sweeps while all four routes reported clean. They are
  // KEPT as-is (the no-account screen is real, and it is what the empty-state
  // sweep still asserts on); these rows add the populated surface next to it.
  //
  // Every row carries explicit `rules` rather than leaning on SEED_TABLES, so
  // the business renders identically in the SEEDED sweep and the EMPTY one —
  // per-screen rules are consulted before the seed fallback in both.
  { name: "business-team-owned", url: "/business/team", rules: businessRules("verified") },
  {
    // Same route, unverified: BusinessLayout's "Verify your business to start
    // posting" banner + the verification card's "Not submitted" pill. A
    // visibly different screen, not a variant of the one above.
    name: "business-team-unverified",
    url: "/business/team",
    rules: businessRules("none"),
  },
  {
    name: "business-team-approvals",
    url: "/business/team?tab=approvals",
    rules: businessRules("verified", { pendingApprovals: true }),
  },
  { name: "business-team-spend", url: "/business/team?tab=spend", rules: businessRules("verified") },
  { name: "business-team-activity", url: "/business/team?tab=activity", rules: businessRules("verified") },
  { name: "business-team-settings", url: "/business/team?tab=settings", rules: businessRules("verified") },
  { name: "business-billing-owned", url: "/business/billing", rules: businessRules("verified") },
  {
    // Billing opts into `requiresVerification`, so this is the row that
    // actually paints the banner on a money screen.
    name: "business-billing-unverified",
    url: "/business/billing",
    rules: businessRules("none"),
  },
  { name: "business-exports-owned", url: "/business/exports", rules: businessRules("verified") },
  { name: "business-onboarding-owned", url: "/business/onboarding", rules: businessRules("verified") },
];

if (BUSINESS_ENABLED) AUTHED_SCREENS.push(...BUSINESS_SCREENS);


// Admin surface — gated by AdminRoute, which redirects to /dashboard unless
// user_roles reports role=admin. Override that one table so the real Admin
// page renders.
//
// This list used to hold ONE entry, `/admin`, under a comment reading "captured
// once (admin is a single role-elevated customer)". That conflated one admin
// PERSONA with one admin SCREEN. `/admin` is a `?view=`-switched shell over 27
// distinct views (the `View` union in src/pages/Admin.tsx), so the sweep was
// rendering `home` and reporting the whole admin surface clean while 26 views —
// payouts, disputes, fraud, parish tax, IDV, exports — were never loaded at
// all. Every admin defect found to date was found by hand, which is exactly
// what a 26-screen hole in the only automated net predicts.
//
// Mirror of the `View` union. When a view is added there, add it here: the gate
// below fails a screen that does not render, so a view listed here and broken is
// loud, whereas a view missing from here is silent — the failure mode this list
// exists to prevent.
export const ADMIN_VIEWS = [
  "analytics", "people", "jobs", "settings", "disputes", "broadcasts",
  "notifications", "notiflogs", "reports", "support", "referrals",
  "subscriptions", "fraud", "audit", "health", "export", "payouts",
  // parishtax and geography were DELETED (owner: Stripe handles tax; geography
  // was redundant). They are out of this list because they are out of the app —
  // /admin coerces their old deep links to home now, so sweeping them would
  // just be re-testing the dashboard under two extra names.
  "tiers", "idv", "marketing", "credentials",
  "business_verify", "business_accounts", "exceptions",
] as const;

const adminRules = () => [mockTable("user_roles", [{ role: "admin" }])];

export const ADMIN_SCREENS: ScreenSpec[] = [
  // `home` — the default view, reached with no ?view= param.
  { name: "admin", url: "/admin", rules: adminRules() },
  ...ADMIN_VIEWS.map((view) => ({
    name: `admin-${view.replace(/_/g, "-")}`,
    url: `/admin?view=${view}`,
    rules: adminRules(),
  })),
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
/**
 * Block until deferred overlays have mounted AND every running CSS animation
 * has finished, so axe never samples a half-faded element.
 *
 * Why this exists: OnboardingTour opens on a `setTimeout(…, 1500)` and its
 * card fades opacity 0 → 1 over ~330ms. The sweep's fixed post-load settle
 * lands *before* that, so axe would start scanning and the dialog would pop up
 * mid-scan — axe then multiplied the title's near-black --ink-deep by an
 * opacity of ~0.35 and reported impossible contrast failures on
 * `#onboarding-tour-title` (1.39:1 / 1.83:1 / 2.78:1 on three different runs,
 * with a DIFFERENT fg AND bg colour each time — the tell that the sample, not
 * the colour, was wrong; settled, the same node has no violation at all).
 *
 * `performance.now()` is relative to navigation start, so on a screen that
 * already took longer than the overlay delay this costs nothing.
 */
export async function settleAnimations(page: Page, minMs = 2200): Promise<void> {
  await page
    .waitForFunction((min) => performance.now() > min, minMs, { timeout: 10_000 })
    .catch(() => undefined);
  // Then let any in-flight fade/zoom finish. Infinite animations (spinners,
  // pulse rings) never finish, so they are excluded rather than waited on.
  await page
    .waitForFunction(
      () =>
        !document
          .getAnimations()
          .some(
            (a) =>
              a.playState === "running" &&
              Number.isFinite((a.effect?.getComputedTiming().activeDuration as number) ?? Infinity),
          ),
      undefined,
      { timeout: 5_000, polling: 100 },
    )
    .catch(() => undefined);

  // Finally, wait for OPACITY to hold still.
  //
  // The two waits above are not enough, and the gap they leave produced a
  // load-dependent false finding: `helper-jobs` (which redirects to
  // /dashboard) failed axe with `#f9f5f3 on #f3f2f2 = 1.03:1` on four nodes —
  // near-white text on near-white background, i.e. an element sampled at
  // ~0 opacity — but only when the sweep ran with 3 parallel workers. Alone it
  // passed three times out of three. The same /dashboard route reached
  // DIRECTLY was clean in the same run.
  //
  // Cause: framer-motion drives page transitions with requestAnimationFrame
  // and inline styles, NOT the Web Animations API, so `document.getAnimations()`
  // is blind to them. And `minMs` is measured from NAVIGATION start, so a
  // redirect that fires late (slow machine, loaded worker) can begin its fade
  // AFTER the 2.2s mark and still be mid-flight when axe scans.
  //
  // So: sample every element's computed opacity and require three consecutive
  // identical readings (~360ms of stillness). Elements with a running CSS
  // animation are excluded — an `animate-pulse` skeleton would otherwise never
  // stabilise and every screen would eat the full timeout.
  await page
    .waitForFunction(
      () => {
        const w = window as Window & { __sweepOpacitySig?: { v: string; n: number } };
        const animated = new Set(
          document
            .getAnimations()
            .map((a) => (a.effect as KeyframeEffect | null)?.target)
            .filter((t): t is Element => !!t),
        );
        const sig = Array.from(document.querySelectorAll("#root *"))
          .filter((e) => !animated.has(e))
          .map((e) => getComputedStyle(e).opacity)
          .join(",");
        const prev = w.__sweepOpacitySig;
        if (!prev || prev.v !== sig) {
          w.__sweepOpacitySig = { v: sig, n: 1 };
          return false;
        }
        prev.n += 1;
        return prev.n >= 3;
      },
      undefined,
      { timeout: 6_000, polling: 120 },
    )
    .catch(() => undefined);
}

/**
 * Measure layout invariants for the current page.
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
