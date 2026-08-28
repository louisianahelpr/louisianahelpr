import type { Database } from "@/integrations/supabase/types";

export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export type Step = "entry" | "form" | "checkout";
