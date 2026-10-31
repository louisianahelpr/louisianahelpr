import type { Database } from "@/integrations/supabase/types";
import type { APPLICATION_PRIVATE_COLUMNS } from "@/lib/applicationColumns";
import { CATEGORY_ICONS } from "@/lib/categoryIcons";
import { JOB_CATEGORIES, JOB_CATEGORY_LABELS } from "@/lib/jobCategories";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
// flag_reason and the withheld texts are kept from clients by a column
// grant (Q1232, Q1206): see src/lib/applicationColumns.ts.
export type Application = Omit<Database["public"]["Tables"]["applications"]["Row"], (typeof APPLICATION_PRIVATE_COLUMNS)[number]> & {
  /**
   * Server-set contact-leak flag, added by migration 20260907005738 and not yet
   * in the generated types (regenerating mid-launch would land a large diff for
   * one column). True when applications_scan_contact_info matched a phone
   * number, email, off-platform payment service or intent phrase in `message`
   * or `offer_message`.
   *
   * Optional because the older narrow selects in this codebase do not request
   * it — and an optional flag read as falsy is the SAFE direction here: it
   * shows the text, which is exactly today's behaviour, rather than hiding
   * content on a surface that never asked for the column.
   */
  flagged_hidden?: boolean | null;
  /**
   * Why the SYSTEM closed this application (migration 20260923205811, Q274;
   * not yet in the generated types, same reason as above). 'job_cancelled':
   * its job was cancelled, so it went to 'rejected' without anyone turning the
   * applicant down. Read it before saying "Not selected" or "Declined".
   */
  closed_reason?: string | null;
};

export type Tab = "posted" | "applied";

/**
 * Re-exported from the canonical `src/lib/categoryIcons.ts`. The single
 * source of truth lives there so non-activity surfaces (landing,
 * post-a-task, profile) can import the icon map without dragging in
 * activity-specific types.
 */
export const categoryIcons = CATEGORY_ICONS;

/**
 * Re-exported from the canonical `src/lib/jobCategories.ts`. Labels and
 * display order live there so the post-a-job picker, browse filter, map
 * popup and admin all render the same word in the same order.
 */
export const categoryLabels: Record<string, string> = JOB_CATEGORY_LABELS;

export const categories = JOB_CATEGORIES.map(({ value, label }) => ({ value, label }));

/** Every category wears the same olive (spec v2: no per-category colours; audit #17, 2026-10-21). */
const ONE_CATEGORY_STYLE = {
  badge: "bg-primary/10 text-primary border-primary/25",
  title: "text-primary",
  dot: "bg-primary",
};

export const categoryColors: Record<string, { badge: string; title: string; dot: string }> = {
  cleaning: ONE_CATEGORY_STYLE,
  yard_work: ONE_CATEGORY_STYLE,
  moving: ONE_CATEGORY_STYLE,
  errands: ONE_CATEGORY_STYLE,
  handyman: ONE_CATEGORY_STYLE,
  painting: ONE_CATEGORY_STYLE,
  delivery: ONE_CATEGORY_STYLE,
  pet_care: ONE_CATEGORY_STYLE,
  assembly: ONE_CATEGORY_STYLE,
  storm_prep: ONE_CATEGORY_STYLE,
  events: ONE_CATEGORY_STYLE,
  electrical: ONE_CATEGORY_STYLE,
  plumbing: ONE_CATEGORY_STYLE,
  hvac: ONE_CATEGORY_STYLE,
  roofing: ONE_CATEGORY_STYLE,
  welding: ONE_CATEGORY_STYLE,
  carpentry: ONE_CATEGORY_STYLE,
  auto_repair: ONE_CATEGORY_STYLE,
  appliance_repair: ONE_CATEGORY_STYLE,
  flooring: ONE_CATEGORY_STYLE,
  concrete_masonry: ONE_CATEGORY_STYLE,
  fencing: ONE_CATEGORY_STYLE,
  pressure_washing: ONE_CATEGORY_STYLE,
  declutter_help: ONE_CATEGORY_STYLE,
  other: ONE_CATEGORY_STYLE,
};

/**
 * @deprecated — use `jobStatusColorClasses` from `@/lib/statusColors`
 * directly. This export is the original per-surface status-pill map; it
 * has been re-pointed at the canonical color taxonomy so any legacy
 * consumer paints identically to the rest of the app.
 *
 * Why kept: the activity-constants test asserts every `job_status` enum
 * value has a row here. Removing it would silently lose that tripwire.
 * New code: import `jobStatusColorClasses(status)` instead.
 */
import { jobStatusColorClasses } from "@/lib/statusColors";

// `Database` is already imported at the top of this file.
type JobStatus = Database["public"]["Enums"]["job_status"];

/**
 * Typed `Record<JobStatus, …>`, NOT `Record<string, …>`.
 *
 * The doc above claims "the activity-constants test asserts every job_status
 * enum value has a row here". It did not — the test's `required` array was
 * hand-maintained and never listed `pending_approval`, so the map silently
 * lost a status and `Record<string, string>` meant the compiler could not say
 * so either. A missing status returns `undefined`, which renders as an
 * unstyled badge.
 *
 * With the key type bound to the DB enum, omitting a status is a COMPILE
 * error and a new enum value breaks the build until someone gives it a colour.
 * That is the third time in this codebase a status has fallen through a map or
 * a switch and rendered nothing; a comment asking people to remember was the
 * safeguard each time, and it failed each time.
 */
export const statusBadge: Record<JobStatus, string> = {
  open:               jobStatusColorClasses("open"),
  accepted:           jobStatusColorClasses("accepted"),
  in_progress:        jobStatusColorClasses("in_progress"),
  revision_requested: jobStatusColorClasses("revision_requested"),
  completed:          jobStatusColorClasses("completed"),
  cancelled:          jobStatusColorClasses("cancelled"),
  disputed:           jobStatusColorClasses("disputed"),
  pending_approval:   jobStatusColorClasses("pending_approval"),
};

export type EnrichedApplication = Application & {
  profiles?: {
    full_name: string | null;
    skills: string | null;
    user_id: string;
    avatar_url?: string | null;
    /** Active subscription tier — drives the gold halo on Pro/Elite
        applicants so posters spot subscribed helpers at a glance. */
    subscription_tier?: string | null;
    /** "Available now" expiry — set to NOW()+4h when the helper signals
        readiness; shown as a green pill on the applicant card. */
    available_until?: string | null;
    /** Credential trust signals — returned by get_safe_profiles since
        2026-08-24 so CredentialBadge can render on the hiring surface. */
    is_licensed?: boolean | null;
    license_status?: string | null;
    is_insured?: boolean | null;
    insurance_status?: string | null;
    /** Business name off the licence/COI. get_safe_profiles masks it unless a
        credential is verified, so it is safe to hand straight to the badge. */
    business_name?: string | null;
    /** The "ID verified" badge: Stripe Identity's photo ID + selfie only
        (`idv_status = 'verified'`, get_safe_profiles, owner 2026-10-21). Shown
        on the applicant card so a poster can weigh it before deciding who to
        let into their home. Payout setup is `is_payout_ready`, never this. */
    is_id_verified?: boolean | null;
    /** The other half: a Stripe payout account that can actually be paid. */
    is_payout_ready?: boolean | null;
  } | null;
  reviewCount?: number;
  avgRating?: number;
};

/** Who the after-completion prompt (CompletionPrompts) reviews, and whether
 *  this poster already tipped (then the tip step is skipped; UX-7). */
export type CompletionPromptTarget = { job: Job; revieweeId: string; revieweeName: string; tipped?: boolean };

export type AppliedApp = Application & {
  /** JOBS-12: what is left to read of a job closed to this Helpr (get_closed_application_job_labels). */
  closed_job_label?: { title: string | null; date_needed: string | null } | null;
  job?: (Job & { revision_note?: string | null }) | null;
  posterName?: string;
};

/**
 * The status filter each Activity tab opens on.
 *
 * Single source of truth because it was previously written out twice —
 * Activity.tsx computed the initial `statusFilter`, and the page header
 * independently recomputed the same expression to decide whether to show the
 * "filtered" dot and what "Clear all" should reset to. Two copies of a default
 * is a defect waiting to happen, and it did: they drifted, so the header lit
 * its active-filter indicator on a view the user had never filtered, and
 * "Clear all" would have reset to a status the page never opens on.
 *
 * Both tabs open on "needs_you" so My Jobs and My Posts lead with the same
 * word, and with the one thing on the screen that is actually asking something
 * of the reader. It replaced "active", which was true of an open job, an
 * offered job, an in-progress job and a job sitting on the reader's approval
 * alike — a bucket so broad that every card needed its own status band to say
 * which kind it was.
 *
 * Jobs > Posted / Working (owner, 2026-10-19) open on EVERY group ("all")
 * instead, under status boxes; the old open-on-the-first-non-empty-bucket rule
 * (2026-10-08) went with My Posts / My Jobs (Q2205).
 *
 * See ActivityBucket in activityFilters.ts for what each of the four means and
 * why they are exhaustive.
 */
export function defaultStatusFilterFor(_tab: "posted" | "applied"): string {
  return "needs_you";
}

