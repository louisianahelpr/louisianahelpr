/**
 * Deterministic seed data for the audit sweep.
 *
 * WHY THIS EXISTS
 * ---------------
 * `installSupabaseMocks()` answered every table SELECT with `[]` and every RPC
 * with `null`. That is correct for the happy-path specs — they assert on flows
 * they drive themselves — but it meant the visual/a11y sweep only ever
 * photographed EMPTY STATES. Every job list, every message thread, every
 * applicant panel, every earnings screen rendered its zero-state. The populated
 * layouts — the ones users actually look at, and the ones where truncation,
 * overflow, long names and status pills go wrong — were never audited at all.
 *
 * So this module supplies realistic rows. It is test data only: no real user
 * data, no network, no database writes. IDs are fixed so screenshots are
 * byte-stable across runs and a visual diff means a real change.
 *
 * DESIGN RULES
 * ------------
 * 1. One job per `job_status` enum value, so every status pill, every card
 *    variant and every bucket in Activity has something in it.
 * 2. Deliberately awkward content in a few rows — a very long title, an
 *    unbroken 40-character string, a long email, an accented name. Layout
 *    breaks on real-world content, not on "Test Job 1".
 * 3. Every NON-NULLABLE column from the generated `types.ts` is present, so a
 *    row is shape-valid against the real schema. Nullable columns are filled
 *    only where the UI reads them.
 * 4. Dates are fixed strings, never `Date.now()` — a moving clock makes
 *    "2 days ago" labels churn and defeats visual diffing.
 */

// Mirrors FAKE_CUSTOMER.id / FAKE_HELPER.id in ./fixtures. Duplicated as
// literals rather than imported to avoid a circular import (fixtures imports
// SEED_TABLES from here). They MUST stay in step: rows keyed to a different
// helper id simply will not appear on the helper-role screens, which looks
// like "the seed did not work" rather than an id mismatch.
export const CUSTOMER_ID = "00000000-0000-4000-8000-00000000c1ce";
export const HELPER_ID = "00000000-0000-4000-8000-00000000he1p";

/** Fixed clock. Everything is relative to this, nothing calls Date.now(). */
const NOW = "2026-08-14T12:00:00.000Z";
const AGO = (d: number) =>
  new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

/**
 * `date_needed` is a Postgres `date`, NOT a timestamptz — PostgREST returns it
 * as a bare "YYYY-MM-DD". Mock rows must match, because consumers parse it as
 * such: JobCountdown does `dateNeeded.split("-").map(Number)`, so handing it a
 * full ISO string makes `day` parse as "15T12:00:00.000Z" → NaN, and the pill
 * renders "Job starts in: NaNm".
 *
 * That is a FIXTURE bug, not an app bug — verified against the live schema
 * (`information_schema.columns` reports date_needed = date, start_time = time
 * without time zone). Getting the column type wrong here would have produced a
 * convincing false finding, so: match the wire format, don't approximate it.
 */
/**
 * ⚠️ Anchored to the REAL today, not to `NOW`.
 *
 * `NOW` is deliberately frozen so `created_at`/`updated_at` stay deterministic.
 * `date_needed` cannot be: the browse feed drops any job whose `date_needed` is
 * before the viewer's LOCAL today ("a job wanted yesterday is noise in the
 * browse feed" — useDashboardFilters). Anchoring a "3 days out" job to a frozen
 * 2026-08-14 meant that on 2026-08-22 every seeded job was 5 days stale and the
 * feed filtered ALL of them out.
 *
 * The failure is silent and expensive: specs that seed jobs still pass, because
 * an empty feed renders its empty state perfectly well. They simply stop
 * testing the populated layout they exist to cover — the same shape as the
 * `open_jobs_browse` hole described below. Keep this relative to real time.
 */
const DATE = (d: number) =>
  new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

type JobSeed = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  budget: number;
  location: string;
  date_needed: string;
  created_at: string;
  customer_id: string;
  helper_id?: string | null;
};

/**
 * Base row carrying every non-nullable column. Spread it, then override.
 * Keeping the defaults in one place means a schema change breaks in one spot
 * rather than in fifteen literals.
 */
const JOB_BASE = {
  bids_sealed: false,
  boost_auto_extended: false,
  credential_tier: 0,
  has_active_dispute: false,
  instant_book: false,
  is_auto_created: false,
  is_flexible_schedule: false,
  pricing_mode: "fixed",
  protection_opted_in: false,
  requires_w9: false,
  review_reminder_sent: false,
  revision_count: 0,
  updated_at: NOW,
};

const JOB_SEEDS: JobSeed[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Deep clean a two-bedroom before move-out",
    description:
      "Full clean — kitchen, two bathrooms, baseboards. Supplies provided. Parking is on the street.",
    category: "cleaning",
    status: "open",
    budget: 180,
    location: "Baton Rouge, LA",
    date_needed: DATE(3),
    created_at: AGO(1),
    customer_id: CUSTOMER_ID,
  },
  {
    // Long title + an unbroken string: the truncation / overflow probe.
    id: "10000000-0000-4000-8000-000000000002",
    title:
      "Help moving a three-piece sectional, a washer and dryer, and roughly twenty boxes up to a second-floor apartment with no elevator",
    description:
      "Reference number NOSPACESHEREATALLFORTYCHARS0123456789 — please quote before accepting.",
    category: "moving",
    status: "accepted",
    budget: 320,
    location: "New Orleans, LA",
    date_needed: DATE(1),
    created_at: AGO(4),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    title: "Mow and edge a corner lot",
    description: "About a third of an acre. Bring your own mower.",
    category: "yard_work",
    status: "in_progress",
    budget: 95,
    location: "Lafayette, LA",
    date_needed: DATE(0),
    created_at: AGO(6),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    title: "Assemble a crib and a changing table",
    description: "Both still boxed. Instructions included.",
    category: "assembly",
    status: "completed",
    budget: 120,
    location: "Shreveport, LA",
    date_needed: DATE(-2),
    created_at: AGO(9),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    title: "Touch-up paint in a hallway",
    description: "Two coats, paint already bought. Needs a second pass.",
    category: "painting",
    status: "revision_requested",
    budget: 140,
    location: "Metairie, LA",
    date_needed: DATE(-1),
    created_at: AGO(7),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    title: "Pre-storm yard prep",
    description: "Secure furniture, clear gutters, move planters inside.",
    category: "storm_prep",
    status: "cancelled",
    budget: 200,
    location: "Houma, LA",
    date_needed: DATE(-5),
    created_at: AGO(12),
    customer_id: CUSTOMER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    title: "Weekly grocery run and pharmacy pickup",
    description: "Recurring errand. List sent the night before.",
    category: "errands",
    status: "disputed",
    budget: 60,
    location: "Slidell, LA",
    date_needed: DATE(-3),
    created_at: AGO(11),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
];

export const SEED_JOBS = JOB_SEEDS.map((j) => ({ ...JOB_BASE, ...j }));

/** Applicants for the open job — drives ApplicantsPanel and its empty→full state. */
export const SEED_APPLICATIONS = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    job_id: SEED_JOBS[0].id,
    helper_id: HELPER_ID,
    status: "pending",
    message:
      "I clean three move-outs a week and can bring my own supplies if that helps.",
    proposed_price: 175,
    created_at: AGO(1),
    updated_at: AGO(1),
    negotiation_status: "none",
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    job_id: SEED_JOBS[0].id,
    helper_id: "00000000-0000-4000-8000-0000000000a2",
    status: "pending",
    // Accented name + long text: the applicant-card layout probe.
    message:
      "Available this weekend. I have worked with Renée on similar jobs in Mid-City and can send references.",
    proposed_price: 190,
    created_at: AGO(2),
    updated_at: AGO(2),
    negotiation_status: "countered",
    counter_price: 185,
  },
];

/** A thread with both sides, an unread, and a long message for bubble wrapping. */
export const SEED_MESSAGES = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    job_id: SEED_JOBS[1].id,
    sender_id: CUSTOMER_ID,
    receiver_id: HELPER_ID,
    content: "Hi! Are you still free Saturday morning?",
    created_at: AGO(2),
    read: true,
    is_system: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    job_id: SEED_JOBS[1].id,
    sender_id: HELPER_ID,
    receiver_id: CUSTOMER_ID,
    content:
      "Yes — I can be there by 9. One thing worth flagging: the sectional will not fit through a standard doorway fully assembled, so I would plan on taking the back off and putting it together upstairs. That adds about thirty minutes but avoids scratching the frame.",
    created_at: AGO(2),
    read: true,
    is_system: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    job_id: SEED_JOBS[1].id,
    sender_id: CUSTOMER_ID,
    receiver_id: HELPER_ID,
    content: "That works. See you then 👍",
    created_at: AGO(1),
    read: true,
    is_system: false,
  },
  {
    // Unread inbound — drives the unread badge and bold row in the list.
    id: "30000000-0000-4000-8000-000000000004",
    job_id: SEED_JOBS[1].id,
    sender_id: HELPER_ID,
    receiver_id: CUSTOMER_ID,
    content: "On my way, running about ten minutes behind.",
    created_at: NOW,
    read: false,
    is_system: false,
  },
];

export const SEED_REVIEWS = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    job_id: SEED_JOBS[3].id,
    reviewer_id: CUSTOMER_ID,
    reviewee_id: HELPER_ID,
    rating: 5,
    comment: "Fast, tidy, and put the boxes exactly where I asked.",
    created_at: AGO(2),
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    job_id: SEED_JOBS[3].id,
    reviewer_id: "00000000-0000-4000-8000-0000000000a2",
    reviewee_id: HELPER_ID,
    rating: 4,
    comment: "Good work overall. Arrived a little late but kept me posted.",
    created_at: AGO(8),
  },
];

export const SEED_NOTIFICATIONS = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    user_id: CUSTOMER_ID,
    type: "application_received",
    title: "New applicant",
    body: "Someone applied to your cleaning job.",
    read: false,
    created_at: AGO(1),
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    user_id: CUSTOMER_ID,
    type: "job_completed",
    title: "Job marked complete",
    body: "Confirm the work to release payment from escrow.",
    read: true,
    created_at: AGO(2),
  },
];

/**
 * Table → rows. `installSupabaseMocks` consults this before falling back to
 * an empty array, so adding a table is a one-line edit here.
 */
/**
 * Counterparty profiles. Without these the message list, applicant cards and
 * review rows render the fallback "User" instead of a name — which reads as a
 * name-resolution bug in a screenshot but is really a missing fixture row.
 * `installSupabaseMocks` still special-cases the AUTHED user's own profile;
 * these cover everyone else the seeded rows reference.
 */
export const SEED_PROFILES = [
  {
    id: `${HELPER_ID}-profile`,
    user_id: HELPER_ID,
    full_name: "Marcus Thibodeaux",
    avatar_url: null,
    location: "New Orleans, LA",
    bio: "Ten years of moving and handyman work across the parish.",
    subscription_tier: "pro",
    is_verified: true,
    approval_status: "approved",
    ban_status: "active",
    created_at: AGO(400),
    updated_at: NOW,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2-profile",
    user_id: "00000000-0000-4000-8000-0000000000a2",
    // Accented + long name: the truncation probe for name rows.
    full_name: "Renée Beauchêne-Landry",
    avatar_url: null,
    location: "Baton Rouge, LA",
    bio: "Detail cleaning, move-outs and post-renovation work.",
    subscription_tier: "free",
    is_verified: true,
    approval_status: "approved",
    ban_status: "active",
    created_at: AGO(200),
    updated_at: NOW,
  },
];

/**
 * ── Business account ──────────────────────────────────────────────────────
 *
 * WHY THIS BLOCK EXISTS
 * ---------------------
 * `businesses` / `business_members` were in NEITHER this file nor any spec, so
 * every `/business/*` route in the catalog only ever rendered
 * `BusinessNoAccountState` — the "you're not part of a business" empty screen.
 * All four routes reported clean, and the actual B2B surface (Team workspace,
 * Billing, Exports, Onboarding, the verification banner) had never been
 * rendered in any test run. Same failure shape as the `open_jobs_browse` hole:
 * the ROUTE was covered, the thing it renders was not.
 *
 * SHAPE NOTE — this is the one fixture where the wire format is non-obvious.
 * `useMyBusiness` reads `business_members` with an EMBEDDED select
 * (`businesses!inner(...)`) and `.maybeSingle()`, so:
 *   1. each membership row must carry a nested `businesses` object, and
 *   2. the `user_id=eq.…&status=eq.active` filter must resolve to exactly ONE
 *      row — two rows make maybeSingle return PGRST116 and the hook falls back
 *      to `null`, i.e. straight back to the empty state this exists to escape.
 * The mock's `applyPostgrestQuery` applies those `eq` filters, so one active
 * membership per user is the invariant to preserve when editing this list.
 */
export const BUSINESS_ID = "60000000-0000-4000-8000-000000000001";

export type BusinessVerification = "none" | "pending" | "verified" | "rejected";

/**
 * The `businesses` row, as PostgREST embeds it under a membership. Every
 * non-nullable column from the generated types is present.
 *
 * `seat_tier: "team"` deliberately: it is a PAID rung, so it also exercises
 * `useBusinessSeatTier` → the TEAM badge on the profile header, which is the
 * one place the business identity leaks outside `/business/*`.
 */
export const makeSeedBusiness = (
  verification: BusinessVerification = "verified",
) => ({
  id: BUSINESS_ID,
  name: "Bayou Logistics LLC",
  owner_id: CUSTOMER_ID,
  seat_tier: "team",
  billing_mode: "card",
  report_cadence: "monthly",
  report_recipients: [] as string[],
  require_2fa: false,
  require_approval_above: 250,
  default_payment_method_id: null,
  monthly_budget: 4000,
  monthly_budget_alert_at: 80,
  seat_subscription_id: null,
  seat_subscription_status: null,
  seat_subscription_current_period_end: null,
  verification_status: verification,
  verification_document_type: verification === "none" ? null : "license",
  verification_document_url: verification === "none" ? null : "https://example.invalid/doc.pdf",
  verification_rejection_reason:
    verification === "rejected" ? "The uploaded license had expired on 2026-01-31." : null,
  verification_reviewed_at: verification === "verified" ? AGO(20) : null,
  verification_reviewed_by: null,
  created_at: AGO(120),
  updated_at: NOW,
});

export const SEED_BUSINESS = makeSeedBusiness("verified");

/**
 * Owner + one active teammate + one outstanding invite, so the Members tab has
 * a populated grid, a pending row, and a seat count that is neither 0 nor full
 * (3 of 3 on the `team` tier would hide the invite form).
 *
 * FAKE_CUSTOMER owns it; FAKE_HELPER is a plain member — which means the helper
 * pass of each sweep audits the NON-OWNER branches for free (Billing's "Only
 * the business owner can manage billing settings", the verification card's
 * read-only variant).
 */
export const makeSeedBusinessMembers = (
  verification: BusinessVerification = "verified",
) => {
  const biz = makeSeedBusiness(verification);
  return [
    {
      id: "61000000-0000-4000-8000-000000000001",
      business_id: BUSINESS_ID,
      user_id: CUSTOMER_ID,
      invited_email: null,
      invited_by: null,
      role: "owner",
      extended_role: "owner",
      status: "active",
      invited_at: AGO(120),
      joined_at: AGO(120),
      created_at: AGO(120),
      businesses: biz,
    },
    {
      id: "61000000-0000-4000-8000-000000000002",
      business_id: BUSINESS_ID,
      user_id: HELPER_ID,
      invited_email: null,
      invited_by: CUSTOMER_ID,
      role: "member",
      extended_role: "approver",
      status: "active",
      invited_at: AGO(60),
      joined_at: AGO(58),
      created_at: AGO(60),
      businesses: biz,
    },
    {
      // Pending invite: no user_id, long-ish address — the row that reads
      // "invited, not joined" and the truncation probe for the email column.
      id: "61000000-0000-4000-8000-000000000003",
      business_id: BUSINESS_ID,
      user_id: null,
      invited_email: "accounts.payable@bayoulogistics-shipping.example.com",
      invited_by: CUSTOMER_ID,
      role: "member",
      extended_role: "poster",
      status: "pending",
      invited_at: AGO(2),
      joined_at: null,
      created_at: AGO(2),
      businesses: biz,
    },
  ];
};

export const SEED_BUSINESS_MEMBERS = makeSeedBusinessMembers("verified");

/** `get_my_business_verification()` — drives BusinessVerificationCard. */
export const makeSeedBusinessVerification = (
  verification: BusinessVerification,
  isOwner: boolean,
) => {
  const biz = makeSeedBusiness(verification);
  return [
    {
      business_id: BUSINESS_ID,
      business_name: biz.name,
      is_owner: isOwner,
      verification_status: verification,
      verification_document_url: biz.verification_document_url,
      verification_document_type: biz.verification_document_type,
      verification_rejection_reason: biz.verification_rejection_reason,
    },
  ];
};

/** `business_activity_feed(p_business_id, p_limit, p_before)`. */
export const SEED_BUSINESS_ACTIVITY = [
  {
    event_at: AGO(0.2),
    actor_id: CUSTOMER_ID,
    actor_name: "Smoke Customer",
    event_type: "posted",
    job_id: SEED_JOBS[0].id,
    job_title: SEED_JOBS[0].title,
    amount: 180,
    department: "Facilities",
  },
  {
    event_at: AGO(2),
    actor_id: HELPER_ID,
    actor_name: "Marcus Thibodeaux",
    event_type: "completed",
    job_id: SEED_JOBS[3].id,
    job_title: SEED_JOBS[3].title,
    amount: 120,
    department: "Warehouse",
  },
  {
    // Unknown event_type → the "did something with" fallback verb, and a long
    // job title to probe the timeline row's wrapping.
    event_at: AGO(5),
    actor_id: CUSTOMER_ID,
    actor_name: "Renée Beauchêne-Landry",
    event_type: "budget_alert",
    job_id: SEED_JOBS[1].id,
    job_title: SEED_JOBS[1].title,
    amount: 320,
    department: null,
  },
];

/** `business_spend_summary(p_business_id)`. */
export const SEED_BUSINESS_SPEND = [
  {
    user_id: CUSTOMER_ID,
    full_name: "Smoke Customer",
    email: "customer.smoke@helpr.test",
    posted_count: 7,
    posted_amount: 1115,
    paid_amount: 620,
    in_escrow_amount: 320,
    pending_amount: 175,
  },
  {
    user_id: HELPER_ID,
    full_name: "Marcus Thibodeaux",
    email: "helper.smoke@helpr.test",
    posted_count: 2,
    posted_amount: 340,
    paid_amount: 240,
    in_escrow_amount: 0,
    pending_amount: 100,
  },
];

/**
 * Jobs awaiting approval — ApprovalsTab reads `jobs` filtered by
 * `business_id` + `status=pending_approval`, and no row in SEED_JOBS carries a
 * business_id, so without these the tab only ever showed its empty state.
 */
export const SEED_BUSINESS_PENDING_JOBS = [
  {
    ...JOB_BASE,
    id: "10000000-0000-4000-8000-0000000000b1",
    title: "Quarterly deep clean of the Gretna warehouse floor",
    description: "Two crews, degreaser supplied on site. Needs to finish before the Monday shift.",
    category: "cleaning",
    status: "pending_approval",
    budget: 780,
    location: "Gretna, LA",
    date_needed: DATE(6),
    created_at: AGO(1),
    customer_id: HELPER_ID,
    business_id: BUSINESS_ID,
    department: "Facilities",
  },
  {
    ...JOB_BASE,
    id: "10000000-0000-4000-8000-0000000000b2",
    title: "Pallet re-stacking, overnight",
    description: "Roughly forty pallets. Forklift certification required.",
    category: "moving",
    status: "pending_approval",
    budget: 410,
    location: "Harahan, LA",
    date_needed: DATE(2),
    created_at: AGO(3),
    customer_id: CUSTOMER_ID,
    business_id: BUSINESS_ID,
    department: "Warehouse",
  },
];

export const SEED_TABLES: Record<string, unknown[]> = {
  profiles: SEED_PROFILES,
  jobs: SEED_JOBS,
  applications: SEED_APPLICATIONS,
  messages: SEED_MESSAGES,
  reviews: SEED_REVIEWS,
  notifications: SEED_NOTIFICATIONS,
  businesses: [SEED_BUSINESS],
  business_members: SEED_BUSINESS_MEMBERS,
};
