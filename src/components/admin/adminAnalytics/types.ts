import type { Database } from "@/integrations/supabase/types";
import type { ReadableJobRow } from "@/lib/jobColumns";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

// Named columns, never `*`, and read in pages: PostgREST caps a response at
// 1000 rows, so an unbounded `profiles` read silently stops counting users at
// the thousandth. adminUsersProfilesPaging.test.ts fails CI on the shape.
// ANALYTICS_PROFILE_COLUMNS is exactly what computeMetrics reads.
export const ANALYTICS_PROFILE_COLUMNS = "user_id, created_at, email_verified, stripe_account_id, subscription_tier" as const;
export type Profile = Pick<ProfileRow, "user_id" | "created_at" | "email_verified" | "stripe_account_id" | "subscription_tier">;
// What the Users and Subscriptions drill-downs render.
export const DRILL_PROFILE_COLUMNS = "id, user_id, full_name, email, location, subscription_tier, email_verified, created_at" as const;
export type DrillProfile = Pick<ProfileRow, "id" | "user_id" | "full_name" | "email" | "location" | "subscription_tier" | "email_verified" | "created_at">;
// The row as an admin client can read it: jobs.offered_to_helper_id is not
// selectable by `authenticated` (20260915045110), admins included.
export type Job = ReadableJobRow;
export type Tip = Database["public"]["Tables"]["tips"]["Row"];

export type DrillDown = "users" | "jobs" | "revenue" | "fees" | "subscriptions" | "categories" | "payouts" | null;

// Monthly subscription price per tier, in dollars. Single source of truth for
// both the headline MRR and the per-tier breakdown (kept in sync with the
// SubscriptionTab tier list — basic $5 / pro $10 / elite $20).
// Plus added 2026-09-05. A tier missing here is not a cosmetic gap: every Plus
// subscriber would count as $0 of MRR, so the revenue chart under-reports by
// exactly the tier the owner just launched.
export const SUB_PRICE = { basic: 5, pro: 10, plus: 15, elite: 20 } as const;
