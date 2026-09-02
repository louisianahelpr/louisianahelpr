/**
 * stateMatrix — the enumerator for Louisiana Helpr's VISUAL STATE SPACE.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/audit/COVERAGE_LEDGER.md` counted 232 units: routes x breakpoints x
 * admin views x overlay roots. Every unit it counted was a PLACE. Every defect
 * the owner found in 45 minutes of tapping a real build lived in a STATE:
 *
 *   - a status with no branch of its own (`pending_approval` renders no body)
 *   - a card expanded vs collapsed (expansion gates ~90% of both job cards)
 *   - a job four days past due (`jobIsOverdue` re-buckets it, adds a band)
 *   - an arrival that was "claimed" but not "verified" (three different
 *     captions, one amber, off one nullable column)
 *   - step 2 of a dialog (ReportDialog has three screens; the sweep saw one)
 *
 * A route sweep photographs each screen ONCE, in whatever state prod data
 * happened to be in. It cannot see any of the above. This module derives the
 * state space from the source of truth instead — the `job_status` enum, the
 * `application_status` enum, the derived-state function the helper card
 * actually branches on, and the nullable columns each surface reads — so
 * coverage can be measured against states rather than places.
 *
 * HONESTY ABOUT COMBINATORICS
 * ---------------------------
 * The naive cross-product is meaningless. The poster card alone reads 8
 * statuses and ~17 further independent-looking flags: 8 x 2^17 is a million
 * cells, of which almost all are unreachable (there is no such thing as a
 * `cancelled` job with an active boost banner and a dispute deadline). A
 * manifest that emits them is worse than no manifest, because it can never be
 * finished and so it is never used.
 *
 * So this module applies eight explicit COLLAPSING RULES (R1..R8 below). Each
 * one is a claim about the code that can be checked and falsified. They are
 * documented, not implicit, because the reason the last matrix was wrong is
 * that nobody could see what it had decided to ignore.
 *
 *   R1  STATUS IS THE OUTER AXIS; SUB-AXES ARE GATED BY IT.
 *       A sub-axis is enumerated only for the statuses whose code path reads
 *       it. `boost_expires_at` is read only under `open`; `dispute_status`
 *       only under `disputed`; `cancellation_fee_status` only under
 *       `cancelled`; tip/review only under `completed`; the arrival lattice
 *       only under `accepted`/`in_progress`. This is what turns 2^17 into
 *       a two-digit number per status.
 *
 *   R2  THE HELPER CARD IS A DERIVED STATE MACHINE, NOT A PRODUCT.
 *       `deriveAppliedJobCardState` (appliedJobCardHelpers.ts) maps
 *       (application_status x job_status x direct_offer_status x
 *       offered_to_helper_id x helperReviewedJobIds) onto ~10 mutually
 *       exclusive sections. 3 x 8 = 24 raw combinations collapse to those
 *       sections plus two edge cases (no job row; the "No actions available"
 *       safety net). Enumerate the sections, not the raw cross.
 *
 *   R3  EXPANSION IS ORTHOGONAL AND ALWAYS DOUBLES.
 *       `isExpanded` gates the description, the tracker, the action row, the
 *       photos and every status-specific body block on BOTH cards. It is the
 *       one axis that genuinely multiplies everywhere, so every card cell is
 *       captured collapsed AND expanded. (Exception: minimal cards pass
 *       `expandable={false}` and have no expanded form.)
 *
 *   R4  COSMETIC CALL-SITE PROPS COLLAPSE AWAY.
 *       `tone`, `columns`, `size`, `variant`, `inline`, `flexibleLabel`,
 *       `amountTitle` are chosen by the call site, not by data. One
 *       representative value each; they cannot vary for a given cell.
 *
 *   R5  DATA PRESENCE IS A 3-VALUED PROFILE, NOT N INDEPENDENT BOOLEANS.
 *       Photos, series strip, pet report, group helpers, location and proof
 *       images are all self-hiding sub-components. Crossing six booleans with
 *       eight statuses buys nothing, because they render in a stack and do not
 *       interact. Instead each surface gets EMPTY / SPARSE / RICH content
 *       profiles, plus a small set of dedicated content cells for the shapes
 *       that historically broke layout (a 130-character title, a 40-character
 *       unbroken token, an accented name, five photos).
 *
 *   R6  TRANSIENT IN-FLIGHT GUARDS ARE NOT ENUMERATED — AND SAY SO.
 *       `confirmingArrivalJobId`, `confirmingWorkingJobId`, `completingJobId`,
 *       `withdrawingAppId`, `disputeActing` each disable and relabel exactly
 *       one button for the duration of one mutation. They are reachable only
 *       by winning a race against a mocked 201. They are emitted as cells with
 *       `reachable: "unreachable"` and a reason, because a named gap beats a
 *       silent one.
 *
 *   R7  CLOCK AXES ARE ENUMERATED AT THEIR BOUNDARIES ONLY.
 *       Countdowns have three tiers (calm / urgent <12h / critical <2h) plus
 *       expired; past-due has {on time, due today, N days past}. Time is
 *       injected as a fixed offset from the run clock, never as "whatever
 *       today is", so the same cell renders the same band on every run.
 *
 *   R8  CATEGORY COLLAPSES TO TWO VALUES PLUS ONE PALETTE STRIP.
 *       `pet_care` unlocks the report card and the pet sheet, so it is a real
 *       branch. The other eleven categories differ only in the left rail hue
 *       and the badge classes in `categoryColors`. Those are covered once, by
 *       a single cell that renders all twelve side by side, rather than by
 *       multiplying every status by twelve.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It does not assert anything. It produces a manifest. `state-sweep.spec.ts`
 * drives the manifest and captures pixels; `scripts/state-review.mjs` turns
 * those into a critique queue. Enumerating, driving and judging are kept
 * apart on purpose: the previous harness fused "drive" and "judge" into a
 * predicate check, and the predicate passed on every defect the owner found.
 */

import type { Database } from "@/integrations/supabase/types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];

export type JobStatus = Database["public"]["Enums"]["job_status"];
export type ApplicationStatus = Database["public"]["Enums"]["application_status"];

/**
 * The `job_status` union, spelled out rather than imported as a value, because
 * the generated `types.ts` exports `Constants.public.Enums.job_status` and a
 * literal list here lets the compiler tell us when the two drift. If the DB
 * enum gains a value, `STATUS_EXHAUSTIVE` below stops type-checking.
 */
export const JOB_STATUSES = [
  "open",
  "pending_approval",
  "accepted",
  "in_progress",
  "revision_requested",
  "completed",
  "cancelled",
  "disputed",
] as const;

/** Compile-time tripwire: every enum member must appear in JOB_STATUSES. */
const STATUS_EXHAUSTIVE: Record<JobStatus, true> = {
  open: true,
  pending_approval: true,
  accepted: true,
  in_progress: true,
  revision_requested: true,
  completed: true,
  cancelled: true,
  disputed: true,
};
void STATUS_EXHAUSTIVE;

// ---------------------------------------------------------------------------
// Cell shape
// ---------------------------------------------------------------------------

export type Surface =
  | "posted-card"
  | "applied-card"
  | "tracker"
  | "activity-shell"
  | "job-detail"
  | "dialog";

/**
 * How a cell can be driven.
 *
 *  - `auto`        the sweep reaches it unaided (mock a row, load a route,
 *                  optionally click to expand)
 *  - `interaction` the sweep must click a specific trigger to open it; it is
 *                  driven, but a selector change silently drops it, so it is
 *                  tracked separately and reported when it is not found
 *  - `native`      only observable inside WKWebView on iOS — Chromium cannot
 *                  render the failure at all
 *  - `unreachable` deliberately not driven; carries a reason
 */
export type Reachability = "auto" | "interaction" | "native" | "unreachable";

/** A breakpoint + theme pair to capture a cell at. */
export interface Shot {
  label: string;
  width: number;
  height: number;
  theme: "light" | "dark";
}

export const SHOT_PRIMARY: Shot = { label: "390-light", width: 390, height: 844, theme: "light" };
export const SHOT_DARK: Shot = { label: "390-dark", width: 390, height: 844, theme: "dark" };
export const SHOT_DESKTOP: Shot = { label: "1440-light", width: 1440, height: 900, theme: "light" };
export const SHOT_NARROW: Shot = { label: "320-light", width: 320, height: 640, theme: "light" };

/**
 * R9 — theme and breakpoint are applied to a SUBSET, not to the whole matrix.
 *
 * Crossing ~180 states with 6 breakpoints and 2 themes is ~2,000 images. Nobody
 * reviews 2,000 images, and an artifact nobody reviews is exactly the failure
 * this tooling exists to correct: the last sweep captured screenshots and then
 * never looked at them. So: every cell at 390 light (the modal device), and
 * the status-DEFINING cells — the one cell that first introduces each status or
 * derived state — additionally at 1440 light, 390 dark and 320 light, because
 * those are where the rail-inset, the token-swap and the truncation bugs live.
 */
function shotsFor(primaryOnly: boolean): Shot[] {
  return primaryOnly ? [SHOT_PRIMARY] : [SHOT_PRIMARY, SHOT_DARK, SHOT_DESKTOP, SHOT_NARROW];
}

/**
 * Fixture overrides for a cell. The sweep turns these into `page.route()`
 * responses; nothing here touches a real database.
 */
export interface CellFixture {
  /** Partial `jobs` row merged over the base row. */
  job?: Partial<JobRow> & Record<string, unknown>;
  /** Partial `applications` row (helper side). */
  application?: Partial<ApplicationRow> & Record<string, unknown>;
  /** Rows for `applications` when viewed as the POSTER (applicant count). */
  applicants?: number;
  /** `job_tracking` row, if the tracker should be driven from a tracking row. */
  tracking?: Record<string, unknown> | null;
  /** Job ids the viewer has already reviewed (drives isFullyDone / Reviewed). */
  reviewedJobIds?: string[];
  /** Job ids the viewer has tipped. */
  tippedJobIds?: string[];
  /** Extra rows keyed by table name. */
  tables?: Record<string, unknown[]>;
}

export interface StateCell {
  /** Deterministic, filesystem-safe. Screenshot name is derived from it. */
  id: string;
  surface: Surface;
  /** Route to load. */
  route: string;
  /** Human sentence describing exactly what state this is. Feeds the review. */
  describe: string;
  status?: JobStatus | null;
  /** Derived helper-card section, where applicable. */
  derived?: string;
  /** The axis values that define this cell. Emitted into the review record. */
  axes: Record<string, string>;
  expanded: boolean;
  reachable: Reachability;
  /** Why a non-`auto` cell is where it is. Mandatory for non-auto cells. */
  reason?: string;
  /** Click path, for `interaction` cells: accessible names in order. */
  open?: string[];
  shots: Shot[];
  fixture?: CellFixture;
}

// ---------------------------------------------------------------------------
// Clock (R7)
// ---------------------------------------------------------------------------

/**
 * All dates are offsets from a single run clock, captured once, so that two
 * cells in the same run agree on "now" and a screenshot diff between runs is a
 * real change rather than a minute ticking over.
 *
 * NOT frozen to a literal date, deliberately: `useDashboardFilters` and
 * `jobIsOverdue` both compare `date_needed` against the VIEWER'S today, so a
 * hardcoded 2026-08-14 would make every "3 days out" job read as weeks stale
 * and quietly collapse the matrix into a single past-due cell. seedData.ts
 * carries the same warning for the same reason.
 */
const RUN_CLOCK = Date.now();
const ISO = (msFromNow: number) => new Date(RUN_CLOCK + msFromNow).toISOString();
const DAYS = (n: number) => n * 86_400_000;
const HOURS = (n: number) => n * 3_600_000;
/** Postgres `date` — bare YYYY-MM-DD, never a full ISO string. See seedData.ts. */
const DATE_ONLY = (msFromNow: number) => new Date(RUN_CLOCK + msFromNow).toISOString().slice(0, 10);

export const CLOCK = { RUN_CLOCK, ISO, DAYS, HOURS, DATE_ONLY };

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export const POSTER_ID = "00000000-0000-4000-8000-00000000c1ce";
export const HELPER_ID = "00000000-0000-4000-8000-00000000he1p";
export const OTHER_ID = "00000000-0000-4000-8000-0000000000a2";
export const CELL_JOB_ID = "10000000-0000-4000-8000-00000000cell";

/**
 * Base `jobs` row carrying every non-nullable column, plus explicit nulls for
 * the columns the cards branch on. Explicit nulls matter: a MISSING key and a
 * `null` key read the same in JS but not in a spread, and a cell that means
 * "no arrival yet" must actively clear `helper_arrived_at` rather than inherit
 * it from whatever the previous cell set.
 */
export const BASE_JOB: Record<string, unknown> = {
  id: CELL_JOB_ID,
  customer_id: POSTER_ID,
  helper_id: null,
  title: "Deep clean a two-bedroom before move-out",
  description: "Full clean — kitchen, two bathrooms, baseboards. Supplies provided.",
  category: "cleaning",
  status: "open",
  budget: 180,
  location: "Baton Rouge, LA",
  latitude: 30.4515,
  longitude: -91.1871,
  date_needed: DATE_ONLY(DAYS(3)),
  start_time: "09:00:00",
  created_at: ISO(-DAYS(1)),
  updated_at: ISO(-HOURS(2)),
  expires_at: null,
  photos: null,
  special_requirements: null,
  // Branch flags — every one of these is read by a card and must be explicit.
  boost_auto_extended: false,
  boost_expires_at: null,
  cancellation_fee: null,
  cancellation_fee_status: null,
  credential_tier: 0,
  direct_offer_status: null,
  direct_offer_expires_at: null,
  dispute_deadline: null,
  dispute_helper_response: null,
  dispute_reason: null,
  dispute_status: null,
  disputed_by: null,
  has_active_dispute: false,
  helper_arrived_at: null,
  helper_arrival_verified_at: null,
  helper_completed_at: null,
  helper_confirmed_at: null,
  helper_dayof_confirmed_at: null,
  helper_on_the_way_at: null,
  instant_book: false,
  is_auto_created: false,
  is_flexible_schedule: false,
  is_group_job: false,
  is_recurring: false,
  is_urgent: false,
  offered_to_helper_id: null,
  parent_job_id: null,
  payment_status: null,
  poster_completed_at: null,
  poster_confirmed_arrival_at: null,
  poster_confirmed_working_at: null,
  pricing_mode: "fixed",
  proof_after_urls: null,
  proof_before_urls: null,
  protection_opted_in: false,
  recurrence_days: null,
  recurrence_weeks: null,
  recurring_helper_id: null,
  requires_w9: false,
  response_deadline: null,
  review_reminder_sent: false,
  revision_acceptance_deadline: null,
  revision_completed_at: null,
  revision_count: 0,
  revision_deadline: null,
  revision_note: null,
  revision_requested_at: null,
  scope_video_url: null,
};

/** Base `applications` row for the helper side. */
export const BASE_APPLICATION: Record<string, unknown> = {
  id: "20000000-0000-4000-8000-00000000cell",
  job_id: CELL_JOB_ID,
  helper_id: HELPER_ID,
  status: "pending",
  message: "I clean three move-outs a week and can bring my own supplies.",
  created_at: ISO(-DAYS(1)),
  updated_at: ISO(-DAYS(1)),
  poster_viewed_at: null,
  offer_message: null,
};

// ---------------------------------------------------------------------------
// R5 — content profiles
// ---------------------------------------------------------------------------

/**
 * The three content profiles. `rich` deliberately carries the shapes that have
 * broken this layout before — a 130-character title, a 40-character unbroken
 * token, five photos, an accented counterparty name — because "Test Job 1"
 * never breaks anything and a screenshot of it proves nothing.
 */
export const CONTENT_PROFILES = {
  empty: {},
  sparse: {
    title: "Mow lawn",
    description: "Mow lawn",
    special_requirements: null,
    photos: null,
    location: "Houma, LA",
  },
  rich: {
    title:
      "Help moving a three-piece sectional, a washer and dryer, and roughly twenty boxes up to a second-floor apartment with no elevator",
    description:
      "Reference number NOSPACESHEREATALLFORTYCHARS0123456789 — please quote before accepting. Parking is street-only and the stairwell turns twice.",
    special_requirements: "Must bring furniture sliders, a dolly, and moving blankets.",
    photos: [1, 2, 3, 4, 5].map(
      () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    ),
    location: "New Orleans, LA",
  },
} as const;

export type ContentProfile = keyof typeof CONTENT_PROFILES;

// ---------------------------------------------------------------------------
// Poster card (R1, R3, R5, R7, R8)
// ---------------------------------------------------------------------------

/**
 * Per-status sub-axes for the POSTER card, each gated to the statuses whose
 * code path actually reads it (R1). Every entry names the field it turns on so
 * a reader can go check the branch.
 */
interface SubState {
  key: string;
  describe: string;
  job: Record<string, unknown>;
  applicants?: number;
  tippedJobIds?: string[];
  reviewedJobIds?: string[];
}

const POSTER_SUBSTATES: Record<JobStatus, SubState[]> = {
  open: [
    {
      key: "no-applicants",
      describe: "open, nobody has applied — Applicants (0), bucket = Waiting",
      job: {},
      applicants: 0,
    },
    {
      key: "three-applicants",
      describe: "open with 3 pending applicants — bucket flips to Needs you",
      job: {},
      applicants: 3,
    },
    {
      key: "boosted",
      describe: "open with an active boost — boost banner + disabled 'Boosted' chip",
      job: { boost_expires_at: ISO(DAYS(2)) },
      applicants: 1,
    },
    {
      key: "expiring-soon",
      describe: "open, no helper, expires in 90 minutes — meta-row countdown chip in its urgent tier",
      job: { expires_at: ISO(HOURS(1.5)) },
      applicants: 0,
    },
    {
      key: "past-due-4-days",
      describe:
        "open, date_needed 4 days ago — jobIsOverdue() re-buckets to Needs you and adds 'Was due 4 days ago'",
      job: { date_needed: DATE_ONLY(-DAYS(4)) },
      applicants: 0,
    },
  ],
  pending_approval: [
    {
      key: "awaiting-approver",
      describe:
        "pending_approval — the only status with no card body block of its own; PostedJobActions renders an amber info box and a single Edit Post button",
      job: {},
    },
  ],
  accepted: [
    {
      key: "helper-not-confirmed",
      describe: "accepted, helper has not accepted yet — 'Waiting for X to accept' pill, bucket = Waiting",
      job: { helper_id: HELPER_ID, date_needed: DATE_ONLY(DAYS(2)) },
    },
    {
      key: "helper-confirmed",
      describe: "accepted and confirmed — JobCountdown ticking, bucket = Scheduled",
      job: { helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(6)), date_needed: DATE_ONLY(DAYS(2)) },
    },
    {
      key: "countdown-critical",
      describe: "accepted, confirmed, job starts in 90 minutes — JobCountdown critical (<2h) tier",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-HOURS(6)),
        date_needed: DATE_ONLY(0),
        start_time: new Date(RUN_CLOCK + HOURS(1.5)).toISOString().slice(11, 19),
      },
    },
    {
      key: "arrival-claimed",
      describe:
        "accepted, helper CLAIMED arrival but no verification and no poster vouch — the Confirm Arrival gate, amber 'Awaiting poster' caption",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-HOURS(6)),
        helper_on_the_way_at: ISO(-HOURS(1)),
        helper_arrived_at: ISO(-HOURS(0.5)),
        date_needed: DATE_ONLY(0),
      },
    },
    {
      key: "past-due-never-started",
      describe: "accepted, day passed, nothing stamped — bucket = Needs you, 'Was due 2 days ago'",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(3)),
        date_needed: DATE_ONLY(-DAYS(2)),
      },
    },
  ],
  in_progress: [
    {
      key: "arrival-claimed",
      describe:
        "in_progress, arrival CLAIMED only (helper_arrived_at set, helper_arrival_verified_at null, poster_confirmed_arrival_at null) — Confirm They Arrived visible, tracker capped at Arrived",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(1)),
        helper_on_the_way_at: ISO(-HOURS(2)),
        helper_arrived_at: ISO(-HOURS(1)),
        date_needed: DATE_ONLY(0),
      },
    },
    {
      key: "arrival-verified",
      describe:
        "in_progress, arrival VERIFIED by the server (helper_arrival_verified_at set) but poster has not vouched — 'Location confirmed' caption, tracker may advance to Working",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(1)),
        helper_on_the_way_at: ISO(-HOURS(2)),
        helper_arrived_at: ISO(-HOURS(1)),
        helper_arrival_verified_at: ISO(-HOURS(1)),
        date_needed: DATE_ONLY(0),
      },
    },
    {
      key: "arrival-confirmed-working",
      describe:
        "in_progress, poster confirmed arrival AND working — 'Arrival confirmed' chip gone, working stamped",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(1)),
        helper_on_the_way_at: ISO(-HOURS(3)),
        helper_arrived_at: ISO(-HOURS(2)),
        helper_arrival_verified_at: ISO(-HOURS(2)),
        poster_confirmed_arrival_at: ISO(-HOURS(2)),
        poster_confirmed_working_at: ISO(-HOURS(1.5)),
        date_needed: DATE_ONLY(0),
      },
    },
    {
      key: "submitted-awaiting-approval",
      describe:
        "in_progress, helper submitted (helper_completed_at set, poster_completed_at null) — Approve chip live, 24h auto-release countdown, bucket = Needs you",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(1)),
        helper_arrived_at: ISO(-HOURS(5)),
        helper_arrival_verified_at: ISO(-HOURS(5)),
        poster_confirmed_arrival_at: ISO(-HOURS(5)),
        poster_confirmed_working_at: ISO(-HOURS(4)),
        helper_completed_at: ISO(-HOURS(1)),
        proof_before_urls: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="],
        proof_after_urls: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="],
        date_needed: DATE_ONLY(0),
      },
    },
    {
      key: "no-live-map",
      describe:
        "in_progress, helper en route, job has NO coordinates — the amber 'No live map for this job' notice, which is the inverse of JobTracking's own map gate",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(1)),
        helper_on_the_way_at: ISO(-HOURS(1)),
        latitude: null,
        longitude: null,
        date_needed: DATE_ONLY(0),
      },
    },
  ],
  revision_requested: [
    {
      key: "awaiting-fix",
      describe: "revision_requested, helper has not fixed it yet — revision note + fixed-deadline countdown",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(2)),
        helper_arrived_at: ISO(-DAYS(1)),
        helper_arrival_verified_at: ISO(-DAYS(1)),
        helper_completed_at: ISO(-DAYS(1)),
        revision_requested_at: ISO(-HOURS(20)),
        revision_note: "The upstairs bathroom mirror and the baseboards in the hall were missed.",
        revision_deadline: ISO(HOURS(8)),
        revision_count: 1,
        date_needed: DATE_ONLY(-DAYS(1)),
      },
    },
    {
      key: "fix-submitted",
      describe:
        "revision_requested with revision_completed_at set — success box + acceptance-deadline countdown replaces the fix countdown",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(2)),
        helper_arrived_at: ISO(-DAYS(1)),
        helper_arrival_verified_at: ISO(-DAYS(1)),
        helper_completed_at: ISO(-DAYS(1)),
        revision_requested_at: ISO(-DAYS(1)),
        revision_note: "The upstairs bathroom mirror and the baseboards in the hall were missed.",
        revision_completed_at: ISO(-HOURS(2)),
        revision_acceptance_deadline: ISO(HOURS(10)),
        revision_count: 1,
        date_needed: DATE_ONLY(-DAYS(1)),
      },
    },
  ],
  completed: [
    {
      key: "neither-tipped-nor-reviewed",
      describe: "completed, no tip and no review yet — Tip and Review chips both live, Report Job present",
      job: { helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" },
    },
    {
      key: "tipped-only",
      describe: "completed and tipped, not reviewed — 'Tipped' chip disabled, Review chip live",
      job: { helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" },
      tippedJobIds: [CELL_JOB_ID],
    },
    {
      key: "reviewed-only",
      describe: "completed and reviewed, not tipped — 'Reviewed' chip disabled, Tip chip live",
      job: { helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" },
      reviewedJobIds: [CELL_JOB_ID],
    },
    {
      key: "tipped-and-reviewed",
      describe:
        "completed, tipped AND reviewed — the collapsed 'Tipped & Reviewed' strip; every remaining chip is a no-op or a Report",
      job: { helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" },
      tippedJobIds: [CELL_JOB_ID],
      reviewedJobIds: [CELL_JOB_ID],
    },
    {
      key: "payment-not-released",
      describe:
        "completed but payment_status still pending — canReview is false, so Review is absent while Tip is present",
      job: { helper_id: HELPER_ID, ...completedStamps(), payment_status: "pending" },
    },
    {
      key: "no-helper",
      describe:
        "completed with NO helper_id (auto-expired / closed out) — 'Re-Post' instead of 'Hire Again'",
      job: { ...completedStamps(), payment_status: null },
    },
  ],
  cancelled: [
    {
      key: "no-fee",
      describe: "cancelled with no cancellation fee — Re-Post This Job is the only control; PostedJobActions returns null",
      job: { date_needed: DATE_ONLY(-DAYS(2)) },
    },
    {
      key: "fee-pending",
      describe: "cancelled with cancellation_fee_status = pending — fee badge in its pending colour",
      job: { helper_id: HELPER_ID, cancellation_fee: 25, cancellation_fee_status: "pending", date_needed: DATE_ONLY(-DAYS(2)) },
    },
    {
      key: "fee-charged",
      describe: "cancelled with cancellation_fee_status = charged",
      job: { helper_id: HELPER_ID, cancellation_fee: 25, cancellation_fee_status: "charged", date_needed: DATE_ONLY(-DAYS(2)) },
    },
    {
      key: "fee-waived",
      describe: "cancelled with cancellation_fee_status = waived",
      job: { helper_id: HELPER_ID, cancellation_fee: 25, cancellation_fee_status: "waived", date_needed: DATE_ONLY(-DAYS(2)) },
    },
  ],
  disputed: [
    {
      key: "open-i-disputed",
      describe:
        "disputed, dispute_status open, disputed_by = me — Resolve & Pay + Escalate row visible, 72h deadline countdown",
      job: {
        helper_id: HELPER_ID,
        ...completedStamps(),
        has_active_dispute: true,
        dispute_status: "open",
        disputed_by: POSTER_ID,
        dispute_reason: "The hallway baseboards were not touched and the mirror is still streaked.",
        dispute_deadline: ISO(HOURS(40)),
      },
    },
    {
      key: "open-they-disputed",
      describe:
        "disputed, dispute_status open, disputed_by = the helper — the disputer action row must NOT render for me",
      job: {
        helper_id: HELPER_ID,
        ...completedStamps(),
        has_active_dispute: true,
        dispute_status: "open",
        disputed_by: HELPER_ID,
        dispute_reason: "I completed everything on the list and was not paid.",
        dispute_helper_response: "Photos attached showing the finished baseboards.",
        dispute_deadline: ISO(HOURS(40)),
      },
    },
    {
      key: "escalated",
      describe: "disputed, dispute_status escalated — awaitingAdmin suppresses the 72h box",
      job: {
        helper_id: HELPER_ID,
        ...completedStamps(),
        has_active_dispute: true,
        dispute_status: "escalated",
        disputed_by: POSTER_ID,
        dispute_reason: "The hallway baseboards were not touched.",
      },
    },
    {
      key: "resolved",
      describe: "disputed, dispute_status resolved — terminal copy, no action row",
      job: {
        helper_id: HELPER_ID,
        ...completedStamps(),
        has_active_dispute: false,
        dispute_status: "resolved",
        disputed_by: POSTER_ID,
        dispute_reason: "The hallway baseboards were not touched.",
      },
    },
    {
      key: "disputed-mid-job",
      describe:
        "disputed raised BEFORE completion (no helper_completed_at) — the tracker's Working step paints destructive red while earlier steps stay green",
      job: {
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-DAYS(1)),
        helper_on_the_way_at: ISO(-HOURS(6)),
        helper_arrived_at: ISO(-HOURS(5)),
        helper_arrival_verified_at: ISO(-HOURS(5)),
        poster_confirmed_arrival_at: ISO(-HOURS(5)),
        has_active_dispute: true,
        dispute_status: "open",
        disputed_by: POSTER_ID,
        dispute_reason: "Helpr stopped halfway through and left.",
        dispute_deadline: ISO(HOURS(60)),
        date_needed: DATE_ONLY(0),
      },
    },
  ],
};

/** The stamp set every terminal (completed / disputed-after-work) job carries. */
function completedStamps(): Record<string, unknown> {
  return {
    helper_confirmed_at: ISO(-DAYS(4)),
    helper_on_the_way_at: ISO(-DAYS(3)),
    helper_arrived_at: ISO(-DAYS(3)),
    helper_arrival_verified_at: ISO(-DAYS(3)),
    poster_confirmed_arrival_at: ISO(-DAYS(3)),
    poster_confirmed_working_at: ISO(-DAYS(3)),
    helper_completed_at: ISO(-DAYS(3)),
    poster_completed_at: ISO(-DAYS(3)),
    date_needed: DATE_ONLY(-DAYS(3)),
  };
}

// ---------------------------------------------------------------------------
// Applied card (R2)
// ---------------------------------------------------------------------------

/**
 * The helper card's DERIVED sections, enumerated directly (R2). Each entry
 * spells the (application_status, job_status, …) tuple that produces it, so a
 * reader can verify the mapping against `deriveAppliedJobCardState` rather
 * than trusting this list.
 */
interface AppliedState {
  key: string;
  derived: string;
  describe: string;
  job: Record<string, unknown> | null;
  application: Record<string, unknown>;
  reviewedJobIds?: string[];
  /** Minimal cards pass `expandable={false}` — no expanded form exists (R3). */
  expandable?: boolean;
}

const APPLIED_STATES: AppliedState[] = [
  {
    key: "no-job-row",
    derived: "no-job",
    describe:
      "application whose job row is not visible to the helper (RLS hid it) — the non-expandable 'Job no longer available' shell, a state outside deriveAppliedJobCardState entirely",
    job: null,
    application: { status: "pending" },
    expandable: false,
  },
  {
    key: "pending",
    derived: "isPending",
    describe: "app.status = pending, job open — PendingApplicationSection + Edit / Withdraw",
    job: { status: "open" },
    application: { status: "pending" },
  },
  {
    key: "pending-seen",
    derived: "isPending",
    describe: "pending application the poster has opened — poster_viewed_at drives the 'Seen' trust chip",
    job: { status: "open" },
    application: { status: "pending", poster_viewed_at: ISO(-HOURS(4)) },
  },
  {
    key: "rejected",
    derived: "isMinimalCard",
    describe: "app.status = rejected — minimal 'Not selected' card, no controls at all",
    job: { status: "open" },
    application: { status: "rejected" },
    expandable: false,
  },
  {
    key: "cancelled-with-fee",
    derived: "isMinimalCard",
    describe:
      "job cancelled after the helper was booked, with a cancellation fee — minimal card + CancellationFeePill",
    job: {
      status: "cancelled",
      helper_id: HELPER_ID,
      cancellation_fee: 25,
      cancellation_fee_status: "charged",
      date_needed: DATE_ONLY(-DAYS(1)),
    },
    application: { status: "accepted" },
    expandable: false,
  },
  {
    key: "offered-direct",
    derived: "isOffered (direct)",
    describe:
      "direct_offer_status = pending and offered_to_helper_id = me — OfferedActions with an offer message and a live response deadline; Decline skips its confirm dialog on this branch only",
    job: {
      status: "open",
      direct_offer_status: "pending",
      offered_to_helper_id: HELPER_ID,
      direct_offer_expires_at: ISO(HOURS(6)),
      date_needed: DATE_ONLY(DAYS(2)),
    },
    application: { status: "pending", offer_message: "You did our last move-out — can you take this one?" },
  },
  {
    key: "offered-assigned-unconfirmed",
    derived: "isOffered (assigned)",
    describe:
      "app accepted, job accepted, helper_confirmed_at still null — the same OfferedActions section reached by a different tuple; Decline DOES confirm here",
    job: { status: "accepted", helper_id: HELPER_ID, date_needed: DATE_ONLY(DAYS(2)), response_deadline: ISO(HOURS(20)) },
    application: { status: "accepted" },
  },
  {
    key: "offered-expired",
    derived: "isOffered (expired)",
    describe:
      "offer whose deadline has passed — buttons gone, only the 'It's still open — view the job' link, and only because job.status is still open",
    job: {
      status: "open",
      direct_offer_status: "pending",
      offered_to_helper_id: HELPER_ID,
      direct_offer_expires_at: ISO(-HOURS(3)),
      date_needed: DATE_ONLY(DAYS(2)),
    },
    application: { status: "pending", offer_message: "You did our last move-out — can you take this one?" },
  },
  {
    key: "confirmed-gate-active",
    derived: "isConfirmed",
    describe:
      "confirmed booking more than 24h out — HelperTrackerPanel's gateActive branch: inline JobConfirmation, 'I'm On My Way' rendered DISABLED with an explanation",
    job: { status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(8)), date_needed: DATE_ONLY(DAYS(3)) },
    application: { status: "accepted" },
  },
  {
    key: "confirmed-day-of",
    derived: "isConfirmed",
    describe:
      "confirmed booking, day-of confirmation stamped — gateActive false, the live tracker CTA takes over",
    job: {
      status: "accepted",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(2)),
      helper_dayof_confirmed_at: ISO(-HOURS(2)),
      date_needed: DATE_ONLY(0),
    },
    application: { status: "accepted" },
  },
  {
    key: "active-arrival-none",
    derived: "isActive",
    describe: "in_progress, on the way, nothing claimed — tracker current step = On the Way",
    job: {
      status: "in_progress",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(1)),
      helper_dayof_confirmed_at: ISO(-HOURS(4)),
      helper_on_the_way_at: ISO(-HOURS(1)),
      date_needed: DATE_ONLY(0),
    },
    application: { status: "accepted" },
  },
  {
    key: "active-arrival-claimed",
    derived: "isActive",
    describe:
      "in_progress, arrival CLAIMED and not verified — arrivalEstablished() is false, so the tracker refuses to advance past Arrived and the CTA explains why",
    job: {
      status: "in_progress",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(1)),
      helper_dayof_confirmed_at: ISO(-HOURS(4)),
      helper_on_the_way_at: ISO(-HOURS(2)),
      helper_arrived_at: ISO(-HOURS(1)),
      date_needed: DATE_ONLY(0),
    },
    application: { status: "accepted" },
  },
  {
    key: "active-arrival-verified",
    derived: "isActive",
    describe:
      "in_progress, arrival VERIFIED — same pixels except the caption and the unlocked CTA; the pair with the cell above is the whole point of the claimed/verified axis",
    job: {
      status: "in_progress",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(1)),
      helper_dayof_confirmed_at: ISO(-HOURS(4)),
      helper_on_the_way_at: ISO(-HOURS(2)),
      helper_arrived_at: ISO(-HOURS(1)),
      helper_arrival_verified_at: ISO(-HOURS(1)),
      date_needed: DATE_ONLY(0),
    },
    application: { status: "accepted" },
  },
  {
    key: "active-payout-gate-closed",
    derived: "isActive",
    describe:
      "in_progress, arrived 5 minutes ago — the 30-minute payout gate is shut, so 'I'm Done' reads 'Available in N min' and is disabled",
    job: {
      status: "in_progress",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(1)),
      helper_dayof_confirmed_at: ISO(-HOURS(4)),
      helper_on_the_way_at: ISO(-HOURS(1)),
      helper_arrived_at: ISO(-HOURS(0.08)),
      helper_arrival_verified_at: ISO(-HOURS(0.08)),
      poster_confirmed_working_at: ISO(-HOURS(0.08)),
      date_needed: DATE_ONLY(0),
    },
    application: { status: "accepted" },
  },
  {
    key: "active-submitted",
    derived: "isActive",
    describe:
      "in_progress, helper submitted and is waiting on approval — bucket = Waiting even though the day has passed",
    job: {
      status: "in_progress",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(1)),
      helper_arrived_at: ISO(-HOURS(6)),
      helper_arrival_verified_at: ISO(-HOURS(6)),
      poster_confirmed_working_at: ISO(-HOURS(5)),
      helper_completed_at: ISO(-HOURS(1)),
      proof_before_urls: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="],
      proof_after_urls: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="],
      date_needed: DATE_ONLY(-DAYS(1)),
    },
    application: { status: "accepted" },
  },
  {
    key: "active-past-due-not-started",
    derived: "isActive",
    describe:
      "in_progress, day gone, nothing submitted — appliedActivityBucket sends it to Needs you; the overdue band must read as a fact, not an accusation",
    job: {
      status: "in_progress",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(4)),
      date_needed: DATE_ONLY(-DAYS(4)),
    },
    application: { status: "accepted" },
  },
  {
    key: "revision-awaiting-fix",
    derived: "isActive (revision_requested)",
    describe: "revision_requested — HelperRevisionCard with I'll Fix It / Discuss and a fix deadline",
    job: {
      status: "revision_requested",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(2)),
      helper_arrived_at: ISO(-DAYS(1)),
      helper_arrival_verified_at: ISO(-DAYS(1)),
      helper_completed_at: ISO(-DAYS(1)),
      revision_requested_at: ISO(-HOURS(20)),
      revision_note: "The upstairs bathroom mirror and the baseboards in the hall were missed.",
      revision_deadline: ISO(HOURS(8)),
      revision_count: 1,
      date_needed: DATE_ONLY(-DAYS(1)),
    },
    application: { status: "accepted" },
  },
  {
    key: "revision-fixed",
    derived: "isActive (revision_requested)",
    describe: "revision_requested with the fix submitted — Mark Fixed gone, acceptance countdown running",
    job: {
      status: "revision_requested",
      helper_id: HELPER_ID,
      helper_confirmed_at: ISO(-DAYS(2)),
      helper_arrived_at: ISO(-DAYS(1)),
      helper_arrival_verified_at: ISO(-DAYS(1)),
      helper_completed_at: ISO(-DAYS(1)),
      revision_requested_at: ISO(-DAYS(1)),
      revision_note: "The upstairs bathroom mirror and the baseboards in the hall were missed.",
      revision_completed_at: ISO(-HOURS(2)),
      revision_acceptance_deadline: ISO(HOURS(10)),
      revision_count: 1,
      date_needed: DATE_ONLY(-DAYS(1)),
    },
    application: { status: "accepted" },
  },
  {
    key: "disputed-can-respond",
    derived: "isDisputed",
    describe: "disputed, dispute open, helper has not responded — the respond form is live",
    job: {
      status: "disputed",
      helper_id: HELPER_ID,
      ...completedStamps(),
      has_active_dispute: true,
      dispute_status: "open",
      disputed_by: POSTER_ID,
      dispute_reason: "The hallway baseboards were not touched and the mirror is still streaked.",
      dispute_deadline: ISO(HOURS(40)),
    },
    application: { status: "accepted" },
  },
  {
    key: "disputed-responded",
    derived: "isDisputed",
    describe: "disputed, helper has responded — quoted 'Your response' block replaces the form",
    job: {
      status: "disputed",
      helper_id: HELPER_ID,
      ...completedStamps(),
      has_active_dispute: true,
      dispute_status: "open",
      disputed_by: POSTER_ID,
      dispute_reason: "The hallway baseboards were not touched.",
      dispute_helper_response: "Before-and-after photos attached; the baseboards were done first.",
      dispute_deadline: ISO(HOURS(40)),
    },
    application: { status: "accepted" },
  },
  {
    key: "disputed-escalated",
    derived: "isDisputed",
    describe: "disputed and escalated to admin — awaitingAdmin copy, deadline box suppressed",
    job: {
      status: "disputed",
      helper_id: HELPER_ID,
      ...completedStamps(),
      has_active_dispute: true,
      dispute_status: "escalated",
      disputed_by: POSTER_ID,
      dispute_reason: "The hallway baseboards were not touched.",
      dispute_helper_response: "Before-and-after photos attached.",
    },
    application: { status: "accepted" },
  },
  {
    key: "completed-not-reviewed",
    derived: "isCompleted",
    describe: "completed, helper has not reviewed the poster yet — Review Poster live, DisputeLink still in its 7-day window",
    job: { status: "completed", helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" },
    application: { status: "accepted" },
  },
  {
    key: "fully-done",
    derived: "isFullyDone",
    describe: "completed and reviewed — the 'Reviewed' strip; the only remaining control is a dispute link",
    job: { status: "completed", helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" },
    application: { status: "accepted" },
    reviewedJobIds: [CELL_JOB_ID],
  },
  {
    key: "safety-net-unreachable-tuple",
    derived: "none",
    describe:
      "app.status = pending against an in_progress job — no derived section matches, so the card falls through to the 'No actions available on this application right now' string. Reachable in production only through a race; enumerated because the string exists and nobody has ever looked at it",
    job: { status: "in_progress", helper_id: OTHER_ID, date_needed: DATE_ONLY(0) },
    application: { status: "pending" },
  },
];

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

function posterCells(): StateCell[] {
  const cells: StateCell[] = [];
  for (const status of JOB_STATUSES) {
    const subs = POSTER_SUBSTATES[status];
    subs.forEach((sub, i) => {
      for (const expanded of [false, true]) {
        // R9 — the first sub-state of each status is the status-defining cell.
        const primaryOnly = !(i === 0 && expanded);
        cells.push({
          id: slug(`posted-${status}-${sub.key}-${expanded ? "expanded" : "collapsed"}`),
          surface: "posted-card",
          route: "/my-posts?filter=all",
          describe: `Poster card — ${sub.describe} (${expanded ? "expanded" : "collapsed"}).`,
          status,
          axes: {
            role: "poster",
            status,
            substate: sub.key,
            expanded: String(expanded),
            content: "default",
          },
          expanded,
          reachable: "auto",
          shots: shotsFor(primaryOnly),
          fixture: {
            job: { ...BASE_JOB, status, ...sub.job } as CellFixture["job"],
            applicants: sub.applicants ?? 0,
            tippedJobIds: sub.tippedJobIds,
            reviewedJobIds: sub.reviewedJobIds,
          },
        });
      }
    });
  }

  // R5 — content-profile cells, on one representative status each, expanded.
  const contentCases: { key: string; describe: string; job: Record<string, unknown> }[] = [
    {
      key: "rich-content",
      describe:
        "130-character title, a 40-character unbroken token, special requirements and five photos — the truncation and overflow probe",
      job: { status: "open", ...CONTENT_PROFILES.rich },
    },
    {
      key: "sparse-content",
      describe:
        "title identical to the description (hasDescription false) and no photos — the collapse-the-empty-band probe",
      job: { status: "open", ...CONTENT_PROFILES.sparse },
    },
    {
      key: "recurring-series-parent",
      describe: "a series parent — SeriesStrip with day list, week count and a committed helper",
      job: {
        status: "open",
        is_recurring: true,
        recurrence_days: [1, 3, 5],
        recurrence_weeks: 4,
        recurring_helper_id: HELPER_ID,
        parent_job_id: null,
      },
    },
    {
      key: "recurring-series-child",
      describe:
        "a series CHILD occurrence (parent_job_id set) — SeriesStrip must not render, only the meta-row recurrence chip",
      job: {
        status: "accepted",
        helper_id: HELPER_ID,
        helper_confirmed_at: ISO(-HOURS(6)),
        is_recurring: true,
        parent_job_id: "10000000-0000-4000-8000-0000000parent",
        date_needed: DATE_ONLY(DAYS(1)),
      },
    },
    {
      key: "group-job",
      describe: "is_group_job — the helpers-needed chip and the GroupJobHelpers roster",
      job: { status: "open", is_group_job: true },
    },
  ];
  for (const c of contentCases) {
    cells.push({
      id: slug(`posted-content-${c.key}`),
      surface: "posted-card",
      route: "/my-posts?filter=all",
      describe: `Poster card — ${c.describe} (expanded).`,
      status: (c.job.status as JobStatus) ?? null,
      axes: { role: "poster", status: String(c.job.status), substate: c.key, expanded: "true", content: c.key },
      expanded: true,
      reachable: "auto",
      shots: shotsFor(false),
      fixture: { job: { ...BASE_JOB, ...c.job } as CellFixture["job"], applicants: 2 },
    });
  }

  // R8 — the category palette, once, instead of x12 on every status.
  cells.push({
    id: "posted-category-palette",
    surface: "posted-card",
    route: "/my-posts?filter=all",
    describe:
      "All twelve categories as sibling cards — the one cell that answers 'do these twelve hues read as one system, and is any pair indistinguishable'.",
    status: "open",
    axes: { role: "poster", status: "open", substate: "category-palette", expanded: "false", content: "twelve-categories" },
    expanded: false,
    reachable: "auto",
    shots: [SHOT_PRIMARY, SHOT_DARK],
    fixture: { job: { ...BASE_JOB } as CellFixture["job"], applicants: 0, tables: { __categoryPalette: [] } },
  });

  return cells;
}

function appliedCells(): StateCell[] {
  const cells: StateCell[] = [];
  APPLIED_STATES.forEach((s, i) => {
    const expansions = s.expandable === false ? [false] : [false, true];
    for (const expanded of expansions) {
      const primaryOnly = !(expanded || s.expandable === false) || i > 0 ? !(i % 4 === 0 && expanded) : false;
      cells.push({
        id: slug(`applied-${s.key}-${expanded ? "expanded" : "collapsed"}`),
        surface: "applied-card",
        route: "/my-jobs?filter=all",
        describe: `Helper card — ${s.describe} (${expanded ? "expanded" : "collapsed"}).`,
        status: (s.job?.status as JobStatus) ?? null,
        derived: s.derived,
        axes: {
          role: "helper",
          derived: s.derived,
          substate: s.key,
          jobStatus: String(s.job?.status ?? "none"),
          appStatus: String(s.application.status),
          expanded: String(expanded),
        },
        expanded,
        reachable: "auto",
        shots: shotsFor(primaryOnly),
        fixture: {
          job: s.job ? ({ ...BASE_JOB, ...s.job, customer_id: POSTER_ID } as CellFixture["job"]) : undefined,
          application: { ...BASE_APPLICATION, ...s.application } as CellFixture["application"],
          reviewedJobIds: s.reviewedJobIds,
        },
      });
    }
  });

  // Content cells specific to the helper card.
  const helperContent = [
    {
      key: "no-location",
      describe:
        "confirmed booking with an EMPTY location — DirectionsButton self-hides and the action row drops from 3 columns to 2; the remaining two must not stretch or leave a gap",
      job: { status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(8)), location: "", date_needed: DATE_ONLY(DAYS(1)) },
    },
    {
      key: "pet-care-confirmed",
      describe: "category = pet_care on a confirmed booking — the JobPetCareSheet trigger appears",
      job: { status: "accepted", category: "pet_care", helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(8)), date_needed: DATE_ONLY(DAYS(1)) },
    },
    {
      key: "rich-content",
      describe: "the 130-character title and 40-character token on the helper card",
      job: { status: "open", ...CONTENT_PROFILES.rich },
    },
  ];
  for (const c of helperContent) {
    cells.push({
      id: slug(`applied-content-${c.key}`),
      surface: "applied-card",
      route: "/my-jobs?filter=all",
      describe: `Helper card — ${c.describe} (expanded).`,
      status: (c.job.status as JobStatus) ?? null,
      axes: { role: "helper", substate: c.key, expanded: "true", content: c.key },
      expanded: true,
      reachable: "auto",
      shots: shotsFor(false),
      fixture: {
        job: { ...BASE_JOB, ...c.job, customer_id: POSTER_ID } as CellFixture["job"],
        application: { ...BASE_APPLICATION, status: c.job.status === "open" ? "pending" : "accepted" } as CellFixture["application"],
      },
    });
  }

  return cells;
}

/**
 * The activity shell itself: tab x bucket x density. This is the surface that
 * decides which cards exist at all, and its EMPTY states are where the
 * "40px band where content should be" class lives.
 */
function activityShellCells(): StateCell[] {
  const buckets = ["needs_you", "waiting", "scheduled", "done", "cancelled", "all"];
  const cells: StateCell[] = [];
  for (const tab of [
    { key: "posted", route: "/my-posts" },
    { key: "applied", route: "/my-jobs" },
  ]) {
    for (const bucket of buckets) {
      for (const density of ["empty", "rich"] as const) {
        cells.push({
          id: slug(`shell-${tab.key}-${bucket}-${density}`),
          surface: "activity-shell",
          route: `${tab.route}?filter=${bucket}`,
          describe: `Activity ${tab.key} tab, bucket "${bucket}", ${density} data — the tab strip, the filter chips, the counts and (when empty) ActivityEmptyState's pointer copy.`,
          axes: { tab: tab.key, bucket, density },
          expanded: false,
          reachable: "auto",
          shots: bucket === "needs_you" ? shotsFor(false) : [SHOT_PRIMARY],
          fixture: { tables: { __density: [density] } },
        });
      }
    }
  }
  return cells;
}

/**
 * The tracker rail, driven on its own so each step position gets a frame.
 *
 * The rail is also captured inside every expanded card cell above; these cells
 * exist because the card cells cannot force every step (a poster card and a
 * helper card show DIFFERENT rails for the same job — `includePostingSteps` is
 * poster-only, which shifts every index by one) and because the colour question
 * — two greens on one rail — needs a frame per position to be judged.
 */
function trackerCells(): StateCell[] {
  const positions: { key: string; describe: string; job: Record<string, unknown> }[] = [
    { key: "assigned", describe: "current step = Offered", job: { status: "accepted", helper_id: HELPER_ID, date_needed: DATE_ONLY(DAYS(1)) } },
    { key: "confirmed", describe: "current step = Accepted", job: { status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(6)), date_needed: DATE_ONLY(DAYS(1)) } },
    { key: "job-confirmed", describe: "current step = Confirmed (day-of confirmation stamped)", job: { status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(3)), date_needed: DATE_ONLY(0) } },
    { key: "on-the-way", describe: "current step = On the Way", job: { status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(3)), helper_on_the_way_at: ISO(-HOURS(1)), date_needed: DATE_ONLY(0) } },
    { key: "arrived-claimed", describe: "current step = Arrived, arrival CLAIMED — amber 'Awaiting poster' caption", job: { status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(3)), helper_on_the_way_at: ISO(-HOURS(2)), helper_arrived_at: ISO(-HOURS(1)), date_needed: DATE_ONLY(0) } },
    { key: "arrived-verified", describe: "arrival VERIFIED — 'Location confirmed' caption, rail may advance", job: { status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(3)), helper_on_the_way_at: ISO(-HOURS(2)), helper_arrived_at: ISO(-HOURS(1)), helper_arrival_verified_at: ISO(-HOURS(1)), date_needed: DATE_ONLY(0) } },
    { key: "arrived-poster-confirmed", describe: "arrival CONFIRMED by the poster — 'Poster confirmed' caption", job: { status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(3)), helper_on_the_way_at: ISO(-HOURS(2)), helper_arrived_at: ISO(-HOURS(1)), poster_confirmed_arrival_at: ISO(-HOURS(1)), date_needed: DATE_ONLY(0) } },
    { key: "working", describe: "current step = Working — MID-RAIL: passed steps use --success-ink, the current step uses --bark. Two greens, one rail.", job: { status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(4)), helper_on_the_way_at: ISO(-HOURS(3)), helper_arrived_at: ISO(-HOURS(2)), helper_arrival_verified_at: ISO(-HOURS(2)), poster_confirmed_arrival_at: ISO(-HOURS(2)), poster_confirmed_working_at: ISO(-HOURS(2)), date_needed: DATE_ONLY(0) } },
    { key: "done", describe: "current step = Done, allDone true — the current dot switches from --bark to --success-ink", job: { status: "completed", helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" } },
    { key: "revision-amber", describe: "revision_requested — the current dot paints --amber-solid while passed dots stay --success-ink", job: { status: "revision_requested", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(2)), helper_dayof_confirmed_at: ISO(-DAYS(1)), helper_on_the_way_at: ISO(-DAYS(1)), helper_arrived_at: ISO(-DAYS(1)), helper_arrival_verified_at: ISO(-DAYS(1)), helper_completed_at: ISO(-DAYS(1)), revision_requested_at: ISO(-HOURS(10)), revision_note: "Baseboards missed.", revision_deadline: ISO(HOURS(10)), date_needed: DATE_ONLY(-DAYS(1)) } },
    { key: "disputed-red", describe: "disputed — the Working dot paints --destructive regardless of position, beside green passed dots", job: { status: "disputed", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_dayof_confirmed_at: ISO(-HOURS(8)), helper_on_the_way_at: ISO(-HOURS(6)), helper_arrived_at: ISO(-HOURS(5)), helper_arrival_verified_at: ISO(-HOURS(5)), poster_confirmed_arrival_at: ISO(-HOURS(5)), has_active_dispute: true, dispute_status: "open", disputed_by: POSTER_ID, dispute_reason: "Stopped halfway.", dispute_deadline: ISO(HOURS(60)), date_needed: DATE_ONLY(0) } },
  ];

  const cells: StateCell[] = [];
  for (const p of positions) {
    for (const view of [
      { key: "poster", route: "/my-posts?filter=all", note: "poster view — includePostingSteps adds a 'Posted' pre-step, shifting every index by one" },
      { key: "helper", route: "/my-jobs?filter=all", note: "helper view — no pre-step; the SAME job renders a rail one step shorter" },
    ]) {
      cells.push({
        id: slug(`tracker-${p.key}-${view.key}`),
        surface: "tracker",
        route: view.route,
        describe: `Tracker rail — ${p.describe}. ${view.note}.`,
        status: p.job.status as JobStatus,
        axes: { surface: "tracker", position: p.key, view: view.key },
        expanded: true,
        reachable: "auto",
        shots: p.key === "working" || p.key === "done" ? shotsFor(false) : [SHOT_PRIMARY, SHOT_DARK],
        fixture: {
          job: { ...BASE_JOB, ...p.job, customer_id: POSTER_ID } as CellFixture["job"],
          application: { ...BASE_APPLICATION, status: "accepted" } as CellFixture["application"],
        },
      });
    }
  }
  return cells;
}

/**
 * The browse job-detail dialog. Its branches are viewer-shaped, not
 * status-shaped: it is the OPEN-job preview, so `job.status` barely moves it
 * while `guest`, `viewerUserId` and `credential_tier` move it a lot.
 */
function jobDetailCells(): StateCell[] {
  const viewers = [
    { key: "guest", route: "/browse", describe: "signed-out viewer — no save/share/report corner actions, single 'Sign up to apply' CTA", reachable: "auto" as Reachability },
    { key: "helper-not-applied", route: "/dashboard", describe: "signed-in helper who has not applied — Apply / Continue CTA", reachable: "auto" as Reachability },
    { key: "helper-applied", route: "/dashboard", describe: "helper who already applied — CTA reads 'Applied — #N'", reachable: "auto" as Reachability },
    { key: "poster-own-job", route: "/dashboard", describe: "the poster looking at their own post — CTA reads 'This is your post'", reachable: "auto" as Reachability },
    { key: "credential-gated", route: "/dashboard", describe: "credential_tier above the viewer's tier — the CTA becomes a gate button whose label differs per tier", reachable: "auto" as Reachability },
    { key: "instant-book", route: "/dashboard", describe: "instant_book job — CTA reads 'Book Now' rather than Apply", reachable: "auto" as Reachability },
  ];
  const cells: StateCell[] = viewers.map((v) => ({
    id: slug(`job-detail-${v.key}`),
    surface: "job-detail",
    route: v.route,
    describe: `Job detail dialog — ${v.describe}.`,
    status: "open",
    axes: { surface: "job-detail", viewer: v.key, step: "detail" },
    expanded: false,
    reachable: v.reachable,
    open: ["job card"],
    shots: shotsFor(v.key === "guest"),
    fixture: { job: { ...BASE_JOB } as CellFixture["job"] },
  }));

  cells.push({
    id: "job-detail-apply-step",
    surface: "job-detail",
    route: "/dashboard",
    describe:
      "Job detail dialog, step = 'apply' — the second screen of a two-step dialog. The route sweep only ever saw step 1.",
    status: "open",
    axes: { surface: "job-detail", viewer: "helper-not-applied", step: "apply" },
    expanded: false,
    reachable: "interaction",
    reason: "requires clicking the Apply CTA inside the open dialog",
    open: ["job card", "Apply"],
    shots: shotsFor(false),
    fixture: { job: { ...BASE_JOB } as CellFixture["job"] },
  });

  cells.push({
    id: "job-detail-photo-none",
    surface: "job-detail",
    route: "/dashboard",
    describe: "Job detail dialog on a job with NO photos — the cover-image slot must collapse, not leave a band.",
    status: "open",
    axes: { surface: "job-detail", viewer: "helper-not-applied", content: "no-photos" },
    expanded: false,
    reachable: "auto",
    open: ["job card"],
    shots: [SHOT_PRIMARY],
    fixture: { job: { ...BASE_JOB, photos: null } as CellFixture["job"] },
  });
  cells.push({
    id: "job-detail-photo-many",
    surface: "job-detail",
    route: "/dashboard",
    describe: "Job detail dialog with five photos plus a scope video — cover image, 'View All' pill and the video block stacked.",
    status: "open",
    axes: { surface: "job-detail", viewer: "helper-not-applied", content: "five-photos-plus-video" },
    expanded: false,
    reachable: "auto",
    open: ["job card"],
    shots: shotsFor(false),
    fixture: {
      job: { ...BASE_JOB, ...CONTENT_PROFILES.rich, is_urgent: true, is_recurring: true, boost_expires_at: ISO(DAYS(1)) } as CellFixture["job"],
    },
  });

  return cells;
}

/**
 * Multi-step and state-bearing overlays.
 *
 * These are `interaction` cells: the sweep must find and click a trigger, so a
 * renamed button silently drops one. That is why they are tracked separately
 * and why a cell the sweep could not open is reported as UNVERIFIED with the
 * trigger it looked for, rather than quietly omitted.
 */
function dialogCells(): StateCell[] {
  const specs: { id: string; route: string; describe: string; open: string[]; fixture?: CellFixture }[] = [
    {
      id: "dialog-report-step-reason",
      route: "/my-posts?filter=all",
      describe: "ReportDialog step 1 of 3 — 'reason'. Reached from a COMPLETED job's Report Job chip.",
      open: ["card", "Report Job"],
      fixture: { job: { ...BASE_JOB, status: "completed", helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" } as CellFixture["job"] },
    },
    {
      id: "dialog-report-step-details",
      route: "/my-posts?filter=all",
      describe: "ReportDialog step 2 of 3 — 'details'. Never captured by any prior sweep.",
      open: ["card", "Report Job", "<first reason>", "Continue"],
      fixture: { job: { ...BASE_JOB, status: "completed", helper_id: HELPER_ID, ...completedStamps(), payment_status: "released" } as CellFixture["job"] },
    },
    {
      id: "dialog-completion-choice",
      route: "/my-posts?filter=all",
      describe: "CompletionChoiceSheet mode = 'choice' — approve or ask for a revision.",
      open: ["card", "Approve"],
      fixture: { job: { ...BASE_JOB, status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_arrived_at: ISO(-HOURS(5)), helper_arrival_verified_at: ISO(-HOURS(5)), poster_confirmed_arrival_at: ISO(-HOURS(5)), poster_confirmed_working_at: ISO(-HOURS(4)), helper_completed_at: ISO(-HOURS(1)), date_needed: DATE_ONLY(0) } as CellFixture["job"] },
    },
    {
      id: "dialog-completion-revision",
      route: "/my-posts?filter=all",
      describe: "CompletionChoiceSheet mode = 'revision' — step 2 of the same sheet.",
      open: ["card", "Approve", "revision"],
      fixture: { job: { ...BASE_JOB, status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_arrived_at: ISO(-HOURS(5)), helper_arrival_verified_at: ISO(-HOURS(5)), poster_confirmed_arrival_at: ISO(-HOURS(5)), poster_confirmed_working_at: ISO(-HOURS(4)), helper_completed_at: ISO(-HOURS(1)), date_needed: DATE_ONLY(0) } as CellFixture["job"] },
    },
    {
      id: "dialog-cancellation",
      route: "/my-posts?filter=all",
      describe: "CancellationDialog on an ACCEPTED job — the fee-consequence copy differs from the open-job case.",
      open: ["card", "Cancel"],
      fixture: { job: { ...BASE_JOB, status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(6)), date_needed: DATE_ONLY(DAYS(1)) } as CellFixture["job"] },
    },
    {
      id: "dialog-boost",
      route: "/my-posts?filter=all",
      describe: "JobBoostDialog on an open job.",
      open: ["card", "Boost"],
      fixture: { job: { ...BASE_JOB, status: "open" } as CellFixture["job"] },
    },
    {
      id: "dialog-edit-job",
      route: "/my-posts?filter=all",
      describe: "EditJobDialog on an open job — the longest form the app renders inside a dialog.",
      open: ["card", "Edit"],
      fixture: { job: { ...BASE_JOB, status: "open" } as CellFixture["job"] },
    },
    {
      id: "dialog-dispute-timeline",
      route: "/my-posts?filter=all",
      describe: "DisputeTimelineDialog on a disputed job.",
      open: ["card", "Timeline"],
      fixture: { job: { ...BASE_JOB, status: "disputed", helper_id: HELPER_ID, ...completedStamps(), has_active_dispute: true, dispute_status: "open", disputed_by: POSTER_ID, dispute_reason: "Baseboards missed.", dispute_deadline: ISO(HOURS(40)) } as CellFixture["job"] },
    },
    {
      id: "dialog-decline-applicant",
      route: "/my-posts?filter=all",
      describe: "DeclineApplicantSheet from the applicants panel of an open job.",
      open: ["card", "Applicants", "Decline"],
      fixture: { job: { ...BASE_JOB, status: "open" } as CellFixture["job"], applicants: 3 },
    },
    {
      id: "dialog-helper-cant-make-it",
      route: "/my-jobs?filter=all",
      describe: "Helper-side 'Can't Make It' confirm on a confirmed booking — the money-consequence copy.",
      open: ["card", "Can't Make It"],
      fixture: {
        job: { ...BASE_JOB, status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: ISO(-HOURS(8)), date_needed: DATE_ONLY(DAYS(1)) } as CellFixture["job"],
        application: { ...BASE_APPLICATION, status: "accepted" } as CellFixture["application"],
      },
    },
    {
      id: "dialog-helper-cant-finish",
      route: "/my-jobs?filter=all",
      describe:
        "Helper-side 'Can't Finish' confirm AFTER work started — abortWorkStarted flips the consequence copy; the pre-start variant is a different sentence in the same dialog.",
      open: ["card", "Can't Finish"],
      fixture: {
        job: { ...BASE_JOB, status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: ISO(-DAYS(1)), helper_arrived_at: ISO(-HOURS(2)), helper_arrival_verified_at: ISO(-HOURS(2)), date_needed: DATE_ONLY(0) } as CellFixture["job"],
        application: { ...BASE_APPLICATION, status: "accepted" } as CellFixture["application"],
      },
    },
    {
      id: "dialog-withdraw-application",
      route: "/my-jobs?filter=all",
      describe: "Helper-side Withdraw confirm on a pending application.",
      open: ["card", "Withdraw"],
      fixture: {
        job: { ...BASE_JOB, status: "open" } as CellFixture["job"],
        application: { ...BASE_APPLICATION, status: "pending" } as CellFixture["application"],
      },
    },
  ];

  return specs.map((s) => ({
    id: s.id,
    surface: "dialog" as Surface,
    route: s.route,
    describe: s.describe,
    axes: { surface: "dialog", dialog: s.id.replace(/^dialog-/, "") },
    expanded: true,
    reachable: "interaction" as Reachability,
    reason: `must click ${s.open.join(" -> ")}; a renamed trigger drops this cell and it is reported UNVERIFIED rather than omitted`,
    open: s.open,
    shots: [SHOT_PRIMARY, SHOT_DARK],
    fixture: s.fixture,
  }));
}

/**
 * Cells this harness deliberately does NOT drive, each with the reason.
 *
 * They are in the manifest because a named gap is auditable and a silent one is
 * not. The COVERAGE_LEDGER counts them as UNVERIFIED, never as passes.
 */
function declaredGaps(): StateCell[] {
  const gap = (
    id: string,
    surface: Surface,
    describe: string,
    reachable: Reachability,
    reason: string,
  ): StateCell => ({
    id,
    surface,
    route: "-",
    describe,
    axes: { surface, kind: "declared-gap" },
    expanded: false,
    reachable,
    reason,
    shots: [],
  });

  return [
    gap(
      "gap-in-flight-button-guards",
      "posted-card",
      "Every mutation's in-flight button state: Confirming…, Withdrawing…, the disabled Approve chip while completingJobId matches.",
      "unreachable",
      "R6 — reachable only by winning a race against a mocked 201 response. Six such guards exist across the two cards; none is captured.",
    ),
    gap(
      "gap-app-lock-after-jetsam",
      "activity-shell",
      "AppLockGate re-arming after iOS terminates the WKWebView content process and the app is restored from a snapshot.",
      "native",
      "Chromium has no content-process jetsam. This bug existed only because iOS kills the web view; no browser-based harness can reproduce it. Physical device or simulator memory pressure only.",
    ),
    gap(
      "gap-keyboard-covers-sheet",
      "dialog",
      "The software keyboard covering a sheet's primary action when a field inside it takes focus.",
      "native",
      "Chromium has no software keyboard and does not resize the visual viewport the way WKWebView does. Requires the iOS Simulator with the software keyboard forced on, or a device.",
    ),
    gap(
      "gap-safe-area-insets",
      "activity-shell",
      "env(safe-area-inset-*) under a real notch/home indicator, including landscape where the left/right insets become non-zero.",
      "native",
      "Chromium reports zero safe-area insets. Emulating them with CSS proves the CSS, not the app. Simulator or device only.",
    ),
    gap(
      "gap-native-os-prompts",
      "dialog",
      "Camera, geolocation, push, Face ID, share sheet, social-auth and in-app-browser system dialogs.",
      "native",
      "These are OS surfaces, not app surfaces. They render outside the web view entirely.",
    ),
    gap(
      "gap-realtime-transitions",
      "posted-card",
      "A card changing state under the reader because a realtime event arrived — the transition, not either endpoint.",
      "unreachable",
      "fixtures.ts replaces the realtime WebSocket with an inert socket on purpose. Both endpoints of every transition are enumerated above; the animation between them is not.",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function enumerateStates(): StateCell[] {
  return [
    ...posterCells(),
    ...appliedCells(),
    ...trackerCells(),
    ...activityShellCells(),
    ...jobDetailCells(),
    ...dialogCells(),
    ...declaredGaps(),
  ];
}

export interface MatrixSummary {
  total: number;
  shots: number;
  bySurface: Record<string, number>;
  byReachability: Record<string, number>;
  byStatus: Record<string, number>;
}

export function summarize(cells: StateCell[]): MatrixSummary {
  const bump = (o: Record<string, number>, k: string) => {
    o[k] = (o[k] ?? 0) + 1;
  };
  const bySurface: Record<string, number> = {};
  const byReachability: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let shots = 0;
  for (const c of cells) {
    bump(bySurface, c.surface);
    bump(byReachability, c.reachable);
    if (c.status) bump(byStatus, c.status);
    shots += c.shots.length;
  }
  return { total: cells.length, shots, bySurface, byReachability, byStatus };
}

/**
 * The collapsing rules, machine-readable, so the generated manifest document
 * and this module can never disagree about what was collapsed away.
 */
export const COLLAPSING_RULES = [
  { id: "R1", rule: "Status is the outer axis; a sub-axis is enumerated only for the statuses whose code path reads it." },
  { id: "R2", rule: "The helper card is a derived state machine — enumerate its ~10 sections, not application_status x job_status." },
  { id: "R3", rule: "Expansion is orthogonal and doubles every card cell, except minimal cards which pass expandable={false}." },
  { id: "R4", rule: "Cosmetic call-site props (tone, columns, size, variant, inline) collapse to one representative value." },
  { id: "R5", rule: "Data presence is a 3-valued content profile (empty/sparse/rich) plus named content cells, not N independent booleans." },
  { id: "R6", rule: "Transient in-flight button guards are declared unreachable with a reason rather than enumerated." },
  { id: "R7", rule: "Clock axes are enumerated at their boundaries (calm / <12h / <2h / expired; on-time / due-today / N-days-past) against a single run clock." },
  { id: "R8", rule: "Category collapses to pet_care + one representative, plus one twelve-category palette cell." },
  { id: "R9", rule: "Breakpoint and theme apply to a subset: every cell at 390 light; status-defining cells also at 390 dark, 1440 light and 320 light." },
] as const;
