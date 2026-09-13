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

/** The admin who decided disputes and wrote notes in the admin seed. */
export const ADMIN_ID = "00000000-0000-4000-8000-0000000000aa";

/**
 * Timestamps that must still be in the FUTURE when the sweep runs — ban expiry,
 * an active broadcast's `expires_at`. Anchored to real time for the same reason
 * as `DATE` below: a frozen clock would have expired them all.
 */
const FUTURE = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

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
export const DATE = (d: number) =>
  new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

type JobSeed = Omit<
  JobsInsert,
  "id" | "title" | "description" | "category" | "status" | "budget" | "location" | "date_needed" | "created_at" | "customer_id" | "helper_id"
> & {
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
export const JOB_BASE = {
  boost_auto_extended: false,
  credential_tier: 0,
  has_active_dispute: false,
  is_auto_created: false,
  is_flexible_schedule: false,
  pricing_mode: "set_price",
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

  // ── Added 2026-09-12: the rest of the lifecycle ────────────────────────────
  // Rows 1-7 above give one job per `job_status`, but none of them carries a
  // `payment_status`, so every money surface (escrow pill, payout ledger,
  // refund copy, chargeback banner) was only ever photographed blank. The rows
  // below cover the eighth status (`pending_approval`) and ALL TEN values of
  // `jobs_payment_status_check`, plus a group job, an urgent job, a pet-care
  // job with pets, and jobs the HELPER account posted (the app is never
  // role-based: every account both posts and works).
  {
    id: "10000000-0000-4000-8000-000000000008",
    title: "Hang four shelves and a TV mount in a new condo",
    description: "Drywall with metal studs. I have the mount; need someone with a stud finder and anchors.",
    category: "handyman",
    status: "pending_approval",
    payment_status: "unpaid",
    budget: 150,
    location: "Baton Rouge, LA",
    parish: "East Baton Rouge",
    date_needed: DATE(6),
    created_at: AGO(0),
    customer_id: CUSTOMER_ID,
  },
  {
    // Posted by someone else: the helper's browse feed and the group roster.
    id: "10000000-0000-4000-8000-000000000009",
    title: "Crew of three to set up a crawfish boil for 120 guests",
    description:
      "Tables, tents, two propane burners and cleanup after. Boil starts at 2, arrive by 11. Lunch is on us.",
    category: "events",
    status: "open",
    payment_status: "escrow",
    budget: 900,
    location: "Breaux Bridge, LA",
    parish: "St. Martin",
    date_needed: DATE(4),
    start_time: "11:00:00",
    created_at: AGO(1),
    customer_id: "00000000-0000-4000-8000-0000000000a3",
    is_group_job: true,
    helpers_needed: 3,
    is_urgent: true,
    urgent_fee: 45,
  },
  {
    id: "10000000-0000-4000-8000-000000000010",
    title: "Feed and walk two dogs while we are out of town",
    description: "Twice a day for four days. Boudreaux pulls on the leash; Praline the cat just needs food and water.",
    category: "pet_care",
    status: "open",
    payment_status: "escrow",
    budget: 160,
    location: "Mandeville, LA",
    parish: "St. Tammany",
    date_needed: DATE(9),
    created_at: AGO(2),
    customer_id: CUSTOMER_ID,
    is_flexible_schedule: true,
  },
  {
    id: "10000000-0000-4000-8000-000000000011",
    title: "Haul a sofa and a mattress to the parish drop-off",
    description: "Both are on the curb already. Truck or trailer needed.",
    category: "moving",
    status: "accepted",
    payment_status: "escrow",
    budget: 110,
    location: "Gretna, LA",
    parish: "Jefferson",
    date_needed: DATE(2),
    created_at: AGO(3),
    accepted_at: AGO(2),
    customer_id: CUSTOMER_ID,
    helper_id: "00000000-0000-4000-8000-0000000000a3",
  },
  {
    // The long message thread, the reactions and the pins all hang off this job.
    id: "10000000-0000-4000-8000-000000000012",
    title: "Replace rotted fence boards and re-hang the side gate",
    description: "About twelve boards along the back run. Lumber is in the garage. The gate latch sticks.",
    category: "handyman",
    status: "in_progress",
    payment_status: "escrow",
    budget: 420,
    location: "Lake Charles, LA",
    parish: "Calcasieu",
    date_needed: DATE(0),
    start_time: "08:30:00",
    created_at: AGO(5),
    accepted_at: AGO(4),
    helper_on_the_way_at: AGO(0),
    helper_arrived_at: AGO(0),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000013",
    title: "Pressure-wash a driveway and front walk",
    description: "Oil stain near the garage. Water spigot on the left side of the house.",
    category: "cleaning",
    status: "completed",
    payment_status: "payout_pending",
    budget: 130,
    location: "Kenner, LA",
    parish: "Jefferson",
    date_needed: DATE(-1),
    created_at: AGO(6),
    helper_completed_at: AGO(1),
    poster_confirmed_at: AGO(1),
    payout_scheduled_at: AGO(0),
    platform_fee_amount: 15.6,
    helper_fee_percent: 12,
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000014",
    title: "Clean out gutters on a two-story house",
    description: "Front and back. Ladder provided if you need it.",
    category: "yard_work",
    status: "completed",
    payment_status: "released",
    budget: 240,
    location: "Houma, LA",
    parish: "Terrebonne",
    date_needed: DATE(-20),
    created_at: AGO(24),
    helper_completed_at: AGO(20),
    poster_confirmed_at: AGO(20),
    platform_fee_amount: 28.8,
    helper_fee_percent: 12,
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000015",
    title: "Paint a nursery — walls and trim",
    description: "Sherwin-Williams Sea Salt, two coats. Furniture already moved out.",
    category: "painting",
    status: "completed",
    payment_status: "released",
    budget: 575,
    location: "Metairie, LA",
    parish: "Jefferson",
    date_needed: DATE(-62),
    created_at: AGO(70),
    helper_completed_at: AGO(62),
    poster_confirmed_at: AGO(61),
    platform_fee_amount: 69,
    helper_fee_percent: 12,
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    // Posted BY the helper account and worked by Renée: the "reviews both
    // ways" row and the helper-as-poster Activity card.
    id: "10000000-0000-4000-8000-000000000016",
    title: "Move-out clean for a rental between tenants",
    description: "Three bedrooms, two baths. Fridge and oven included.",
    category: "cleaning",
    status: "completed",
    payment_status: "released",
    budget: 310,
    location: "New Orleans, LA",
    parish: "Orleans",
    date_needed: DATE(-118),
    created_at: AGO(125),
    helper_completed_at: AGO(118),
    poster_confirmed_at: AGO(118),
    platform_fee_amount: 37.2,
    helper_fee_percent: 12,
    customer_id: HELPER_ID,
    helper_id: "00000000-0000-4000-8000-0000000000a2",
  },
  {
    id: "10000000-0000-4000-8000-000000000017",
    title: "Assemble a backyard playset",
    description: "Kit arrived with a missing hardware bag; poster cancelled while waiting on the replacement.",
    category: "assembly",
    status: "cancelled",
    payment_status: "refunded",
    budget: 260,
    location: "Denham Springs, LA",
    parish: "Livingston",
    date_needed: DATE(-8),
    created_at: AGO(15),
    cancelled_at: AGO(9),
    cancelled_by: CUSTOMER_ID,
    cancellation_reason: "Parts on backorder",
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000018",
    title: "Deliver a dresser across town",
    description: "Cancelled inside the 24-hour window, so the late-cancellation fee applied.",
    category: "delivery",
    status: "cancelled",
    payment_status: "cancelled",
    budget: 85,
    location: "Monroe, LA",
    parish: "Ouachita",
    date_needed: DATE(-4),
    created_at: AGO(10),
    cancelled_at: AGO(4),
    cancelled_by: CUSTOMER_ID,
    late_cancellation: true,
    cancellation_fee: 15,
    cancellation_fee_status: "charged",
    cancellation_reason: "Found a friend with a truck",
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000019",
    title: "Rake and bag leaves before a yard sale",
    description: "Checkout was never finished, so this posting lapsed unpaid.",
    category: "yard_work",
    status: "cancelled",
    payment_status: "abandoned",
    budget: 50,
    location: "Alexandria, LA",
    parish: "Rapides",
    date_needed: DATE(-14),
    created_at: AGO(18),
    customer_id: CUSTOMER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000020",
    title: "Install a ceiling fan in the living room",
    description: "Existing box is fan-rated. The card issuer later reversed the charge.",
    category: "handyman",
    status: "disputed",
    payment_status: "chargeback",
    budget: 175,
    location: "Shreveport, LA",
    parish: "Caddo",
    date_needed: DATE(-30),
    created_at: AGO(36),
    disputed_at: AGO(28),
    disputed_by: CUSTOMER_ID,
    dispute_reason: "Fan wobbles and the light kit was never connected.",
    dispute_status: "decided",
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000021",
    title: "Weed and mulch three flower beds",
    description: "Mulch is bagged by the shed. The payout bounced off a closed bank account.",
    category: "yard_work",
    status: "completed",
    payment_status: "failed",
    budget: 140,
    location: "Lafayette, LA",
    parish: "Lafayette",
    date_needed: DATE(-45),
    created_at: AGO(50),
    helper_completed_at: AGO(45),
    poster_confirmed_at: AGO(45),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000022",
    title: "Move a piano down one flight of stairs",
    description: "Upright, about 400 lb. Cancellation is being processed.",
    category: "moving",
    status: "accepted",
    payment_status: "cancelling",
    budget: 480,
    location: "Covington, LA",
    parish: "St. Tammany",
    date_needed: DATE(5),
    created_at: AGO(3),
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    id: "10000000-0000-4000-8000-000000000023",
    title: "Caulk and re-grout a shower surround",
    description: "Grout lines by the valve are still cracked after the first pass.",
    category: "handyman",
    status: "revision_requested",
    payment_status: "escrow",
    budget: 220,
    location: "Thibodaux, LA",
    parish: "Lafourche",
    date_needed: DATE(-2),
    created_at: AGO(8),
    helper_completed_at: AGO(2),
    revision_requested_at: AGO(1),
    revision_note: "Two grout lines by the valve are still cracked.",
    revision_count: 1,
    customer_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
  },
  {
    // Helper account as POSTER with an OPEN dispute against Renée.
    id: "10000000-0000-4000-8000-000000000024",
    title: "Organize a garage and haul donations",
    description: "Half the donation boxes were left in the driveway.",
    category: "errands",
    status: "disputed",
    payment_status: "escrow",
    budget: 200,
    location: "New Iberia, LA",
    parish: "Iberia",
    date_needed: DATE(-6),
    created_at: AGO(12),
    disputed_at: AGO(5),
    disputed_by: HELPER_ID,
    dispute_reason: "Donation boxes left in the driveway in the rain.",
    dispute_status: "open",
    has_active_dispute: true,
    customer_id: HELPER_ID,
    helper_id: "00000000-0000-4000-8000-0000000000a2",
  },
  {
    // Helper account as poster, still open, with applicants.
    id: "10000000-0000-4000-8000-000000000025",
    title: "Babysit-proof a living room: anchor bookcases and cover outlets",
    description: "Two bookcases, one dresser, about fifteen outlets. Kits bought.",
    category: "handyman",
    status: "open",
    payment_status: "escrow",
    budget: 125,
    location: "Opelousas, LA",
    parish: "St. Landry",
    date_needed: DATE(7),
    created_at: AGO(1),
    customer_id: HELPER_ID,
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
  // ── Added 2026-09-12 ───────────────────────────────────────────────────────
  // Every application_status, applicants on a job the HELPER account posted,
  // and a group-job roster.
  {
    id: "20000000-0000-4000-8000-000000000003",
    job_id: "10000000-0000-4000-8000-000000000010",
    helper_id: HELPER_ID,
    status: "pending",
    message: "I have two labs of my own and I am ten minutes from Mandeville. Happy to send a photo after each visit.",
    created_at: AGO(1),
    updated_at: AGO(1),
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    job_id: "10000000-0000-4000-8000-000000000010",
    helper_id: "00000000-0000-4000-8000-0000000000a3",
    status: "pending",
    message: "Available all four days.",
    created_at: AGO(1),
    updated_at: AGO(1),
  },
  {
    id: "20000000-0000-4000-8000-000000000005",
    job_id: "10000000-0000-4000-8000-000000000010",
    helper_id: "00000000-0000-4000-8000-0000000000a8",
    status: "rejected",
    message: "I can do mornings only.",
    decline_reason: "Needed someone for both visits each day.",
    created_at: AGO(2),
    updated_at: AGO(1),
  },
  {
    id: "20000000-0000-4000-8000-000000000006",
    job_id: "10000000-0000-4000-8000-000000000025",
    helper_id: "00000000-0000-4000-8000-0000000000a2",
    status: "pending",
    message: "I baby-proofed my sister's whole house last spring. I can bring the drill.",
    created_at: AGO(0),
    updated_at: AGO(0),
  },
  {
    id: "20000000-0000-4000-8000-000000000007",
    job_id: "10000000-0000-4000-8000-000000000025",
    helper_id: "00000000-0000-4000-8000-0000000000a3",
    status: "pending",
    message: "Licensed handyman. Anchors into studs, not drywall.",
    created_at: AGO(0),
    updated_at: AGO(0),
  },
  {
    id: "20000000-0000-4000-8000-000000000008",
    job_id: "10000000-0000-4000-8000-000000000009",
    helper_id: HELPER_ID,
    status: "accepted",
    message: "I have run the burners at three boils this year.",
    created_at: AGO(1),
    updated_at: AGO(0),
  },
  {
    id: "20000000-0000-4000-8000-000000000009",
    job_id: "10000000-0000-4000-8000-000000000012",
    helper_id: HELPER_ID,
    status: "accepted",
    message: "I can start first thing Saturday.",
    created_at: AGO(5),
    updated_at: AGO(4),
  },
  {
    id: "20000000-0000-4000-8000-000000000010",
    job_id: "10000000-0000-4000-8000-000000000011",
    helper_id: "00000000-0000-4000-8000-0000000000a3",
    status: "accepted",
    message: "I have a trailer.",
    created_at: AGO(3),
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
    feedback: "Fast, tidy, and put the boxes exactly where I asked.",
    created_at: AGO(2),
    // Past its anti-retaliation reveal. Without this every visible-reviews
    // reader (`.lte("feedback_visible_at", now)`) dropped the row and the
    // populated Reviews tab rendered "No reviews yet" while the Work Record,
    // which had no reveal filter, counted it — two screens disagreeing about
    // fixture data that was never a legal prod row (the trigger always stamps
    // this column).
    feedback_visible_at: AGO(2),
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    job_id: SEED_JOBS[3].id,
    reviewer_id: "00000000-0000-4000-8000-0000000000a2",
    reviewee_id: HELPER_ID,
    rating: 4,
    feedback: "Good work overall. Arrived a little late but kept me posted.",
    created_at: AGO(8),
    feedback_visible_at: AGO(8),
  },
  // ── Added 2026-09-12: reviews both ways, a response, a low rating ─────────
  {
    id: "40000000-0000-4000-8000-000000000003",
    job_id: "10000000-0000-4000-8000-000000000014",
    reviewer_id: CUSTOMER_ID,
    reviewee_id: HELPER_ID,
    rating: 5,
    feedback: "Gutters were packed solid and he cleared every one. Sent before-and-after photos without being asked.",
    response_text: "Thanks! That back corner downspout was a real fight.",
    response_at: AGO(18),
    created_at: AGO(19),
    feedback_visible_at: AGO(19),
  },
  {
    // Helper → poster: the other direction.
    id: "40000000-0000-4000-8000-000000000004",
    job_id: "10000000-0000-4000-8000-000000000014",
    reviewer_id: HELPER_ID,
    reviewee_id: CUSTOMER_ID,
    rating: 5,
    feedback: "Clear instructions, ladder was ready, paid right away.",
    created_at: AGO(19),
    feedback_visible_at: AGO(19),
  },
  {
    id: "40000000-0000-4000-8000-000000000005",
    job_id: "10000000-0000-4000-8000-000000000015",
    reviewer_id: CUSTOMER_ID,
    reviewee_id: HELPER_ID,
    rating: 4,
    feedback: "Clean lines on the trim. Took a day longer than quoted.",
    created_at: AGO(60),
    feedback_visible_at: AGO(60),
  },
  {
    // The helper account reviewing someone who worked ITS job.
    id: "40000000-0000-4000-8000-000000000006",
    job_id: "10000000-0000-4000-8000-000000000016",
    reviewer_id: HELPER_ID,
    reviewee_id: "00000000-0000-4000-8000-0000000000a2",
    rating: 2,
    feedback: "Oven was not touched and she left an hour early.",
    created_at: AGO(116),
    feedback_visible_at: AGO(116),
  },
  {
    id: "40000000-0000-4000-8000-000000000007",
    job_id: "10000000-0000-4000-8000-000000000016",
    reviewer_id: "00000000-0000-4000-8000-0000000000a2",
    reviewee_id: HELPER_ID,
    rating: 3,
    feedback: "Fridge had not been emptied before I arrived, which ate the time.",
    created_at: AGO(116),
    feedback_visible_at: AGO(116),
  },
] satisfies Tables["reviews"]["Insert"][];

export const SEED_NOTIFICATIONS = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    user_id: CUSTOMER_ID,
    // `notifications_type_check` admits 18 values and neither
    // "application_received" nor "job_completed" is among them — both were
    // invented by the fixture and no mock ever objected.
    type: "application",
    title: "New applicant",
    message: "Someone applied to your cleaning job.",
    read: false,
    created_at: AGO(1),
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    user_id: CUSTOMER_ID,
    type: "job_update",
    title: "Job marked complete",
    message: "Confirm the work to release payment from escrow.",
    read: true,
    created_at: AGO(2),
  },
  // ── Added 2026-09-12: the helper's inbox and the other notification types ──
  {
    id: "50000000-0000-4000-8000-000000000003",
    user_id: HELPER_ID,
    type: "payment",
    title: "Payout sent",
    message: "$211.20 for “Clean out gutters on a two-story house” is on its way to your bank.",
    job_id: "10000000-0000-4000-8000-000000000014",
    read: false,
    created_at: AGO(19),
  },
  {
    id: "50000000-0000-4000-8000-000000000004",
    user_id: HELPER_ID,
    type: "job_match",
    title: "New job near you",
    message: "Crew of three to set up a crawfish boil for 120 guests — Breaux Bridge, $900.",
    job_id: "10000000-0000-4000-8000-000000000009",
    read: false,
    created_at: AGO(1),
  },
  {
    id: "50000000-0000-4000-8000-000000000005",
    user_id: HELPER_ID,
    type: "review",
    title: "You got a 5-star review",
    message: "“Gutters were packed solid and he cleared every one.”",
    read: true,
    created_at: AGO(19),
  },
  {
    id: "50000000-0000-4000-8000-000000000006",
    user_id: HELPER_ID,
    type: "warning",
    title: "Revision requested",
    message: "The poster asked for a second pass on “Caulk and re-grout a shower surround”.",
    job_id: "10000000-0000-4000-8000-000000000023",
    read: false,
    created_at: AGO(1),
  },
  {
    id: "50000000-0000-4000-8000-000000000007",
    user_id: CUSTOMER_ID,
    type: "message",
    title: "New message",
    message: "Smoke Helper: Gate is back on its hinges. Sending a photo now.",
    job_id: "10000000-0000-4000-8000-000000000012",
    read: false,
    created_at: AGO(0),
  },
  {
    id: "50000000-0000-4000-8000-000000000008",
    user_id: CUSTOMER_ID,
    type: "financial_alerts",
    title: "Refund issued",
    message: "$260.00 for “Assemble a backyard playset” was refunded to your card.",
    job_id: "10000000-0000-4000-8000-000000000017",
    read: true,
    created_at: AGO(9),
  },
  {
    id: "50000000-0000-4000-8000-000000000009",
    user_id: CUSTOMER_ID,
    type: "system_alert",
    title: "Storm prep season",
    message: "Book gutter and yard help early — demand doubles the week before landfall.",
    read: true,
    created_at: AGO(30),
  },
] satisfies Tables["notifications"]["Insert"][];

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
    approval_status: "approved",
    ban_status: "active",
    created_at: AGO(200),
    updated_at: NOW,
  },
  // ── Added 2026-09-12: every account state an admin screen has to render ────
  // Approved with Stripe and IDV, pending, denied, permanently banned, temp
  // banned, IDV failed with no Stripe, final warning with payouts disabled,
  // and the admin who wrote the notes. Never role-based: `role` is only the
  // legacy column the schema still requires.
  {
    id: "00000000-0000-4000-8000-0000000000a3-profile",
    user_id: "00000000-0000-4000-8000-0000000000a3",
    full_name: "Darnell Guidry",
    avatar_url: null,
    email: "darnell.guidry@helpr.test",
    location: "Breaux Bridge, LA",
    parish: "St. Martin",
    bio: "Licensed and insured handyman. Fences, decks, ceiling fans and storm shutters.",
    skills: "handyman,moving,events",
    hourly_rate: 45,
    subscription_tier: "elite",
    approval_status: "approved",
    ban_status: "active",
    idv_status: "verified",
    id_verification_status: "verified",
    stripe_account_id: "acct_seed_darnell",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_identity_verified: true,
    is_licensed: true,
    license_status: "verified",
    is_insured: true,
    insurance_status: "verified",
    background_check_status: "verified",
    created_at: AGO(640),
    updated_at: NOW,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a4-profile",
    user_id: "00000000-0000-4000-8000-0000000000a4",
    full_name: "Thủy Nguyễn",
    avatar_url: null,
    email: "thuy.nguyen@helpr.test",
    location: "Gretna, LA",
    parish: "Jefferson",
    bio: "New to Helpr. Looking for help around a rental duplex.",
    subscription_tier: "free",
    approval_status: "pending",
    ban_status: "active",
    idv_status: "not_started",
    id_verification_status: "unverified",
    stripe_account_id: null,
    email_verified: true,
    created_at: AGO(1),
    updated_at: AGO(1),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a5-profile",
    user_id: "00000000-0000-4000-8000-0000000000a5",
    full_name: "Jean-Baptiste Arceneaux",
    avatar_url: null,
    email: "jb.arceneaux@helpr.test",
    location: "Abbeville, LA",
    parish: "Vermilion",
    bio: "Yard work and pressure washing.",
    subscription_tier: "free",
    approval_status: "denied",
    denial_reason: "ID photo was unreadable and the name did not match the account.",
    ban_status: "active",
    idv_status: "failed",
    id_verification_status: "failed",
    idv_failure_reason: "document_unverified_other",
    stripe_account_id: null,
    created_at: AGO(21),
    updated_at: AGO(19),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a6-profile",
    user_id: "00000000-0000-4000-8000-0000000000a6",
    full_name: "Kyle Broussard",
    avatar_url: null,
    email: "kyle.broussard@helpr.test",
    location: "Lake Charles, LA",
    parish: "Calcasieu",
    bio: "Moving help.",
    subscription_tier: "free",
    approval_status: "approved",
    ban_status: "permanently_banned",
    idv_status: "verified",
    id_verification_status: "verified",
    stripe_account_id: "acct_seed_kyle",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: false,
    created_at: AGO(300),
    updated_at: AGO(3),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a7-profile",
    user_id: "00000000-0000-4000-8000-0000000000a7",
    full_name: "Latoya Batiste",
    avatar_url: null,
    email: "latoya.batiste@helpr.test",
    location: "Baton Rouge, LA",
    parish: "East Baton Rouge",
    bio: "Errands and grocery runs for seniors.",
    subscription_tier: "pro",
    approval_status: "approved",
    ban_status: "temp_banned",
    auto_suspended_until: FUTURE(5),
    idv_status: "verified",
    id_verification_status: "verified",
    stripe_account_id: "acct_seed_latoya",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    created_at: AGO(150),
    updated_at: AGO(2),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a8-profile",
    user_id: "00000000-0000-4000-8000-0000000000a8",
    full_name: "Priya Raman",
    avatar_url: null,
    email: "priya.raman@helpr.test",
    location: "Ruston, LA",
    parish: "Lincoln",
    bio: "LSU grad student. Pet sitting and tutoring.",
    subscription_tier: "free",
    approval_status: "approved",
    ban_status: "active",
    idv_status: "not_started",
    id_verification_status: "unverified",
    stripe_account_id: null,
    stripe_identity_verified: false,
    created_at: AGO(40),
    updated_at: AGO(40),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a9-profile",
    user_id: "00000000-0000-4000-8000-0000000000a9",
    full_name: "Bobby Fontenot",
    avatar_url: null,
    email: "bobby.fontenot@helpr.test",
    location: "Opelousas, LA",
    parish: "St. Landry",
    bio: "Painting and drywall.",
    subscription_tier: "free",
    approval_status: "approved",
    ban_status: "final_warning",
    idv_status: "manual_review",
    id_verification_status: "submitted",
    stripe_account_id: "acct_seed_bobby",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: false,
    created_at: AGO(90),
    updated_at: AGO(6),
  },
  {
    id: "00000000-0000-4000-8000-0000000000aa-profile",
    user_id: ADMIN_ID,
    full_name: "Claire Hébert",
    avatar_url: null,
    email: "claire.hebert@helpr.test",
    location: "New Orleans, LA",
    parish: "Orleans",
    bio: "Trust and safety.",
    subscription_tier: "free",
    approval_status: "approved",
    ban_status: "active",
    created_at: AGO(700),
    updated_at: NOW,
  },
] satisfies Tables["profiles"]["Insert"][];

// ═════════════════════════════════════════════════════════════════════════════
// Added 2026-09-12 — every other table a user-visible screen reads.
//
// Before this block the seed answered 6 tables and every other SELECT in the
// app came back `[]`, so the earnings ledger, the dispute timeline, the admin
// queues, saved Helprs, pets, credentials, availability and the referral card
// had only ever been photographed EMPTY. docs/audit/seed-coverage.md lists
// every table and RPC the app reads and which of them this file answers.
//
// Same rules as the header: fixed ids, `satisfies <table>Insert[]` so a column
// that does not exist is a compile error, and no nested object literal inside a
// row (fixtureSchemaContract.test.ts reads every `key:` in a row as a column).
// JSON payloads therefore live in their own consts.
// ═════════════════════════════════════════════════════════════════════════════

type Ins<K extends keyof Tables> = Tables[K]["Insert"];

const A2 = "00000000-0000-4000-8000-0000000000a2";
const A3 = "00000000-0000-4000-8000-0000000000a3";
const A4 = "00000000-0000-4000-8000-0000000000a4";
const A5 = "00000000-0000-4000-8000-0000000000a5";
const A6 = "00000000-0000-4000-8000-0000000000a6";
const A7 = "00000000-0000-4000-8000-0000000000a7";
const A8 = "00000000-0000-4000-8000-0000000000a8";
const A9 = "00000000-0000-4000-8000-0000000000a9";
const J = (n: number) => `10000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const THREAD_JOB_ID = J(12);

/**
 * The long thread: 34 messages between the two test accounts on the in-progress
 * fence job. Built from tuples because 34 hand-written rows would bury the
 * content; still typed against the generated Insert.
 */
const THREAD_SCRIPT: [from: "c" | "h", text: string][] = [
  ["c", "Hi! Thanks for taking the fence job. Is Saturday still good?"],
  ["h", "Saturday works. I can be there at 8:30."],
  ["c", "Perfect. Lumber is in the garage, code is 4417."],
  ["h", "Got it. How many boards are rotted, roughly?"],
  ["c", "Twelve that I counted along the back. Maybe two more by the gate."],
  ["h", "I will bring a few extra pickets in case the lumber is short."],
  ["c", "Good idea. The gate latch also sticks — is that something you can look at?"],
  ["h", "Yes, usually it is the hinge sagging, not the latch. I will shim it."],
  ["c", "👍"],
  ["h", "Do you want the old boards hauled away or stacked by the curb?"],
  ["c", "Curb is fine, the parish picks up bulk trash on Tuesdays."],
  ["h", "Sounds good."],
  ["c", "Oh — the dog will be inside, but please keep the side gate closed."],
  ["h", "Will do. What is the dog's name, in case he gets out?"],
  ["c", "Boudreaux. He is friendly, just loud."],
  ["h", "😂 noted"],
  ["h", "On my way, about 20 minutes out."],
  ["c", "Great, I am home."],
  ["h", "Here. Starting on the back run."],
  ["h", "Found some termite damage on the bottom rail by the corner post. Not huge, but that rail should be replaced too. It is one 2x4, I have one in the truck."],
  ["c", "Please go ahead. Add it to the total?"],
  ["h", "No charge, it is a few dollars and it would bug me to leave it."],
  ["c", "That is really kind, thank you."],
  ["h", "Back run is done. Moving to the gate."],
  ["c", "Looks great from the window!"],
  ["h", "The top hinge screws were stripped. I moved the hinge up an inch into fresh wood."],
  ["c", "Does it close on its own now?"],
  ["h", "Yes. The latch catches every time. Try it when you get a sec."],
  ["c", "Just did. First time in two years it has not stuck."],
  ["h", "Cleaning up now. Old boards are at the curb."],
  ["c", "Can you send a photo of the corner post before you go?"],
  ["h", "Sending now."],
  ["h", "Gate is back on its hinges. Sending a photo now."],
  ["c", "‼️ that looks brand new"],
];

export const SEED_THREAD_MESSAGES = THREAD_SCRIPT.map(([from, content], i) => ({
  id: `30000000-0000-4000-8000-000000000${String(100 + i).padStart(3, "0")}`,
  job_id: THREAD_JOB_ID,
  sender_id: from === "c" ? CUSTOMER_ID : HELPER_ID,
  receiver_id: from === "c" ? HELPER_ID : CUSTOMER_ID,
  content,
  // Spread over the last four days, oldest first, the final two unread.
  created_at: new Date(Date.parse(NOW) - (THREAD_SCRIPT.length - i) * 2.5 * 3_600_000).toISOString(),
  read: i < THREAD_SCRIPT.length - 2,
  is_system: false,
  // A reply that quotes an earlier message.
  reply_to_id: i === 20 ? "30000000-0000-4000-8000-000000000119" : null,
})) satisfies MessagesInsert[];

export const SEED_ALL_MESSAGES = SEED_MESSAGES.concat(SEED_THREAD_MESSAGES);

const MSG = (i: number) => `30000000-0000-4000-8000-000000000${String(100 + i).padStart(3, "0")}`;

export const SEED_MESSAGE_REACTIONS = [
  { message_id: MSG(1), job_id: THREAD_JOB_ID, user_id: CUSTOMER_ID, emoji: "👍", created_at: AGO(3) },
  { message_id: MSG(14), job_id: THREAD_JOB_ID, user_id: HELPER_ID, emoji: "❤️", created_at: AGO(3) },
  { message_id: MSG(19), job_id: THREAD_JOB_ID, user_id: CUSTOMER_ID, emoji: "❓", created_at: AGO(2) },
  { message_id: MSG(21), job_id: THREAD_JOB_ID, user_id: CUSTOMER_ID, emoji: "❤️", created_at: AGO(2) },
  { message_id: MSG(21), job_id: THREAD_JOB_ID, user_id: HELPER_ID, emoji: "😂", created_at: AGO(2) },
  { message_id: MSG(28), job_id: THREAD_JOB_ID, user_id: HELPER_ID, emoji: "‼️", created_at: AGO(1) },
  { message_id: MSG(32), job_id: THREAD_JOB_ID, user_id: CUSTOMER_ID, emoji: "👍", created_at: AGO(0) },
] satisfies Ins<"message_reactions">[];

export const SEED_THREAD_PINS = [
  { user_id: CUSTOMER_ID, job_id: THREAD_JOB_ID, other_user_id: HELPER_ID, pinned_at: AGO(3) },
  { user_id: HELPER_ID, job_id: THREAD_JOB_ID, other_user_id: CUSTOMER_ID, pinned_at: AGO(3) },
] satisfies Ins<"thread_pins">[];

export const SEED_THREAD_ARCHIVES = [
  { user_id: CUSTOMER_ID, job_id: J(17), other_user_id: HELPER_ID, archived_at: AGO(8) },
] satisfies Ins<"thread_archives">[];

export const SEED_DISPUTES = [
  {
    id: "61000000-0000-4000-8000-000000000001",
    job_id: J(7),
    opener_id: CUSTOMER_ID,
    reason: "Two of the pharmacy items were missing and the receipt did not match the charge.",
    evidence_urls: [],
    status: "open",
    created_at: AGO(2),
  },
  {
    id: "61000000-0000-4000-8000-000000000002",
    job_id: J(20),
    opener_id: CUSTOMER_ID,
    reason: "Fan wobbles and the light kit was never connected.",
    evidence_urls: [],
    status: "decided",
    decided_at: AGO(21),
    decided_by: ADMIN_ID,
    decision_text: "Split 50/50: the fan was mounted but the light kit was not wired.",
    execution_status: "executed",
    executed_at: AGO(21),
    execution_helper_cents: 7700,
    execution_refund_cents: 8750,
    created_at: AGO(28),
  },
  {
    id: "61000000-0000-4000-8000-000000000003",
    job_id: J(24),
    opener_id: HELPER_ID,
    reason: "Donation boxes left in the driveway in the rain.",
    evidence_urls: [],
    status: "open",
    created_at: AGO(5),
  },
  {
    id: "61000000-0000-4000-8000-000000000004",
    job_id: J(23),
    opener_id: CUSTOMER_ID,
    reason: "Grout cracked again within a day.",
    evidence_urls: [],
    status: "withdrawn",
    created_at: AGO(3),
  },
] satisfies Ins<"disputes">[];

export const SEED_JOB_REVISIONS = [
  {
    id: "62000000-0000-4000-8000-000000000001",
    job_id: J(23),
    requested_by: CUSTOMER_ID,
    description: "Two grout lines by the valve are still cracked. Can you redo those and re-caulk the corner?",
    status: "pending",
    created_at: AGO(1),
  },
  {
    id: "62000000-0000-4000-8000-000000000002",
    job_id: J(5),
    requested_by: CUSTOMER_ID,
    description: "Lap marks show near the light switch in afternoon light.",
    helper_response: "Coming back Thursday with a roller extension.",
    status: "accepted",
    created_at: AGO(3),
  },
] satisfies Ins<"job_revisions">[];

export const SEED_JOB_TRACKING = [
  {
    id: "63000000-0000-4000-8000-000000000001",
    job_id: J(12),
    helper_id: HELPER_ID,
    status: "arrived",
    eta_minutes: 0,
    latitude: 30.2266,
    longitude: -93.2174,
    created_at: AGO(0),
    updated_at: AGO(0),
  },
  {
    id: "63000000-0000-4000-8000-000000000002",
    job_id: J(3),
    helper_id: HELPER_ID,
    status: "on_the_way",
    eta_minutes: 14,
    latitude: 30.2241,
    longitude: -92.0198,
    created_at: AGO(0),
    updated_at: AGO(0),
  },
] satisfies Ins<"job_tracking">[];

// ── Money: payouts across five months, tips in every state ───────────────────
const PAYOUT_ROWS = [
  {
    id: "64000000-0000-4000-8000-000000000001",
    job_id: J(4),
    helper_id: HELPER_ID,
    amount_cents: 10560,
    platform_fee_cents: 1440,
    currency: "usd",
    status: "paid",
    initiated_by: "system",
    stripe_account_id: "acct_seed_smoke_helper",
    stripe_transfer_id: "tr_seed_0001",
    created_at: AGO(2),
    paid_at: AGO(1),
  },
  {
    id: "64000000-0000-4000-8000-000000000002",
    job_id: J(13),
    helper_id: HELPER_ID,
    amount_cents: 11440,
    platform_fee_cents: 1560,
    currency: "usd",
    status: "pending",
    initiated_by: "auto",
    stripe_account_id: "acct_seed_smoke_helper",
    created_at: AGO(0),
  },
  {
    id: "64000000-0000-4000-8000-000000000003",
    job_id: J(14),
    helper_id: HELPER_ID,
    amount_cents: 21120,
    platform_fee_cents: 2880,
    currency: "usd",
    status: "paid",
    initiated_by: "system",
    stripe_account_id: "acct_seed_smoke_helper",
    stripe_transfer_id: "tr_seed_0003",
    created_at: AGO(20),
    paid_at: AGO(19),
  },
  {
    id: "64000000-0000-4000-8000-000000000004",
    job_id: J(15),
    helper_id: HELPER_ID,
    amount_cents: 50600,
    platform_fee_cents: 6900,
    currency: "usd",
    status: "paid",
    initiated_by: "admin",
    initiated_by_user_id: ADMIN_ID,
    stripe_account_id: "acct_seed_smoke_helper",
    stripe_transfer_id: "tr_seed_0004",
    created_at: AGO(61),
    paid_at: AGO(60),
  },
  {
    id: "64000000-0000-4000-8000-000000000005",
    job_id: J(21),
    helper_id: HELPER_ID,
    amount_cents: 12320,
    platform_fee_cents: 1680,
    currency: "usd",
    status: "failed",
    initiated_by: "system",
    stripe_account_id: "acct_seed_smoke_helper",
    failure_reason: "account_closed",
    created_at: AGO(45),
    failed_at: AGO(44),
  },
  {
    id: "64000000-0000-4000-8000-000000000006",
    job_id: J(20),
    helper_id: HELPER_ID,
    amount_cents: 7700,
    platform_fee_cents: 1050,
    currency: "usd",
    status: "reversed",
    initiated_by: "admin",
    initiated_by_user_id: ADMIN_ID,
    stripe_account_id: "acct_seed_smoke_helper",
    stripe_transfer_id: "tr_seed_0006",
    created_at: AGO(21),
    paid_at: AGO(21),
    reversed_at: AGO(14),
  },
  {
    id: "64000000-0000-4000-8000-000000000007",
    job_id: J(16),
    helper_id: A2,
    amount_cents: 27280,
    platform_fee_cents: 3720,
    currency: "usd",
    status: "paid",
    initiated_by: "system",
    stripe_account_id: "acct_seed_renee",
    stripe_transfer_id: "tr_seed_0007",
    created_at: AGO(118),
    paid_at: AGO(117),
  },
] satisfies Ins<"payout_transfers">[];

/** Earnings ledger selects `jobs(title)` — PostgREST embeds it; the mock cannot join, so embed here. */
export const SEED_PAYOUT_TRANSFERS = PAYOUT_ROWS.map((p) => ({
  ...p,
  jobs: { title: SEED_JOBS.find((j) => j.id === p.job_id)?.title ?? null },
}));

export const SEED_TIPS = [
  {
    id: "65000000-0000-4000-8000-000000000001",
    job_id: J(14),
    tipper_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
    amount: 25,
    source: "manual",
    payment_status: "paid",
    created_at: AGO(19),
  },
  {
    id: "65000000-0000-4000-8000-000000000002",
    job_id: J(15),
    tipper_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
    amount: 57.5,
    source: "auto",
    payment_status: "paid",
    created_at: AGO(60),
  },
  {
    id: "65000000-0000-4000-8000-000000000003",
    job_id: J(4),
    tipper_id: CUSTOMER_ID,
    helper_id: HELPER_ID,
    amount: 10,
    source: "manual",
    payment_status: "pending",
    created_at: AGO(1),
  },
  {
    id: "65000000-0000-4000-8000-000000000004",
    job_id: J(16),
    tipper_id: HELPER_ID,
    helper_id: A2,
    amount: 15,
    source: "manual",
    payment_status: "failed",
    failure_reason: "card_declined",
    created_at: AGO(117),
  },
] satisfies Ins<"tips">[];

export const SEED_GROUP_JOB_HELPERS = [
  { id: "66000000-0000-4000-8000-000000000001", job_id: J(9), helper_id: HELPER_ID, status: "confirmed", joined_at: AGO(0) },
  { id: "66000000-0000-4000-8000-000000000002", job_id: J(9), helper_id: A2, status: "confirmed", joined_at: AGO(0) },
] satisfies Ins<"group_job_helpers">[];

// ── The Helpr's own profile surfaces ─────────────────────────────────────────
export const SEED_HELPER_AVAILABILITY = [
  ...[1, 2, 3, 4, 5].map((d) => ({
    id: `67000000-0000-4000-8000-00000000000${d}`,
    helper_id: HELPER_ID,
    day_of_week: d,
    start_time: "08:00:00",
    end_time: "17:00:00",
    is_available: true,
    specific_date: null,
    created_at: AGO(90),
    updated_at: AGO(10),
  })),
  {
    id: "67000000-0000-4000-8000-000000000006",
    helper_id: HELPER_ID,
    day_of_week: 6,
    start_time: "09:00:00",
    end_time: "13:00:00",
    is_available: true,
    specific_date: null,
    created_at: AGO(90),
    updated_at: AGO(10),
  },
  {
    id: "67000000-0000-4000-8000-000000000007",
    helper_id: HELPER_ID,
    day_of_week: 0,
    start_time: null,
    end_time: null,
    is_available: false,
    specific_date: null,
    created_at: AGO(90),
    updated_at: AGO(10),
  },
] satisfies Ins<"helper_availability">[];

export const SEED_HELPER_CREDENTIALS = [
  {
    id: "68000000-0000-4000-8000-000000000001",
    user_id: HELPER_ID,
    credential_type: "identity",
    status: "verified",
    verified_at: AGO(380),
    created_at: AGO(390),
    updated_at: AGO(380),
  },
  {
    id: "68000000-0000-4000-8000-000000000002",
    user_id: HELPER_ID,
    credential_type: "background_check",
    status: "verified",
    vendor_check_id: "chk_seed_0002",
    verified_at: AGO(370),
    created_at: AGO(385),
    updated_at: AGO(370),
  },
  {
    id: "68000000-0000-4000-8000-000000000003",
    user_id: HELPER_ID,
    credential_type: "trade_license",
    trade_category: "handyman",
    license_number: "LA-HIC-883412",
    license_state: "LA",
    issuing_authority: "Louisiana State Licensing Board for Contractors",
    expiration_date: "2027-06-30",
    status: "submitted",
    created_at: AGO(4),
    updated_at: AGO(4),
  },
  {
    id: "68000000-0000-4000-8000-000000000004",
    user_id: HELPER_ID,
    credential_type: "insurance",
    issuing_authority: "Gulf South Mutual",
    expiration_date: "2026-07-31",
    status: "expired",
    created_at: AGO(400),
    updated_at: AGO(14),
  },
  {
    id: "68000000-0000-4000-8000-000000000005",
    user_id: HELPER_ID,
    credential_type: "bond",
    status: "rejected",
    rejection_reason: "Bond certificate was for a different business name.",
    created_at: AGO(30),
    updated_at: AGO(28),
  },
  {
    id: "68000000-0000-4000-8000-000000000006",
    user_id: A3,
    credential_type: "trade_license",
    trade_category: "handyman",
    license_number: "LA-HIC-100233",
    license_state: "LA",
    status: "verified",
    verified_at: AGO(200),
    created_at: AGO(210),
    updated_at: AGO(200),
  },
] satisfies Ins<"helper_credentials">[];

export const SEED_PET_PROFILES = [
  {
    id: "69000000-0000-4000-8000-000000000001",
    owner_id: CUSTOMER_ID,
    name: "Boudreaux",
    species: "dog",
    breed: "Catahoula Leopard Dog",
    age_years: 4,
    weight_lbs: 62,
    color_markings: "Blue merle, one glass eye",
    feeding_schedule: "2 cups at 7am and 6pm",
    behavioral_notes: "Pulls on the leash near squirrels. Friendly with people.",
    medical_notes: "Heartworm pill on the 1st.",
    vet_name: "Northshore Animal Hospital",
    vet_phone: "985-555-0142",
    microchip_id: "985112004567890",
    emergency_contact: "Aunt Denise, 504-555-0199",
    is_evacuation_registered: true,
    created_at: AGO(200),
    updated_at: AGO(10),
  },
  {
    id: "69000000-0000-4000-8000-000000000002",
    owner_id: CUSTOMER_ID,
    name: "Praline",
    species: "cat",
    breed: "Domestic shorthair",
    age_years: 11,
    weight_lbs: 9,
    feeding_schedule: "Half a can wet food, dry food free-fed",
    medical_notes: "Senior kidney diet only.",
    is_evacuation_registered: false,
    created_at: AGO(200),
    updated_at: AGO(200),
  },
] satisfies Ins<"pet_profiles">[];

export const SEED_FAVORITE_HELPERS = [
  { id: "6a000000-0000-4000-8000-000000000001", customer_id: CUSTOMER_ID, helper_id: HELPER_ID, private_note: "Great with fences. Ask for him first.", created_at: AGO(18) },
  { id: "6a000000-0000-4000-8000-000000000002", customer_id: CUSTOMER_ID, helper_id: A2, private_note: null, created_at: AGO(90) },
  { id: "6a000000-0000-4000-8000-000000000003", customer_id: CUSTOMER_ID, helper_id: A3, private_note: "Has a trailer.", created_at: AGO(2) },
  { id: "6a000000-0000-4000-8000-000000000004", customer_id: HELPER_ID, helper_id: A3, private_note: null, created_at: AGO(40) },
] satisfies Ins<"favorite_helpers">[];

export const SEED_SAVED_SEARCHES = [
  { id: "6b000000-0000-4000-8000-000000000001", user_id: HELPER_ID, name: "Handyman near Lake Charles", category: "handyman", parish: "Calcasieu", radius_miles: 25, min_budget: 100, notify_enabled: true, last_notified_at: AGO(1), created_at: AGO(30) },
  { id: "6b000000-0000-4000-8000-000000000002", user_id: HELPER_ID, name: "Weekend events", category: "events", query: "crawfish", notify_enabled: false, created_at: AGO(12) },
  { id: "6b000000-0000-4000-8000-000000000003", user_id: CUSTOMER_ID, name: "Storm prep, Jefferson Parish", category: "storm_prep", parish: "Jefferson", max_budget: 400, notify_enabled: true, created_at: AGO(5) },
] satisfies Ins<"saved_searches">[];

export const SEED_SAVED_JOBS = [
  { id: "6c000000-0000-4000-8000-000000000001", user_id: HELPER_ID, job_id: J(9), created_at: AGO(1) },
  { id: "6c000000-0000-4000-8000-000000000002", user_id: HELPER_ID, job_id: J(10), created_at: AGO(1) },
  { id: "6c000000-0000-4000-8000-000000000003", user_id: CUSTOMER_ID, job_id: J(25), created_at: AGO(0) },
] satisfies Ins<"saved_jobs">[];

// ── Referrals ────────────────────────────────────────────────────────────────
export const SEED_REFERRAL_CODES = [
  { id: "6d000000-0000-4000-8000-000000000001", user_id: CUSTOMER_ID, code: "SMOKE", created_at: AGO(300) },
  { id: "6d000000-0000-4000-8000-000000000002", user_id: HELPER_ID, code: "SMOKEHELP", created_at: AGO(300) },
] satisfies Ins<"referral_codes">[];

export const SEED_REFERRALS = [
  { id: "6e000000-0000-4000-8000-000000000001", referral_code_id: "6d000000-0000-4000-8000-000000000001", referrer_id: CUSTOMER_ID, referred_id: A4, created_at: AGO(1) },
  { id: "6e000000-0000-4000-8000-000000000002", referral_code_id: "6d000000-0000-4000-8000-000000000001", referrer_id: CUSTOMER_ID, referred_id: A8, created_at: AGO(40) },
  { id: "6e000000-0000-4000-8000-000000000003", referral_code_id: "6d000000-0000-4000-8000-000000000002", referrer_id: HELPER_ID, referred_id: A5, created_at: AGO(21) },
] satisfies Ins<"referrals">[];

export const SEED_REFERRAL_CREDITS = [
  { id: "6f000000-0000-4000-8000-000000000001", user_id: CUSTOMER_ID, referral_code_id: "6d000000-0000-4000-8000-000000000001", referred_user_id: A8, amount: 10, reason: "referral_first_job", redeemed: true, created_at: AGO(35) },
  { id: "6f000000-0000-4000-8000-000000000002", user_id: CUSTOMER_ID, referral_code_id: "6d000000-0000-4000-8000-000000000001", referred_user_id: A4, amount: 10, reason: "referral_signup", redeemed: false, created_at: AGO(1) },
  { id: "6f000000-0000-4000-8000-000000000003", user_id: HELPER_ID, referral_code_id: "6d000000-0000-4000-8000-000000000002", referred_user_id: A5, amount: 10, reason: "referral_signup", redeemed: false, created_at: AGO(21) },
] satisfies Ins<"referral_credits">[];

export const SEED_PIF_CREDITS = [
  { id: "70000000-0000-4000-8000-000000000001", donor_id: CUSTOMER_ID, recipient_id: A8, recipient_email: "priya.raman@helpr.test", amount: 50, occasion: "birthday", message: "Happy birthday — get the yard done on me.", status: "sent", payment_status: "paid", created_at: AGO(12) },
  { id: "70000000-0000-4000-8000-000000000002", donor_id: A3, recipient_id: CUSTOMER_ID, amount: 25, status: "available", payment_status: "paid", parish: "Jefferson", created_at: AGO(4), expires_at: FUTURE(86) },
] satisfies Ins<"pif_credits">[];

export const SEED_STR_CALENDAR_CONNECTIONS = [
  { id: "71000000-0000-4000-8000-000000000001", user_id: CUSTOMER_ID, platform: "airbnb", ical_url: "https://www.airbnb.com/calendar/ical/000000.ics?s=seed", property_name: "Bywater shotgun double", property_address: "812 Piety St, New Orleans, LA", auto_create_cleaning: true, cleaning_budget: 95, cleaning_notes: "Strip beds, towels in the hall closet.", preferred_helper_id: A2, is_active: true, last_synced_at: AGO(0), created_at: AGO(60) },
  { id: "71000000-0000-4000-8000-000000000002", user_id: CUSTOMER_ID, platform: "vrbo", ical_url: "https://www.vrbo.com/icalendar/seed.ics", property_name: "Grand Isle camp", auto_create_cleaning: false, is_active: true, last_synced_at: AGO(3), last_sync_error: "Calendar URL returned 404", created_at: AGO(200) },
] satisfies Ins<"str_calendar_connections">[];

const NOTIF_PREF_BASE = {
  email_enabled: true,
  email_financial_alerts: true,
  email_job_applications: true,
  email_job_matches: false,
  email_job_updates: true,
  email_messages: false,
  email_new_offers: true,
  email_payments: true,
  email_promotions: false,
  email_reviews: true,
  email_system_alerts: true,
  email_transit_updates: false,
  email_work_status: true,
  financial_alerts: true,
  job_applications: true,
  job_matches: true,
  job_updates: true,
  match_digest_mode: false,
  messages: true,
  new_offers: true,
  payments: true,
  promotions: false,
  push_enabled: true,
  reviews: true,
  system_alerts: true,
  transit_updates: true,
  work_status: true,
} satisfies Partial<Ins<"notification_preferences">>;

export const SEED_NOTIFICATION_PREFERENCES = [
  { ...NOTIF_PREF_BASE, id: "72000000-0000-4000-8000-000000000001", user_id: CUSTOMER_ID, quiet_start: "22:00:00", quiet_end: "07:00:00", created_at: AGO(300), updated_at: AGO(5) },
  { ...NOTIF_PREF_BASE, id: "72000000-0000-4000-8000-000000000002", user_id: HELPER_ID, match_digest_mode: true, created_at: AGO(300), updated_at: AGO(40) },
] satisfies Ins<"notification_preferences">[];

export const SEED_BROADCAST_MESSAGES = [
  { id: "73000000-0000-4000-8000-000000000001", type: "info", title: "Tropical storm watch for the coast", message: "Jobs in Terrebonne, Lafourche and Plaquemines may be rescheduled this weekend. Check your Activity tab.", created_by: ADMIN_ID, starts_at: AGO(1), expires_at: FUTURE(3), created_at: AGO(1) },
  { id: "73000000-0000-4000-8000-000000000002", type: "warning", title: "Scheduled maintenance", message: "Payouts pause from 1 to 2am Sunday.", created_by: ADMIN_ID, starts_at: FUTURE(2), expires_at: FUTURE(4), created_at: AGO(0) },
  { id: "73000000-0000-4000-8000-000000000003", type: "info", title: "Mardi Gras hours", message: "Support replies may be slower this week.", created_by: ADMIN_ID, starts_at: AGO(200), expires_at: AGO(190), created_at: AGO(200) },
] satisfies Ins<"broadcast_messages">[];

export const SEED_LOGIN_HISTORY = [
  { id: "74000000-0000-4000-8000-000000000001", user_id: CUSTOMER_ID, ip_address: "73.12.44.201", user_agent: "Helpr/1.0.4 (iPhone; iOS 26.1)", created_at: AGO(0) },
  { id: "74000000-0000-4000-8000-000000000002", user_id: CUSTOMER_ID, ip_address: "73.12.44.201", user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", created_at: AGO(3) },
  { id: "74000000-0000-4000-8000-000000000003", user_id: CUSTOMER_ID, ip_address: "2600:1700:5a0:8e20::1f", user_agent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/139.0 Mobile Safari/537.36", created_at: AGO(11) },
  { id: "74000000-0000-4000-8000-000000000004", user_id: HELPER_ID, ip_address: "98.20.1.77", user_agent: "Helpr/1.0.4 (iPhone; iOS 26.1)", created_at: AGO(0) },
  { id: "74000000-0000-4000-8000-000000000005", user_id: HELPER_ID, ip_address: "98.20.1.77", user_agent: "Helpr/1.0.3 (iPhone; iOS 26.0)", created_at: AGO(9) },
] satisfies Ins<"login_history">[];

export const SEED_USER_BLOCKS = [
  { id: "75000000-0000-4000-8000-000000000001", blocker_id: CUSTOMER_ID, blocked_id: A6, reason: "Harassing messages", created_at: AGO(4) },
] satisfies Ins<"user_blocks">[];

// ── Admin: moderation queues with real numbers ───────────────────────────────
export const SEED_REPORTS = [
  { id: "76000000-0000-4000-8000-000000000001", reporter_id: CUSTOMER_ID, reported_id: A6, reported_type: "user", reason: "harassment", description: "Sent three messages after I declined his application, one with a slur.", status: "pending", created_at: AGO(4) },
  { id: "76000000-0000-4000-8000-000000000002", reporter_id: A2, reported_id: J(24), reported_type: "job", reason: "misleading", description: "Job said garage only; poster wanted the attic done too.", status: "investigating", assigned_to: ADMIN_ID, created_at: AGO(5) },
  { id: "76000000-0000-4000-8000-000000000003", reporter_id: HELPER_ID, reported_id: MSG(0), reported_type: "message", reason: "off_platform_payment", description: "Asked to pay cash to skip the fee.", status: "dismissed", created_at: AGO(30) },
  { id: "76000000-0000-4000-8000-000000000004", reporter_id: A9, reported_id: "40000000-0000-4000-8000-000000000006", reported_type: "review", reason: "retaliation", description: "This review came in after I reported the poster.", status: "new", created_at: AGO(2) },
  { id: "76000000-0000-4000-8000-000000000005", reporter_id: CUSTOMER_ID, reported_id: CUSTOMER_ID, reported_type: "support", reason: "payment_issue", description: "I was charged twice for the playset job and only one refund shows.", status: "pending", created_at: AGO(1) },
  { id: "76000000-0000-4000-8000-000000000006", reporter_id: A8, reported_id: A8, reported_type: "support", reason: "account", description: "Stuck on identity verification, the camera never opens.", status: "resolved", created_at: AGO(14) },
  { id: "76000000-0000-4000-8000-000000000007", reporter_id: A7, reported_id: A9, reported_type: "user", reason: "no_show", description: "Did not show up and did not answer.", status: "reviewed", created_at: AGO(8) },
] satisfies Ins<"reports">[];

export const SEED_USER_VIOLATIONS = [
  { id: "77000000-0000-4000-8000-000000000001", user_id: A6, violation_type: "harassment", action_taken: "warning", description: "Abusive language in messages.", reported_by: CUSTOMER_ID, created_at: AGO(40) },
  { id: "77000000-0000-4000-8000-000000000002", user_id: A6, violation_type: "harassment", action_taken: "temp_ban", description: "Repeat after warning.", reported_by: A2, created_at: AGO(20) },
  { id: "77000000-0000-4000-8000-000000000003", user_id: A6, violation_type: "harassment", action_taken: "permanent_ban", description: "Slur in messages after declined application.", reported_by: CUSTOMER_ID, created_at: AGO(3) },
  { id: "77000000-0000-4000-8000-000000000004", user_id: A7, violation_type: "no_show", action_taken: "temp_ban", description: "Third no-show in 30 days.", job_id: J(18), created_at: AGO(2) },
  { id: "77000000-0000-4000-8000-000000000005", user_id: A9, violation_type: "off_platform_payment", action_taken: "final_warning", description: "Asked a poster for cash.", created_at: AGO(6) },
  { id: "77000000-0000-4000-8000-000000000006", user_id: A9, violation_type: "admin_warning", action_taken: "pending_ban_review", description: "Auto-escalated after a second report.", reported_by: ADMIN_ID, created_at: AGO(1) },
  { id: "77000000-0000-4000-8000-000000000007", user_id: HELPER_ID, violation_type: "late_cancellation", action_taken: "warning", description: "Cancelled a booked job inside 24 hours.", job_id: J(22), created_at: AGO(3) },
] satisfies Ins<"user_violations">[];

export const SEED_FRAUD_FLAGS = [
  { id: "78000000-0000-4000-8000-000000000001", user_id: A9, flag_type: "off_platform_contact", details: "Phone number posted in 4 messages across 3 threads.", resolved: false, created_at: AGO(6) },
  { id: "78000000-0000-4000-8000-000000000002", user_id: A6, flag_type: "multi_reporter_flag", details: "3 distinct reporters in 40 days.", resolved: false, created_at: AGO(3) },
  { id: "78000000-0000-4000-8000-000000000003", user_id: A4, flag_type: "referral_abuse", details: "Signed up from the referrer's IP address.", resolved: false, created_at: AGO(1) },
  { id: "78000000-0000-4000-8000-000000000004", user_id: CUSTOMER_ID, flag_type: "high_dispute_rate", details: "2 disputes in the last 30 days.", job_id: J(7), resolved: false, created_at: AGO(2) },
  { id: "78000000-0000-4000-8000-000000000005", user_id: A7, flag_type: "rapid_cancellation_pattern", details: "4 cancellations in 10 days.", resolved: true, created_at: AGO(25) },
  { id: "78000000-0000-4000-8000-000000000006", user_id: A5, flag_type: "duplicate_content_posting", details: "Same bio as a denied account.", resolved: true, created_at: AGO(19) },
] satisfies Ins<"fraud_flags">[];

export const SEED_USER_BANS = [
  { id: "79000000-0000-4000-8000-000000000001", user_id: A6, ban_type: "permanent", reason: "Harassment after two prior violations.", banned_by: ADMIN_ID, is_active: true, created_at: AGO(3) },
  { id: "79000000-0000-4000-8000-000000000002", user_id: A7, ban_type: "temporary", reason: "Third no-show in 30 days.", banned_by: ADMIN_ID, is_active: true, expires_at: FUTURE(5), created_at: AGO(2) },
  { id: "79000000-0000-4000-8000-000000000003", user_id: A6, ban_type: "temporary", reason: "Repeat harassment.", banned_by: ADMIN_ID, is_active: false, expires_at: AGO(13), created_at: AGO(20) },
] satisfies Ins<"user_bans">[];

const AUDIT_DETAILS_BAN = { reason: "Harassment after two prior violations.", ban_type: "permanent" };
const AUDIT_DETAILS_DISPUTE = { decision: "split", helper_cents: 7700, refund_cents: 8750 };
const AUDIT_DETAILS_SETTINGS = { field: "helper_fee_percent", from: 15, to: 12 };
const AUDIT_DETAILS_DENY = { reason: "ID photo unreadable" };

export const SEED_ADMIN_AUDIT_LOG = [
  { id: "7a000000-0000-4000-8000-000000000001", admin_id: ADMIN_ID, action: "ban_user", target_type: "user", target_id: A6, details: AUDIT_DETAILS_BAN, created_at: AGO(3) },
  { id: "7a000000-0000-4000-8000-000000000002", admin_id: ADMIN_ID, action: "decide_dispute", target_type: "job", target_id: J(20), details: AUDIT_DETAILS_DISPUTE, created_at: AGO(21) },
  { id: "7a000000-0000-4000-8000-000000000003", admin_id: ADMIN_ID, action: "update_platform_settings", target_type: "platform_settings", target_id: null, details: AUDIT_DETAILS_SETTINGS, created_at: AGO(45) },
  { id: "7a000000-0000-4000-8000-000000000004", admin_id: ADMIN_ID, action: "deny_user", target_type: "user", target_id: A5, details: AUDIT_DETAILS_DENY, created_at: AGO(19) },
  { id: "7a000000-0000-4000-8000-000000000005", admin_id: ADMIN_ID, action: "approve_user", target_type: "user", target_id: A8, details: null, created_at: AGO(40) },
  { id: "7a000000-0000-4000-8000-000000000006", admin_id: ADMIN_ID, action: "manual_payout", target_type: "job", target_id: J(15), details: null, created_at: AGO(61) },
  { id: "7a000000-0000-4000-8000-000000000007", admin_id: null, action: "auto_suspend", target_type: "user", target_id: A7, details: null, created_at: AGO(2) },
  { id: "7a000000-0000-4000-8000-000000000008", admin_id: ADMIN_ID, action: "resolve_report", target_type: "report", target_id: "76000000-0000-4000-8000-000000000006", details: null, created_at: AGO(13) },
] satisfies Ins<"admin_audit_log">[];

export const SEED_ADMIN_USER_NOTES = [
  { id: "7b000000-0000-4000-8000-000000000001", admin_id: ADMIN_ID, user_id: A6, category: "behavior", note: "Called support twice demanding the ban be lifted. Do not reinstate without a second admin.", created_at: AGO(2), updated_at: AGO(2) },
  { id: "7b000000-0000-4000-8000-000000000002", admin_id: ADMIN_ID, user_id: A9, category: "verification", note: "IDV in manual review — selfie and license photo are different lighting, likely same person.", created_at: AGO(5), updated_at: AGO(4) },
  { id: "7b000000-0000-4000-8000-000000000003", admin_id: ADMIN_ID, user_id: A4, category: "support", note: "Asked how long approval takes. Told 1–2 business days.", created_at: AGO(1), updated_at: AGO(1) },
  { id: "7b000000-0000-4000-8000-000000000004", admin_id: ADMIN_ID, user_id: CUSTOMER_ID, category: "billing", note: "Double-charge report on the playset job: one charge was an auth hold, already released.", created_at: AGO(1), updated_at: AGO(1) },
] satisfies Ins<"admin_user_notes">[];

export const SEED_VERIFICATION_EXCEPTIONS = [
  { id: "7c000000-0000-4000-8000-000000000001", user_id: A9, exception_type: "name_mismatch", status: "open", notes: "License says Robert, account says Bobby.", created_at: AGO(5) },
  { id: "7c000000-0000-4000-8000-000000000002", user_id: HELPER_ID, credential_id: "68000000-0000-4000-8000-000000000003", exception_type: "board_no_api", status: "in_progress", assigned_to: ADMIN_ID, notes: "LSLBC has no lookup API; checking the PDF roster by hand.", created_at: AGO(4) },
  { id: "7c000000-0000-4000-8000-000000000003", user_id: A5, exception_type: "document_unclear", status: "resolved", resolution: "Denied — resubmission was also unreadable.", resolved_at: AGO(19), created_at: AGO(20) },
] satisfies Ins<"verification_exceptions">[];

const FEATURE_FLAGS = {};

export const SEED_PLATFORM_SETTINGS = [
  {
    id: "7d000000-0000-4000-8000-000000000001",
    customer_fee_percent: 5,
    helper_fee_percent: 12,
    platform_fee_percent: 12,
    hybrid_idv_enabled: true,
    idv_auto_approve_threshold: 0.9,
    onboarding_fee_cents: 200,
    min_supported_build: 0,
    latest_build: 0,
    feature_flags: FEATURE_FLAGS,
    updated_at: AGO(45),
    updated_by: ADMIN_ID,
  },
] satisfies Ins<"platform_settings">[];

export const SEED_NOTIFICATION_LOGS = [
  { id: "7e000000-0000-4000-8000-000000000001", user_id: HELPER_ID, category: "payments", channel: "email", status: "sent", subject: "Your payout is on its way", recipient_email: "helper.smoke@helpr.test", job_id: J(14), created_at: AGO(19) },
  { id: "7e000000-0000-4000-8000-000000000002", user_id: CUSTOMER_ID, category: "messages", channel: "push", status: "sent", job_id: J(12), created_at: AGO(0) },
  { id: "7e000000-0000-4000-8000-000000000003", user_id: A8, category: "system_alerts", channel: "email", status: "failed", error_message: "Mailbox full", recipient_email: "priya.raman@helpr.test", created_at: AGO(3) },
] satisfies Ins<"notification_logs">[];

export const SEED_HELPER_VERIFICATIONS = [
  { id: "7f000000-0000-4000-8000-000000000001", user_id: HELPER_ID, field: "license_status", old_value: "none", new_value: "pending", changed_by: HELPER_ID, changed_at: AGO(4) },
  { id: "7f000000-0000-4000-8000-000000000002", user_id: HELPER_ID, field: "insurance_status", old_value: "verified", new_value: "rejected", changed_by: ADMIN_ID, changed_at: AGO(14) },
] satisfies Ins<"helper_verifications">[];

/**
 * `open_jobs_browse` is a VIEW: open jobs with an owner, projected to the
 * columns the feed reads plus `applicant_count`. Derived rather than restated
 * so the feed and the jobs table can never disagree about what is open.
 */
export function browseRowsFrom(jobs: Record<string, unknown>[], applications: Record<string, unknown>[]) {
  return jobs
    .filter((j) => j.status === "open" && j.customer_id != null)
    .map((j) => ({
      ...j,
      applicant_count: applications.filter((a) => a.job_id === j.id).length,
      require_photo_proof: false,
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// RPC answers. Each takes the request's JSON args and a context holding the
// table set in use (normal or heavy) and the signed-in user, and derives its
// answer from those rows — so an RPC and the table it summarises agree.
// ═════════════════════════════════════════════════════════════════════════════

export interface SeedRpcContext {
  tables: Record<string, unknown[]>;
  userId: string | null;
}
type R = Record<string, unknown>;
type RpcAnswer = (args: R, ctx: SeedRpcContext) => unknown;

const PARISH_COORDS: Record<string, [number, number]> = {
  "East Baton Rouge": [30.4515, -91.1871],
  Orleans: [29.9511, -90.0715],
  Jefferson: [29.9941, -90.1531],
  "St. Martin": [30.2745, -91.8993],
  "St. Tammany": [30.3591, -90.0654],
  Calcasieu: [30.2266, -93.2174],
  Terrebonne: [29.5958, -90.7195],
  Lafayette: [30.2241, -92.0198],
  "St. Landry": [30.5335, -92.0815],
  Caddo: [32.5252, -93.7502],
};

const rows = (ctx: SeedRpcContext, t: string) => (ctx.tables[t] ?? []) as R[];
const profileOf = (ctx: SeedRpcContext, uid: unknown) => rows(ctx, "profiles").find((p) => p.user_id === uid);
const idList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const completedFor = (ctx: SeedRpcContext, helperId: unknown) =>
  rows(ctx, "jobs").filter((j) => j.helper_id === helperId && j.status === "completed");

function safeProfile(p: R): R {
  return {
    profile_id: p.id,
    user_id: p.user_id,
    full_name: p.full_name ?? null,
    avatar_url: p.avatar_url ?? null,
    bio: p.bio ?? null,
    business_name: p.business_name ?? null,
    created_at: p.created_at,
    hourly_rate: p.hourly_rate ?? null,
    insurance_status: p.insurance_status ?? "none",
    license_status: p.license_status ?? "none",
    is_id_verified: p.idv_status === "verified",
    is_insured: p.is_insured ?? false,
    is_licensed: p.is_licensed ?? false,
    is_payout_ready: Boolean(p.stripe_payouts_enabled),
    location: p.location ?? null,
    portfolio_urls: [],
    role: "helper",
    skills: p.skills ?? null,
    subscription_tier: p.subscription_tier ?? "free",
  };
}

function profileStats(ctx: SeedRpcContext, uid: string): R {
  const jobs = rows(ctx, "jobs");
  const asHelper = jobs.filter((j) => j.helper_id === uid);
  const posted = jobs.filter((j) => j.customer_id === uid);
  const got = rows(ctx, "reviews").filter((r) => r.reviewee_id === uid);
  const helperReviews = got.filter((r) => asHelper.some((j) => j.id === r.job_id));
  const posterReviews = got.filter((r) => posted.some((j) => j.id === r.job_id));
  const avg = (rs: R[]) => (rs.length ? rs.reduce((n, r) => n + Number(r.rating), 0) / rs.length : null);
  const done = asHelper.filter((j) => j.status === "completed").length;
  const cancelled = asHelper.filter((j) => j.status === "cancelled").length;
  const p = profileOf(ctx, uid) ?? {};
  return {
    user_id: uid,
    approval_status: p.approval_status ?? "approved",
    avg_rating: avg(helperReviews.length ? helperReviews : got),
    review_count: got.length,
    poster_avg_rating: avg(posterReviews),
    poster_review_count: posterReviews.length,
    completed_jobs_as_helper: done,
    completed_jobs_total: done + posted.filter((j) => j.status === "completed").length,
    jobs_total: asHelper.length,
    posted_jobs_total: posted.length,
    cancelled_jobs: cancelled,
    cancellation_rate: asHelper.length ? cancelled / asHelper.length : 0,
    on_time_rate: 0.94,
    on_time_sample: done,
    revision_rate: 0.08,
    revision_sample: done,
    repeat_hire_percent: 40,
    repeat_client_sample: done,
    has_pending_credentials: rows(ctx, "helper_credentials").some((c) => c.user_id === uid && c.status === "submitted"),
    has_stripe_account: Boolean(p.stripe_account_id),
    is_background_checked: p.background_check_status === "verified",
    is_id_verified: p.idv_status === "verified",
  };
}

function earningsJob(j: R): R {
  return {
    id: j.id,
    budget: j.budget,
    platform_fee_amount: j.platform_fee_amount ?? null,
    helper_fee_percent: j.helper_fee_percent ?? 12,
    urgent_fee: j.urgent_fee ?? null,
    is_group_job: j.is_group_job ?? false,
    helpers_needed: j.helpers_needed ?? 1,
    payment_status: j.payment_status ?? "released",
    category: j.category,
    parish: j.parish ?? null,
    completed_at: j.helper_completed_at ?? j.updated_at,
  };
}

export const SEED_RPCS: Record<string, RpcAnswer> = {
  get_jobs_for_my_applications: (_a, ctx) => rows(ctx, "jobs"),
  get_safe_profiles: (a, ctx) => {
    const want = new Set(idList(a.user_ids));
    return rows(ctx, "profiles").filter((p) => want.has(String(p.user_id))).map(safeProfile);
  },
  get_public_profile_stats: (a, ctx) => idList(a.p_user_ids).map((uid) => profileStats(ctx, uid)),
  get_public_profile_reviews: (a, ctx) => {
    const got = rows(ctx, "reviews").filter((r) => r.reviewee_id === a.p_user_id);
    const offset = Number(a.p_offset ?? 0);
    const limit = Number(a.p_limit ?? 20);
    return got.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      feedback: r.feedback ?? null,
      rating: r.rating,
      response_at: r.response_at ?? null,
      response_text: r.response_text ?? null,
      job_category: rows(ctx, "jobs").find((j) => j.id === r.job_id)?.category ?? null,
      reviewer_name: profileOf(ctx, r.reviewer_id)?.full_name ?? "Helpr member",
      total_count: got.length,
    }));
  },
  get_user_last_active: (a) =>
    idList(a.user_ids).map((uid, i) => ({ user_id: uid, last_active_at: AGO(i % 3 === 0 ? 0 : i) })),
  get_user_repeat_hire_percent: () => 40,
  get_user_credential_tier: () => 2,
  get_my_reply_latency: () => [{ median_reply_minutes: 12, reply_sample: 38 }],
  get_my_saved_helpers: (_a, ctx) =>
    rows(ctx, "favorite_helpers")
      .filter((f) => f.customer_id === ctx.userId)
      .map((f) => {
        const p = profileOf(ctx, f.helper_id) ?? {};
        const together = rows(ctx, "jobs").filter((j) => j.helper_id === f.helper_id && j.customer_id === ctx.userId);
        return {
          helper_id: f.helper_id,
          full_name: p.full_name ?? "Helpr member",
          avatar_url: p.avatar_url ?? null,
          bio: p.bio ?? null,
          hourly_rate: p.hourly_rate ?? null,
          parish: p.parish ?? null,
          skills: p.skills ?? null,
          available_until: null,
          private_note: f.private_note ?? null,
          saved_at: f.created_at,
          completed_jobs_together: together.filter((j) => j.status === "completed").length,
          last_job_at: together[0]?.created_at ?? null,
        };
      }),
  get_my_pending_direct_offers: (_a, ctx) =>
    rows(ctx, "jobs").filter((j) => j.offered_to_helper_id === ctx.userId && j.direct_offer_status === "pending"),
  get_helper_earnings_export: (a, ctx) =>
    completedFor(ctx, a._helper_id ?? ctx.userId).map((j) => {
      const fee = Number(j.platform_fee_amount ?? Number(j.budget) * 0.12);
      return {
        job_id: j.id,
        job_title: j.title,
        category: j.category,
        parish: j.parish ?? null,
        date_completed: String(j.helper_completed_at ?? j.updated_at).slice(0, 10),
        gross_budget: j.budget,
        platform_fee: fee,
        net_payout: Number(j.budget) - fee,
        parish_tax_collected: 0,
        tax_status: "not_applicable",
      };
    }),
  get_helper_analytics: (_a, ctx) => {
    const jobs = completedFor(ctx, ctx.userId).map(earningsJob);
    const apps = rows(ctx, "applications").filter((x) => x.helper_id === ctx.userId);
    return {
      generated_at: NOW,
      window_days: 365,
      tier: "pro",
      entitled: true,
      floors: { category_jobs: 3, decided_applications: 3, applications: 5, head_to_head: 3, market_jobs: 10, market_category_jobs: 5 },
      jobs,
      applications: apps.map((x, i) => ({
        id: x.id,
        applied_at: x.created_at,
        minutes_to_apply: 6 + i * 7,
        outcome: x.status === "accepted" ? "won" : x.status === "rejected" ? "lost" : "undecided",
        category: rows(ctx, "jobs").find((j) => j.id === x.job_id)?.category ?? null,
        parish: rows(ctx, "jobs").find((j) => j.id === x.job_id)?.parish ?? null,
      })),
      head_to_head: { sample: 6, you_were_first: 4, your_median_minutes: 9, winner_median_minutes: 14 },
      market: {
        scope: "parish",
        parishes: ["Jefferson", "Orleans"],
        window_days: 90,
        sample: 214,
        demand: [
          { dow: 6, block: 1, jobs: 31 },
          { dow: 6, block: 2, jobs: 22 },
          { dow: 0, block: 1, jobs: 18 },
          { dow: 3, block: 3, jobs: 9 },
        ],
        rates: [
          { category: "handyman", jobs: 58, median_budget: 165 },
          { category: "cleaning", jobs: 71, median_budget: 140 },
          { category: "yard_work", jobs: 49, median_budget: 95 },
        ],
      },
    };
  },
  get_job_pets: (_a, ctx) => rows(ctx, "pet_profiles"),
  get_open_jobs_for_map: (_a, ctx) =>
    rows(ctx, "jobs")
      .filter((j) => j.status === "open")
      .map((j, i) => {
        const [lat, lng] = PARISH_COORDS[String(j.parish)] ?? [30.45 + i * 0.01, -91.18 - i * 0.01];
        return {
          id: j.id,
          title: j.title,
          budget: j.budget,
          category: j.category,
          created_at: j.created_at,
          date_needed: j.date_needed,
          start_time: j.start_time ?? null,
          helpers_needed: j.helpers_needed ?? 1,
          is_group_job: j.is_group_job ?? false,
          is_urgent: j.is_urgent ?? false,
          urgent_fee: j.urgent_fee ?? null,
          location: j.location,
          parish: j.parish ?? null,
          latitude: lat + ((i % 5) - 2) * 0.004,
          longitude: lng + ((i % 7) - 3) * 0.004,
        };
      }),
  get_ranked_open_jobs: (_a, ctx) =>
    rows(ctx, "jobs")
      .filter((j) => j.status === "open")
      .map((j, i) => ({ ...j, rank_score: 1 - i * 0.01, parish_match: i % 2 === 0, distance_band: i % 3 === 0 ? "near" : "far" })),
  get_parish_activity: () => [
    { parish: "Orleans", active_jobs: 42, completed_jobs_30d: 188, helper_count: 97, revenue_30d: 31240 },
    { parish: "Jefferson", active_jobs: 35, completed_jobs_30d: 151, helper_count: 80, revenue_30d: 24410 },
    { parish: "East Baton Rouge", active_jobs: 28, completed_jobs_30d: 119, helper_count: 64, revenue_30d: 18975 },
    { parish: "Lafayette", active_jobs: 14, completed_jobs_30d: 57, helper_count: 31, revenue_30d: 8120 },
  ],
  get_category_price_stats: () => [{ p25: 90, p50: 140, p75: 210, parish_match: true, sample_count: 63 }],
  get_fill_rate_stats: () => [
    { parish: "Orleans", total_jobs: 412, filled_jobs: 361, fill_rate_pct: 87.6, parish_fill_rate_pct: 87.6, median_minutes_to_first_app: 18 },
    { parish: "Jefferson", total_jobs: 305, filled_jobs: 251, fill_rate_pct: 82.3, parish_fill_rate_pct: 82.3, median_minutes_to_first_app: 24 },
  ],
  get_helper_tiers: (_a, ctx) =>
    rows(ctx, "profiles").map((p, i) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      avatar_url: p.avatar_url ?? null,
      parish: p.parish ?? null,
      tier: ["Elite", "Verified", "Rising Star", "Active", "New"][i % 5],
      completed_jobs: 40 - i * 4,
      total_reviews: 30 - i * 3,
      avg_rating: 4.9 - i * 0.2,
      recent_reviews: 6 - (i % 6),
      recent_avg_rating: 4.8 - i * 0.15,
      growth_score: 88 - i * 7,
    })),
  get_payout_batches: (_a, ctx) => {
    const byHelper = new Map<string, R[]>();
    for (const j of rows(ctx, "jobs").filter((x) => x.payment_status === "payout_pending" || x.payment_status === "failed")) {
      const k = String(j.helper_id);
      byHelper.set(k, [...(byHelper.get(k) ?? []), j]);
    }
    return [...byHelper.entries()].map(([hid, js]) => ({
      helper_id: hid,
      helper_name: profileOf(ctx, hid)?.full_name ?? "Smoke Helper",
      helper_email: profileOf(ctx, hid)?.email ?? "helper.smoke@helpr.test",
      job_count: js.length,
      total_payout: js.reduce((n, j) => n + Number(j.budget) * 0.88, 0),
      oldest_completed_at: js.map((j) => String(j.helper_completed_at ?? j.created_at)).sort()[0],
      stripe_account_id: "acct_seed_smoke_helper",
    }));
  },
  get_payout_batch_job_ids: (a, ctx) =>
    rows(ctx, "jobs")
      .filter((j) => (a.p_helper_id == null || j.helper_id === a.p_helper_id) && (j.payment_status === "payout_pending" || j.payment_status === "failed"))
      .map((j) => ({ job_id: j.id })),
  get_pending_credentials: (_a, ctx) =>
    rows(ctx, "helper_credentials")
      .filter((c) => c.status === "submitted")
      .map((c) => {
        const p = profileOf(ctx, c.user_id) ?? {};
        return {
          user_id: c.user_id,
          full_name: p.full_name ?? "Smoke Helper",
          email: p.email ?? "helper.smoke@helpr.test",
          avatar_url: p.avatar_url ?? null,
          business_name: p.business_name ?? null,
          is_licensed: c.credential_type === "trade_license",
          license_status: c.credential_type === "trade_license" ? "pending" : "none",
          license_url: null,
          is_insured: c.credential_type === "insurance",
          insurance_status: c.credential_type === "insurance" ? "pending" : "none",
          insurance_url: null,
          submitted_at: c.created_at,
        };
      }),
  admin_support_queue: (_a, ctx) =>
    rows(ctx, "reports")
      .filter((r) => r.reported_type === "support")
      .map((r) => {
        const p = profileOf(ctx, r.reporter_id) ?? {};
        return {
          id: r.id,
          created_at: r.created_at,
          priority_at: r.created_at,
          description: r.description ?? "",
          reason: r.reason,
          status: r.status,
          reporter_id: r.reporter_id,
          reporter_name: p.full_name ?? "Smoke Customer",
          reporter_email: p.email ?? "customer.smoke@helpr.test",
          priority_support: p.subscription_tier === "pro" || p.subscription_tier === "elite",
          support_tier: p.subscription_tier ?? "free",
        };
      }),
  get_public_platform_settings: (_a, ctx) =>
    rows(ctx, "platform_settings").map((s) => ({
      id: s.id,
      customer_fee_percent: s.customer_fee_percent,
      helper_fee_percent: s.helper_fee_percent,
      hybrid_idv_enabled: s.hybrid_idv_enabled,
      idv_auto_approve_threshold: s.idv_auto_approve_threshold,
      min_supported_build: s.min_supported_build,
      onboarding_fee_cents: s.onboarding_fee_cents,
      feature_flags: s.feature_flags,
    })),
  search_profiles_by_name: (a, ctx) => {
    const q = String(a.p_query ?? a.search_term ?? a.q ?? "").toLowerCase();
    return rows(ctx, "profiles")
      .filter((p) => String(p.full_name ?? "").toLowerCase().includes(q))
      .map((p) => ({ user_id: p.user_id, full_name: p.full_name, avatar_url: p.avatar_url ?? null }));
  },
  get_muted_threads: () => [],
  are_users_blocked: () => false,
  rpc_check_application_rate: () => [{ allowed: true, reason: null, retry_after_seconds: 0 }],
};

/**
 * Table → rows. `installSupabaseMocks` consults this before falling back to an
 * empty array, so adding a table is a one-line edit here.
 *
 * Keep each value a bare SCREAMING_CASE const: fixtureSchemaContract.test.ts
 * reads this map as text to find which rows belong to which table, and grades
 * those rows against the migrations' CHECK constraints.
 */
export const SEED_TABLES: Record<string, unknown[]> = {
  profiles: SEED_PROFILES,
  jobs: SEED_JOBS,
  applications: SEED_APPLICATIONS,
  messages: SEED_ALL_MESSAGES,
  reviews: SEED_REVIEWS,
  notifications: SEED_NOTIFICATIONS,
  message_reactions: SEED_MESSAGE_REACTIONS,
  thread_pins: SEED_THREAD_PINS,
  thread_archives: SEED_THREAD_ARCHIVES,
  disputes: SEED_DISPUTES,
  job_revisions: SEED_JOB_REVISIONS,
  job_tracking: SEED_JOB_TRACKING,
  payout_transfers: SEED_PAYOUT_TRANSFERS,
  tips: SEED_TIPS,
  group_job_helpers: SEED_GROUP_JOB_HELPERS,
  helper_availability: SEED_HELPER_AVAILABILITY,
  helper_credentials: SEED_HELPER_CREDENTIALS,
  pet_profiles: SEED_PET_PROFILES,
  favorite_helpers: SEED_FAVORITE_HELPERS,
  saved_searches: SEED_SAVED_SEARCHES,
  saved_jobs: SEED_SAVED_JOBS,
  referral_codes: SEED_REFERRAL_CODES,
  referrals: SEED_REFERRALS,
  referral_credits: SEED_REFERRAL_CREDITS,
  pif_credits: SEED_PIF_CREDITS,
  str_calendar_connections: SEED_STR_CALENDAR_CONNECTIONS,
  notification_preferences: SEED_NOTIFICATION_PREFERENCES,
  broadcast_messages: SEED_BROADCAST_MESSAGES,
  login_history: SEED_LOGIN_HISTORY,
  user_blocks: SEED_USER_BLOCKS,
  reports: SEED_REPORTS,
  user_violations: SEED_USER_VIOLATIONS,
  fraud_flags: SEED_FRAUD_FLAGS,
  user_bans: SEED_USER_BANS,
  admin_audit_log: SEED_ADMIN_AUDIT_LOG,
  admin_user_notes: SEED_ADMIN_USER_NOTES,
  verification_exceptions: SEED_VERIFICATION_EXCEPTIONS,
  platform_settings: SEED_PLATFORM_SETTINGS,
  notification_logs: SEED_NOTIFICATION_LOGS,
  helper_verifications: SEED_HELPER_VERIFICATIONS,
  open_jobs_browse: browseRowsFrom(SEED_JOBS, SEED_APPLICATIONS),
};
