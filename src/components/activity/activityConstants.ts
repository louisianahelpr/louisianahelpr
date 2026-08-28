import type { Database } from "@/integrations/supabase/types";
import { CATEGORY_ICONS } from "@/lib/categoryIcons";
import { JOB_CATEGORIES, JOB_CATEGORY_LABELS } from "@/lib/jobCategories";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type Application = Database["public"]["Tables"]["applications"]["Row"];

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

/**
 * Category palette — one distinct hue per category so the feed is
 * instantly scannable, but every hue is deliberately desaturated
 * (28–50% saturation, dusty mid-tone text on a pale wash) so the spread
 * reads as a refined, earthy set rather than a bright primary rainbow.
 * Custom HSL arbitrary values are used instead of Tailwind's named
 * shades because the named -600/-700 steps are too saturated to feel
 * muted. Each hue is mapped to the category it evokes:
 *   cleaning  → dusty teal     (fresh / sanitised)
 *   yard_work → muted green    (grass / outdoors)
 *   moving    → warm amber      (cardboard / boxes)
 *   errands   → soft olive-lime (quick / on-the-go)
 *   handyman  → clay sienna     (tools)
 *   painting  → magenta rose    (colour / creative — pushed off assembly's
 *                                brick-red so the two warm reds stay distinct)
 *   delivery  → slate blue      (transit / motion)
 *   pet_care  → muted mauve     (soft / friendly)
 *   assembly  → brick red       (precise / build)
 *   other     → warm stone      (neutral default)
 */
export const categoryColors: Record<string, { badge: string; title: string; dot: string }> = {
  cleaning:   { badge: "bg-[hsl(180_30%_94%)] text-[hsl(182_26%_33%)] border-[hsl(180_22%_80%)] dark:bg-[hsl(182_26%_17%)] dark:text-[hsl(180_30%_76%)] dark:border-[hsl(182_22%_30%)]",  title: "text-[hsl(182_26%_33%)] dark:text-[hsl(180_30%_76%)]", dot: "bg-[hsl(182_28%_44%)]" },
  yard_work:  { badge: "bg-[hsl(140_28%_94%)] text-[hsl(142_28%_31%)] border-[hsl(140_22%_78%)] dark:bg-[hsl(142_26%_16%)] dark:text-[hsl(140_32%_75%)] dark:border-[hsl(142_22%_29%)]",  title: "text-[hsl(142_28%_31%)] dark:text-[hsl(140_32%_75%)]", dot: "bg-[hsl(142_30%_40%)]" },
  moving:     { badge: "bg-[hsl(38_46%_93%)] text-[hsl(32_42%_37%)] border-[hsl(36_38%_78%)] dark:bg-[hsl(34_40%_17%)] dark:text-[hsl(38_46%_76%)] dark:border-[hsl(35_36%_31%)]",     title: "text-[hsl(32_42%_37%)] dark:text-[hsl(38_46%_76%)]",  dot: "bg-[hsl(34_44%_47%)]" },
  errands:    { badge: "bg-[hsl(75_32%_92%)] text-[hsl(74_32%_30%)] border-[hsl(74_26%_76%)] dark:bg-[hsl(74_28%_16%)] dark:text-[hsl(75_34%_74%)] dark:border-[hsl(74_24%_29%)]",     title: "text-[hsl(74_32%_30%)] dark:text-[hsl(75_34%_74%)]",  dot: "bg-[hsl(73_32%_40%)]" },
  handyman:   { badge: "bg-[hsl(22_50%_93%)] text-[hsl(18_44%_41%)] border-[hsl(20_42%_80%)] dark:bg-[hsl(18_42%_18%)] dark:text-[hsl(22_50%_77%)] dark:border-[hsl(20_38%_32%)]",     title: "text-[hsl(18_44%_41%)] dark:text-[hsl(22_50%_77%)]",  dot: "bg-[hsl(19_46%_49%)]" },
  painting:   { badge: "bg-[hsl(330_44%_94%)] text-[hsl(330_38%_47%)] border-[hsl(330_34%_84%)] dark:bg-[hsl(330_34%_19%)] dark:text-[hsl(330_44%_78%)] dark:border-[hsl(330_30%_33%)]",  title: "text-[hsl(330_38%_47%)] dark:text-[hsl(330_44%_78%)]", dot: "bg-[hsl(330_40%_56%)]" },
  delivery:   { badge: "bg-[hsl(214_34%_94%)] text-[hsl(214_28%_42%)] border-[hsl(214_26%_82%)] dark:bg-[hsl(214_30%_18%)] dark:text-[hsl(214_36%_78%)] dark:border-[hsl(214_26%_32%)]",  title: "text-[hsl(214_28%_42%)] dark:text-[hsl(214_36%_78%)]", dot: "bg-[hsl(214_30%_51%)]" },
  // pet_care light-mode text darkened 48% → 42% L: was 4.49:1 vs WCAG
  // AA 4.5 (a 0.01 fail), now clears with headroom (Cowork 2026-07-08).
  pet_care:   { badge: "bg-[hsl(278_26%_94%)] text-[hsl(278_24%_42%)] border-[hsl(278_22%_84%)] dark:bg-[hsl(278_24%_19%)] dark:text-[hsl(278_30%_79%)] dark:border-[hsl(278_22%_33%)]",  title: "text-[hsl(278_24%_42%)] dark:text-[hsl(278_30%_79%)]", dot: "bg-[hsl(278_24%_57%)]" },
  assembly:   { badge: "bg-[hsl(6_44%_94%)] text-[hsl(6_40%_46%)] border-[hsl(6_36%_84%)] dark:bg-[hsl(6_38%_19%)] dark:text-[hsl(6_46%_78%)] dark:border-[hsl(6_34%_33%)]",        title: "text-[hsl(6_40%_46%)] dark:text-[hsl(6_46%_78%)]",   dot: "bg-[hsl(6_42%_53%)]" },
  // storm_prep → steel blue (storm / weather — distinct from delivery's slate)
  storm_prep: { badge: "bg-[hsl(210_30%_92%)] text-[hsl(210_28%_38%)] border-[hsl(210_24%_78%)] dark:bg-[hsl(210_28%_18%)] dark:text-[hsl(210_32%_77%)] dark:border-[hsl(210_24%_32%)]", title: "text-[hsl(210_28%_38%)] dark:text-[hsl(210_32%_77%)]", dot: "bg-[hsl(210_30%_47%)]" },
  // events light-mode text darkened 36% → 32% L: was 4.46:1 vs WCAG AA
  // 4.5 (a 0.04 fail on the badge), now clears (Cowork 2026-07-08).
  events:     { badge: "bg-[hsl(45_48%_93%)] text-[hsl(42_44%_32%)] border-[hsl(44_40%_78%)] dark:bg-[hsl(42_40%_17%)] dark:text-[hsl(45_50%_76%)] dark:border-[hsl(44_36%_31%)]",     title: "text-[hsl(42_44%_32%)] dark:text-[hsl(45_50%_76%)]",  dot: "bg-[hsl(43_46%_46%)]" },
  // other light-mode text darkened 42% → 36% L: was 4.27:1 vs WCAG AA
  // 4.5 (a real fail), now 5.37:1 (Cowork 2026-07-08 followup sweep).
  other:      { badge: "bg-[hsl(40_14%_92%)] text-[hsl(40_9%_36%)] border-[hsl(40_12%_80%)] dark:bg-[hsl(40_10%_19%)] dark:text-[hsl(40_14%_75%)] dark:border-[hsl(40_10%_33%)]",      title: "text-[hsl(40_9%_36%)] dark:text-[hsl(40_14%_75%)]",   dot: "bg-[hsl(40_10%_55%)]" },
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

export const statusBadge: Record<string, string> = {
  open:               jobStatusColorClasses("open"),
  accepted:           jobStatusColorClasses("accepted"),
  in_progress:        jobStatusColorClasses("in_progress"),
  revision_requested: jobStatusColorClasses("revision_requested"),
  completed:          jobStatusColorClasses("completed"),
  cancelled:          jobStatusColorClasses("cancelled"),
  disputed:           jobStatusColorClasses("disputed"),
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
    /** Stripe's identity verdict — `profiles.stripe_identity_verified`, NOT
        the unreviewed `idv_status`. Half of the acceptance gate the server
        enforces (migration 20260827191647); shown on the applicant card so a
        poster can weigh it before deciding who to let into their home. */
    is_id_verified?: boolean | null;
    /** The other half: a Stripe payout account that can actually be paid. */
    is_payout_ready?: boolean | null;
  } | null;
  reviewCount?: number;
  avgRating?: number;
};

export type AppliedApp = Application & {
  job?: (Job & { revision_note?: string | null }) | null;
  posterName?: string;
};

/**
 * The status filter each Activity tab opens on.
 *
 * Single source of truth because it was previously written out twice —
 * Activity.tsx computed the initial `statusFilter`, and ActivityHeader
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
 * It can come up empty, and that is fine here in a way it was not before:
 * "nothing needs you" is good news, not a dead end. There is still deliberately
 * NO automatic fallback to another tab (owner decision) — a default that
 * silently moves is harder to reason about than one that holds still.
 * ActivityEmptyState covers the empty case by naming where the items went
 * ("Nothing needs you — but you have 4 Scheduled"), which is a pointer.
 *
 * See ActivityBucket in activityFilters.ts for what each of the four means and
 * why they are exhaustive.
 */
export function defaultStatusFilterFor(_tab: "posted" | "applied"): string {
  return "needs_you";
}
