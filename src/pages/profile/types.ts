import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "posted_jobs" | "completed_jobs" | "warnings" | "credentials" | "saved_helpers" | "accessibility";

/**
 * Human name for each Profile tab, used to build a distinct `document.title`
 * per tab (`"Security — My Profile — Helpr"`). All 18 tabs used to share the
 * single title "My Profile — Helpr", which made every history entry and
 * bookmark indistinguishable from every other. Copy is kept identical to each
 * tab's own on-screen `<ProfileTabHeader title>` so the tab strip, the
 * heading, and the browser tab all say the same thing.
 *
 * `Record<Tab, string>` is deliberate: adding a Tab without a title is a
 * typecheck failure, not a silently untitled screen.
 */
export const TAB_TITLES: Record<Exclude<Tab, "landing">, string> = {
  profile: "Edit profile",
  earnings: "My earnings",
  schedule: "My schedule",
  availability: "Availability",
  payment: "Payment settings",
  security: "Security",
  legal: "Legal & policies",
  reviews: "My reviews",
  referral: "Referral program",
  subscription: "My membership",
  support: "Help & support",
  notifications: "Notifications",
  posted_jobs: "Posted jobs",
  completed_jobs: "Completed jobs",
  warnings: "Warnings & strikes",
  credentials: "Licensed & insured",
  saved_helpers: "Saved Helprs",
  accessibility: "Accessibility",
};
