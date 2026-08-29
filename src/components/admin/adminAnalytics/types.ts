import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type Tip = Database["public"]["Tables"]["tips"]["Row"];

export type DrillDown = "users" | "jobs" | "revenue" | "fees" | "subscriptions" | "categories" | "payouts" | null;

// Monthly subscription price per tier, in dollars. Single source of truth for
// both the headline MRR and the per-tier breakdown (kept in sync with the
// SubscriptionTab tier list — basic $5 / pro $10 / plus $15 / elite $20).
export const SUB_PRICE = { basic: 5, pro: 10, elite: 20 } as const;
