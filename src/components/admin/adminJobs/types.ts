import type { Database } from "@/integrations/supabase/types";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];

export const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

export const paymentColors: Record<string, string> = {
  unpaid: "bg-muted text-muted-foreground",
  escrow: "bg-primary/10 text-primary",
  released: "bg-secondary text-secondary-foreground",
  refunded: "bg-destructive/10 text-destructive",
};
