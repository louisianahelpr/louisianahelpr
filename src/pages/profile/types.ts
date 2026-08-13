import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "posted_jobs" | "completed_jobs" | "warnings" | "credentials" | "saved_helpers" | "accessibility";
