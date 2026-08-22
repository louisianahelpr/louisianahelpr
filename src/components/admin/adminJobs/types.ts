import type { Database } from "@/integrations/supabase/types";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];

// Canonical labels — see `src/lib/jobCategories.ts`.
export const categoryLabels: Record<string, string> = JOB_CATEGORY_LABELS;

export const paymentColors: Record<string, string> = {
  unpaid: "bg-muted text-muted-foreground",
  escrow: "bg-primary/10 text-primary",
  released: "bg-secondary text-secondary-foreground",
  refunded: "bg-destructive/10 text-destructive",
};
