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
 * Category palette — warm-brand only. All entries are tints or lightness
 * variations of the four brand hues: sage (stone), bark (deep olive),
 * burnt-sienna (orange), and gold-warm (amber). No fuchsia, cyan, teal,
 * sky, pink, or rose — those break the earthy system.
 *
 * Mapping rationale (brand hue → Tailwind analog):
 *   sage        → stone  (muted warm neutral, olive-green adjacent)
 *   bark        → stone-7xx (deeper grounded olive)
 *   burnt-sienna → orange (warm earthy red-orange)
 *   gold-warm   → amber  (antique gold)
 *
 *   cleaning    → stone light      (fresh, neutral)
 *   yard_work   → stone deep       (earthy, grounded)
 *   moving      → amber medium     (warm gold energy)
 *   errands     → amber light      (bright warm movement)
 *   handyman    → orange medium    (sienna tools)
 *   painting    → orange light     (warm creative)
 *   delivery    → amber deep       (rich transit gold)
 *   pet_care    → stone medium     (soft, warm neutral)
 *   assembly    → orange deep      (precise, structured)
 *   other       → stone muted      (neutral default)
 */
export const categoryColors: Record<string, { badge: string; title: string; dot: string }> = {
  cleaning:  { badge: "bg-stone-50 text-stone-600 border-stone-200/60",  title: "text-stone-600",  dot: "bg-stone-500/65" },
  yard_work: { badge: "bg-stone-100 text-stone-700 border-stone-300/60", title: "text-stone-700",  dot: "bg-stone-700/65" },
  moving:    { badge: "bg-amber-50 text-amber-700 border-amber-200/60",  title: "text-amber-700",  dot: "bg-amber-700/65" },
  errands:   { badge: "bg-amber-100 text-amber-600 border-amber-300/60", title: "text-amber-600",  dot: "bg-amber-600/65" },
  handyman:  { badge: "bg-orange-50 text-orange-700 border-orange-200/60", title: "text-orange-700", dot: "bg-orange-700/65" },
  painting:  { badge: "bg-orange-100 text-orange-600 border-orange-300/60", title: "text-orange-600", dot: "bg-orange-600/65" },
  delivery:  { badge: "bg-amber-50 text-amber-800 border-amber-200/60",  title: "text-amber-800",  dot: "bg-amber-800/65" },
  pet_care:  { badge: "bg-stone-50 text-stone-500 border-stone-200/60",  title: "text-stone-500",  dot: "bg-stone-400/65" },
  assembly:  { badge: "bg-orange-50 text-orange-800 border-orange-200/60", title: "text-orange-800", dot: "bg-orange-800/65" },
  other:     { badge: "bg-stone-100 text-stone-500 border-stone-200/60", title: "text-stone-500",  dot: "bg-stone-400/55" },
};

/**
 * Status badge classes — mapped onto semantic design tokens so every
 * status pill inherits the brand palette automatically if the CSS vars
 * change. Do not use raw Tailwind color literals here; use the tokens
 * defined in index.css `:root` (--success, --warning, --error, --info).
 *
 *   open               → info     (available, neutral-positive)
 *   accepted           → warning  (in motion, needs attention)
 *   in_progress        → warning  (active work)
 *   revision_requested → warning  (needs action — distinct label handles it)
 *   completed          → success  (done, affirming)
 *   cancelled          → error    (terminal negative)
 *   disputed           → error    (elevated negative)
 */
export const statusBadge: Record<string, string> = {
  open:               "bg-info/15 text-info",
  accepted:           "bg-warning/15 text-warning",
  in_progress:        "bg-warning/15 text-warning",
  revision_requested: "bg-warning/20 text-warning",
  completed:          "bg-success/15 text-success",
  cancelled:          "bg-error/10 text-error",
  disputed:           "bg-error/15 text-error",
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
