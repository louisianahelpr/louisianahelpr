import type { Database } from "@/integrations/supabase/types";
import { CATEGORY_ICONS } from "@/lib/categoryIcons";

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

export const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

export const categories = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));

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
  cleaning:  { badge: "bg-[hsl(180_30%_94%)] text-[hsl(182_26%_33%)] border-[hsl(180_22%_80%)]",  title: "text-[hsl(182_26%_33%)]", dot: "bg-[hsl(182_28%_44%)]" },
  yard_work: { badge: "bg-[hsl(140_28%_94%)] text-[hsl(142_28%_31%)] border-[hsl(140_22%_78%)]",  title: "text-[hsl(142_28%_31%)]", dot: "bg-[hsl(142_30%_40%)]" },
  moving:    { badge: "bg-[hsl(38_46%_93%)] text-[hsl(32_42%_37%)] border-[hsl(36_38%_78%)]",     title: "text-[hsl(32_42%_37%)]",  dot: "bg-[hsl(34_44%_47%)]" },
  errands:   { badge: "bg-[hsl(75_32%_92%)] text-[hsl(74_32%_30%)] border-[hsl(74_26%_76%)]",     title: "text-[hsl(74_32%_30%)]",  dot: "bg-[hsl(73_32%_40%)]" },
  handyman:  { badge: "bg-[hsl(22_50%_93%)] text-[hsl(18_44%_41%)] border-[hsl(20_42%_80%)]",     title: "text-[hsl(18_44%_41%)]",  dot: "bg-[hsl(19_46%_49%)]" },
  painting:  { badge: "bg-[hsl(330_44%_94%)] text-[hsl(330_38%_47%)] border-[hsl(330_34%_84%)]",  title: "text-[hsl(330_38%_47%)]", dot: "bg-[hsl(330_40%_56%)]" },
  delivery:  { badge: "bg-[hsl(214_34%_94%)] text-[hsl(214_28%_42%)] border-[hsl(214_26%_82%)]",  title: "text-[hsl(214_28%_42%)]", dot: "bg-[hsl(214_30%_51%)]" },
  pet_care:  { badge: "bg-[hsl(278_26%_94%)] text-[hsl(278_22%_48%)] border-[hsl(278_22%_84%)]",  title: "text-[hsl(278_22%_48%)]", dot: "bg-[hsl(278_24%_57%)]" },
  assembly:  { badge: "bg-[hsl(6_44%_94%)] text-[hsl(6_40%_46%)] border-[hsl(6_36%_84%)]",        title: "text-[hsl(6_40%_46%)]",   dot: "bg-[hsl(6_42%_53%)]" },
  other:     { badge: "bg-[hsl(40_14%_92%)] text-[hsl(40_9%_42%)] border-[hsl(40_12%_80%)]",      title: "text-[hsl(40_9%_42%)]",   dot: "bg-[hsl(40_10%_55%)]" },
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
    hourly_rate: number | null;
    user_id: string;
    avatar_url?: string | null;
    /** Active subscription tier — drives the gold halo on Pro/Elite
        applicants so posters spot subscribed helpers at a glance. */
    subscription_tier?: string | null;
  } | null;
  reviewCount?: number;
  avgRating?: number;
};

export type AppliedApp = Application & {
  job?: (Job & { revision_note?: string | null }) | null;
  posterName?: string;
};
