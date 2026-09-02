import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "warnings" | "credentials" | "saved_helpers" | "accessibility" | "pets" | "work_record" | "home_history" | "str_settings" | "auto_tip" | "wrapped" | "analytics";

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
  legal: "Legal",
  reviews: "My Reviews",
  referral: "Referrals",
  subscription: "Membership",
  support: "Help & Support",
  notifications: "Notifications",
  warnings: "Warnings & Strikes",
  credentials: "Licensed & Insured",
  saved_helpers: "Saved Helprs",
  accessibility: "Accessibility",
  // Was the standalone route /pets until 2026-09-02.
  pets: "My Pets",
  // Six more standalone routes folded in 2026-09-02 — each was reached only
  // from Profile, so each was a tab already (owner: "anything in profile tab
  // should not be a stand alone tab").
  work_record: "Work Record",
  home_history: "Home History",
  str_settings: "Host Automation",
  auto_tip: "After a Job",
  wrapped: "Helpr Wrapped",
  analytics: "Analytics",
};

/**
 * Runtime guard for the `?tab=` query param.
 *
 * `searchParams.get("tab") as Tab` is a lie the compiler cannot catch: any
 * string satisfies the cast, no panel matches it, and the page renders the nav
 * chrome with an EMPTY content area — no heading, no error, no fallback.
 * `/profile?tab=posted_jobs` and `/profile?tab=completed_jobs` (both real tabs
 * once, both still referenced by e2e/happy-path/auditRoutes.ts) did exactly
 * that, and so did any typo'd or stale bookmark.
 *
 * The valid set is DERIVED from TAB_TITLES so a new tab cannot be added
 * without also becoming resolvable here.
 */
const VALID_TABS = new Set<string>([...Object.keys(TAB_TITLES), "landing"]);

export function resolveTab(raw: string | null | undefined): Tab {
  return raw && VALID_TABS.has(raw) ? (raw as Tab) : "landing";
}
