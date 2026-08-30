import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "warnings" | "credentials" | "saved_helpers" | "accessibility";

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
// Each value matches the h1 its screen actually paints (ProfileTabHeader
// title) — screen title and browser tab must agree, and titles are Title
// Case per PLATFORM_CONVENTIONS. Measured against the rendered h1s
// 2026-08-24; if a tab's heading changes, change it here in the same commit.
export const TAB_TITLES: Record<Exclude<Tab, "landing">, string> = {
  profile: "Edit Profile",
  earnings: "Earnings & Payouts",
  schedule: "Schedule",
  availability: "Availability",
  // `payment` no longer has a Profile row of its own — it renders the merged
  // earnings tab (see ProfileTabPanels) so old deep links still resolve, and
  // therefore carries that screen's title rather than one of its own.
  payment: "Earnings & Payouts",
  security: "Account Security",
  legal: "Legal & Policies",
  reviews: "My Reviews",
  referral: "Referrals",
  subscription: "Membership",
  support: "Help & Support",
  notifications: "Notifications",
  warnings: "Warnings & Strikes",
  credentials: "Licensed & Insured",
  saved_helpers: "Saved Helprs",
  accessibility: "Accessibility",
};
