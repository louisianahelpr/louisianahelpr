import type { Database } from "@/integrations/supabase/types";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type Application = Database["public"]["Tables"]["applications"]["Row"];

export type Tab = "posted" | "applied";

export const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

export const categories = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));

export const categoryColors: Record<string, { badge: string; title: string }> = {
  cleaning: { badge: "bg-sky-50 text-sky-700 border-sky-200/60", title: "text-sky-700" },
  yard_work: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200/60", title: "text-emerald-700" },
  moving: { badge: "bg-violet-50 text-violet-700 border-violet-200/60", title: "text-violet-700" },
  errands: { badge: "bg-amber-50 text-amber-700 border-amber-200/60", title: "text-amber-700" },
  handyman: { badge: "bg-orange-50 text-orange-700 border-orange-200/60", title: "text-orange-700" },
  painting: { badge: "bg-pink-50 text-pink-700 border-pink-200/60", title: "text-pink-700" },
  delivery: { badge: "bg-indigo-50 text-indigo-700 border-indigo-200/60", title: "text-indigo-700" },
  pet_care: { badge: "bg-rose-50 text-rose-700 border-rose-200/60", title: "text-rose-700" },
  assembly: { badge: "bg-teal-50 text-teal-700 border-teal-200/60", title: "text-teal-700" },
  other: { badge: "bg-slate-50 text-slate-700 border-slate-200/60", title: "text-slate-700" },
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
