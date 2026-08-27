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
import type { Database } from "@/integrations/supabase/types";

/**
 * Row shapes straight from the GENERATED schema. Rule 3 in the header above
 * ("every non-nullable column is present, so a row is shape-valid against the
 * real schema") was previously enforced by nothing but care, and care missed a
 * real one: the messages fixture set `recipient_id`, a column that exists
 * nowhere — `messages.receiver_id` is the real name. The rows still loaded,
 * because a mock just replays JSON, so the unread filter
 * (`receiver_id === uid && !read`) matched nothing and the specs asserting
 * "0 unread" passed for entirely the wrong reason. It stayed invisible for
 * months and only surfaced when the inbox began opening on Unread.
 *
 * `Insert` rather than `Row` is deliberate: it keeps DB-defaulted columns
 * (`id`, `created_at`) optional while still rejecting a column that does not
 * exist, which is the failure mode that actually bit.
 *
 * The `satisfies` on each export below is what does the work — it type-checks
 * every literal WITHOUT widening the export, so `SEED_JOBS[0].id` stays a
 * string and the specs that index into these arrays keep their inference.
 */
type Tables = Database["public"]["Tables"];
type JobsInsert = Tables["jobs"]["Insert"];
type MessagesInsert = Tables["messages"]["Insert"];
type ApplicationsInsert = Tables["applications"]["Insert"];

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
  // Derived from the generated schema rather than typed as `string`: these two
  // are Postgres ENUMS, so a plain `string` here let a fixture invent a
  // category or status the database would reject, and the mock would happily
  // replay it. Sourcing them from JobsInsert means an invalid value is a
  // compile error at the fixture, which is where it is cheap to notice.
  category: NonNullable<JobsInsert["category"]>;
  status: NonNullable<JobsInsert["status"]>;
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
} satisfies Partial<JobsInsert>;

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

export const SEED_JOBS = JOB_SEEDS.map((j) => ({ ...JOB_BASE, ...j })) satisfies JobsInsert[];

/** Applicants for the open job — drives ApplicantsPanel and its empty→full state. */
export const SEED_APPLICATIONS = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    job_id: SEED_JOBS[0].id,
    helper_id: HELPER_ID,
    status: "pending",
    message:
      "I clean three move-outs a week and can bring my own supplies if that helps.",
    created_at: AGO(1),
    updated_at: AGO(1),
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    job_id: SEED_JOBS[0].id,
    helper_id: "00000000-0000-4000-8000-0000000000a2",
    status: "pending",
    // Accented name + long text: the applicant-card layout probe.
    message:
      "Available this weekend. I have worked with Renée on similar jobs in Mid-City and can send references.",
    created_at: AGO(2),
    updated_at: AGO(2),
  },
] satisfies ApplicationsInsert[];

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
] satisfies MessagesInsert[];

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


export const SEED_TABLES: Record<string, unknown[]> = {
  profiles: SEED_PROFILES,
  jobs: SEED_JOBS,
  applications: SEED_APPLICATIONS,
  messages: SEED_MESSAGES,
  reviews: SEED_REVIEWS,
  notifications: SEED_NOTIFICATIONS,
};
