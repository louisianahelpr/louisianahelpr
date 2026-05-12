import type { Database } from "@/integrations/supabase/types";
import {
  Sparkles, Leaf, Truck, ShoppingBag, Wrench, Paintbrush,
  Package, PawPrint, Hammer, MoreHorizontal, type LucideIcon,
} from "lucide-react";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type Application = Database["public"]["Tables"]["applications"]["Row"];

export type Tab = "posted" | "applied";

export const categoryIcons: Record<string, LucideIcon> = {
  cleaning: Sparkles, yard_work: Leaf, moving: Truck, errands: ShoppingBag,
  handyman: Wrench, painting: Paintbrush, delivery: Package, pet_care: PawPrint,
  assembly: Hammer, other: MoreHorizontal,
};

export const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

export const categories = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));

/**
 * Category palette — muted, editorial. Warm-brand only (no purple, violet,
 * or indigo per repo-wide brand cleanup). Each category gets a distinct
 * -50/-700 pair so chips read at a glance.
 *
 * Mapping rationale:
 *   cleaning   → sky      (clean, cool)
 *   yard_work  → emerald  (outdoors, green)
 *   moving     → fuchsia  (warm magenta, distinct from errands' amber)
 *   errands    → amber    (gold, energetic)
 *   handyman   → orange   (tools, warm)
 *   painting   → pink     (creative, soft)
 *   delivery   → cyan     (transport, cool blue-green — replaces indigo)
 *   pet_care   → rose     (warmth, affection)
 *   assembly   → teal     (precision, calm)
 *   other      → slate    (neutral default)
 */
export const categoryColors: Record<string, { badge: string; title: string; dot: string }> = {
  cleaning: { badge: "bg-sky-50 text-sky-700 border-sky-200/60", title: "text-sky-700", dot: "bg-sky-700/65" },
  yard_work: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200/60", title: "text-emerald-700", dot: "bg-emerald-700/65" },
  moving: { badge: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200/60", title: "text-fuchsia-700", dot: "bg-fuchsia-700/65" },
  errands: { badge: "bg-amber-50 text-amber-700 border-amber-200/60", title: "text-amber-700", dot: "bg-amber-700/65" },
  handyman: { badge: "bg-orange-50 text-orange-700 border-orange-200/60", title: "text-orange-700", dot: "bg-orange-700/65" },
  painting: { badge: "bg-pink-50 text-pink-700 border-pink-200/60", title: "text-pink-700", dot: "bg-pink-700/65" },
  delivery: { badge: "bg-cyan-50 text-cyan-700 border-cyan-200/60", title: "text-cyan-700", dot: "bg-cyan-700/65" },
  pet_care: { badge: "bg-rose-50 text-rose-700 border-rose-200/60", title: "text-rose-700", dot: "bg-rose-700/65" },
  assembly: { badge: "bg-teal-50 text-teal-700 border-teal-200/60", title: "text-teal-700", dot: "bg-teal-700/65" },
  other: { badge: "bg-slate-50 text-slate-700 border-slate-200/60", title: "text-slate-700", dot: "bg-slate-600/65" },
};

export const statusBadge: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-amber-500/15 text-amber-600",
  in_progress: "bg-amber-500/15 text-amber-600",
  revision_requested: "bg-orange-500/15 text-orange-600",
  completed: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-destructive/10 text-destructive",
  disputed: "bg-red-500/15 text-red-600",
};

export type EnrichedApplication = Application & {
  profiles?: { full_name: string | null; skills: string | null; hourly_rate: number | null; user_id: string } | null;
  reviewCount?: number;
  avgRating?: number;
};

export type AppliedApp = Application & {
  job?: (Job & { revision_note?: string | null }) | null;
  posterName?: string;
};
