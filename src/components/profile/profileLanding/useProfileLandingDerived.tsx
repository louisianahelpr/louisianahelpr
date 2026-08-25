import {
  Shield, ShieldAlert, Bell, Users, PawPrint, ClipboardList,
  CalendarDays, Heart, ShieldCheck, Home, Star, Gift, Coins, UserPlus,
  TrendingUp, Crown, FileText, Gavel, HelpCircle,
  AlertTriangle, Type, Clock,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { MenuItem, Profile } from "./types";
import { FAMILY_ENABLED } from "@/config/familyEnabled";

interface UseProfileLandingDerivedArgs {
  profile: Profile | null;
  avatarBroken: boolean;
}

/**
 * ONE TINT PER SECTION.
 *
 * These were assigned ad hoc: 21 rows across 6 tints with no rule, so Schedule
 * was sienna while Availability directly beneath it was sage, and Gift Card
 * carried a raw `155 50% 30%` literal instead of a brand token — which the
 * project's own guidance forbids. The owner spotted it: "Why are some the same
 * colors and some do not match???" There was no answer, because there was no
 * rule.
 *
 * Now the tint carries information: it tells you which group a row belongs to.
 * Warnings & Strikes stays destructive-red — the one deliberate
 * exception, because "this is a penalty surface" outranks "this is the Legal
 * group".
 */
const SECTION_TINT = {
  /** Account + household. Cool blue-grey — the "about you" group. */
  account: "var(--stormy-sky)",
  /** Work + credentials. Warm sienna. */
  work: "var(--burnt-sienna)",
  /** Money. Green, the colour money already reads as. */
  money: "var(--sage)",
  /** Legal, support, admin. Quiet grey-blue — REVERSED 2026-08-24 (owner):
   *  the whole group in red made Help & Support read like an emergency and
   *  spent the alarm colour on rows that carry none. Red now belongs to
   *  Warnings & Strikes alone. */
  legal: "var(--stormy-sky)",
  /** Warnings & Strikes only — the one genuinely consequential row. */
  danger: "var(--destructive)",
} as const;

export function useProfileLandingDerived({
  profile,
  avatarBroken,
}: UseProfileLandingDerivedArgs) {
  const { isAdmin } = useCurrentUser();
  // The admin-panel shortcut used to be a Shield icon button in the Dashboard
  // app bar. Home no longer has an app bar, and /admin is an account-level

  // Derived state — drives "Action needed" dots on menu items so the
  // user sees blockers at a glance without having to navigate into each
  // tab to discover them.
  const tier = (profile?.subscription_tier ?? "free") as string;
  const hasPhoto = !!profile?.avatar_url && !avatarBroken;

  // Tenure label — "New member" for accounts under 30 days old (so a
  // brand-new account doesn't read the slightly-odd "Since May 2026"),
  // switching to "Since <Month Year>" once there's real history.
  const memberSinceLabel = (() => {
    if (!profile?.created_at) return null;
    const created = new Date(profile.created_at);
    const ageDays = (Date.now() - created.getTime()) / 86_400_000;
    if (ageDays < 30) return "New member";
    return `Since ${created.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
  })();

  // Earned trust badges only — showing empty "you don't have this"
  // pills on a fresh profile reads as a deficiency list. The
  // unverified items are still nudged via the completion meter +
  // Credentials tab.
  const earnedBadges = ([
    { ok: profile?.idv_status === "verified", label: "ID verified" },
    { ok: profile?.license_status === "verified", label: "Licensed" },
    { ok: profile?.insurance_status === "verified", label: "Insured" },
  ]).filter((b) => b.ok);
  // No payout badge is derived here on purpose: <PayoutStatusRow /> (fed
  // by useStripeConnectStatus in SettingsSection) is the single voice for
  // payout state — a second derivation here would be two answers to one
  // question, and on a failed status check it would be a guess dressed as
  // a fact.
  const subscriptionDesc =
    tier === "elite"
      ? "Elite — top visibility"
      : tier === "pro"
        ? "Pro — upgrade to Elite"
        : tier === "basic"
          ? "Basic — upgrade to Pro"
          : "Free — tap to upgrade";

  // Completeness gaps surfaced per-row so the user knows *what's*
  // missing without having to open each tab. Derived from existing
  // profile state, no new column required. Each gap maps to the row
  // its action lives under so the user goes straight to the right
  // place. Phone verification uses the `phone_verified_at` column when
  // the prod schema supplies it; falls back to "has phone" otherwise.
  const phoneVerified = !!(profile as unknown as { phone_verified_at?: string | null })
    ?.phone_verified_at || !!profile?.phone?.trim();
  const credentialsIncomplete =
    profile?.license_status !== "verified" &&
    profile?.insurance_status !== "verified";

  // Settings hub, grouped into four scannable editorial sections per the
  // S18 design card: Account · Work · Money · Legal. Pure information-
  // architecture grouping — every row keeps the exact tab `key` / `href`
  // it had before, so nothing is dropped or re-targeted. Surfaces that
  // don't map cleanly to a bucket are folded into their nearest one
  // (family/pets/home record → Account; insights/host/community/benefits
  // → Work; credits/referrals/earnings docs → Money; warnings/support →
  // Legal).
  const menuGroups: { title: string; items: MenuItem[] }[] = [
    // The ADMIN row is BACK (owner, 2026-08-24) — but only for admin
    // accounts, in the Legal/consequences group at the bottom. It left in
    // an earlier pass ("move to side panel"), which was right for the
    // desktop website but silently made /admin unreachable from the
    // phone/app surface, where there is no side panel. The row and the
    // sidebar can coexist: one is the desktop shortcut, this is the way in
    // everywhere else. SECTION_TINT.danger was even kept around for it.
    {
      title: "Work",
      items: [
        // Two rows, not one. These used to be a single "Schedule" row opening
        // a screen with a Calendar|Hours segmented control — a second choice
        // after the one you just made. Split on owner request 2026-08-19.
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Your calendar & upcoming jobs", tint: SECTION_TINT.work },
        { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Weekly hours & the available-now signal", tint: SECTION_TINT.work },
        { key: "saved_helpers", label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer", tint: SECTION_TINT.work },
        {
          key: "credentials",
          label: "Licensed & Insured",
          icon: <ShieldCheck className="w-5 h-5" />,
          desc: "Add your license and insurance",
          tint: SECTION_TINT.work,
          // Quiet nudge when neither credential is verified yet — same
          // pill treatment as the Security row's "Verify phone".
          incompleteLabel: credentialsIncomplete ? "Add credentials" : undefined,
        },
        {
          key: "str-settings",
          label: "Host Automation",
          icon: <Home className="w-5 h-5" />,
          desc: "Auto-post cleanings on Airbnb / VRBO checkout",
          tint: SECTION_TINT.work,
          href: "/str-settings",
        },
        {
          key: "gift-card",
          label: "Gift Card",
          icon: <Gift className="w-5 h-5" />,
          desc: "Donate job credits for neighbors who need help",
          tint: SECTION_TINT.work,
          href: "/gift-card",
        },
        {
          key: "benefits",
          label: "Benefits & Perks",
          icon: <Star className="w-5 h-5" />,
          desc: "Health coverage, financial tools & supply discounts",
          tint: SECTION_TINT.work,
          href: "/benefits",
        },
      ],
    },
    {
      title: "Money",
      items: [
        {
          key: "auto-tip",
          label: "Auto-Tip & Instant Release",
          icon: <Coins className="w-5 h-5" />,
          desc: "Tips & instant payment release",
          tint: SECTION_TINT.money,
          href: "/auto-tip",
        },
        // ONE row, not three. "Earnings", "Analytics" (→ /analytics) and
        // "Payout & Payments" were three entry points onto three screens
        // about the same subject: what you earned, what it says about your
        // work, and where the money lands. Merged 2026-08-19 on owner
        // request — the earnings tab now carries the analytics dashboard and
        // the payout setup as sections. The payout warning state moves onto
        // this row with them, because it is still the row you tap to fix it.
        {
          key: "earnings",
          label: "Earnings & Payouts",
          icon: <TrendingUp className="w-5 h-5" />,
          desc: "Wallet, analytics, payout setup & tax exports",
          tint: SECTION_TINT.money,
        },
        // No `href`. This row used to jump out to /subscription — the public
        // MARKETING pricing page, with its own hand-rolled header whose back
        // button goes to "/" rather than to Profile. Tapping "Membership" in
        // your own settings and landing on the sales page (in a different
        // header, column and card treatment from every neighbouring row) is
        // exactly the "not the correct look" the owner flagged. The in-profile
        // `subscription` tab (SubscriptionTab) is the settings-native screen —
        // ProfileTabHeader, canonical cards, plan management, cancel/pause —
        // so the row opens that. /subscription stays reachable from the public
        // nav and footer, which is the audience it was written for.
        { key: "subscription", label: "Membership", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc, tint: SECTION_TINT.money },
        { key: "referral", label: "Referrals", icon: <UserPlus className="w-5 h-5" />, desc: "Invite friends & earn credits", tint: SECTION_TINT.money },
        {
          key: "work-record",
          label: "Work Record",
          icon: <FileText className="w-5 h-5" />,
          desc: "Shareable verified earnings document",
          tint: SECTION_TINT.money,
          href: "/work-record",
        },
      ],
    },
    {
      title: "Account",
      items: [
        {
          key: "security",
          label: "Account Security",
          icon: <Shield className="w-5 h-5" />,
          desc: "Email, password & login",
          tint: SECTION_TINT.account,
          incompleteLabel: !phoneVerified ? "Verify phone" : undefined,
        },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get", tint: SECTION_TINT.account },
        {
          key: "accessibility",
          label: "Accessibility",
          icon: <Type className="w-5 h-5" />,
          // Names exactly what the Accessibility panel renders and nothing
          // more. It used to promise "…& display options" as if there were a
          // third section behind the row; AccessibilityTab has two controls —
          // the Light/Auto/Dark colour-mode group and the Senior mode switch —
          // so the trailing clause sent people looking for a screen that does
          // not exist.
          desc: "Color mode & Senior mode",
          tint: SECTION_TINT.account,
        },
        /* Family & Care is behind FAMILY_ENABLED (off 2026-08-23, owner: "it
           seems pointless — you literally just post the job on their behalf").
           Spread rather than a ternary so the row leaves no empty slot in the
           list when the flag is false. */
        ...(FAMILY_ENABLED
          ? [
              {
                key: "family",
                label: "Family & Care",
                icon: <Users className="w-5 h-5" />,
                desc: "Manage jobs for a family member",
                tint: SECTION_TINT.account,
                href: "/family",
              },
            ]
          : []),
        {
          key: "pets",
          label: "My Pets",
          icon: <PawPrint className="w-5 h-5" />,
          desc: "Pet profiles & vet notes",
          tint: SECTION_TINT.account,
          href: "/pets",
        },
        {
          key: "home-history",
          label: "Home History",
          icon: <ClipboardList className="w-5 h-5" />,
          desc: "Your home's permanent maintenance record",
          tint: SECTION_TINT.account,
          href: "/home-history",
        },
        // The posted/completed job tabs exist (TAB_TITLES, ProfileTabPanels)
        // but had NO menu entry — reachable only by hand-typing ?tab=. Two
        // plain rows make them navigable again.
        {
          key: "posted_jobs",
          label: "Posted Jobs",
          icon: <FileText className="w-5 h-5" />,
          desc: "Tasks you've posted",
          tint: SECTION_TINT.account,
        },
        {
          key: "completed_jobs",
          label: "Completed Jobs",
          icon: <ClipboardList className="w-5 h-5" />,
          desc: "Work you've finished or had done",
          tint: SECTION_TINT.account,
        },
      ],
    },
    {
      title: "Legal",
      items: [
        // "Data & privacy → /data-rights" was a second row here until
        // 2026-08-18. That page is now merged into this very tab, so the row
        // would have pointed at a redirect back to its neighbour — two menu
        // entries, one destination. The export it led to is called out in the
        // description below so the scent survives the merge.
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy, guidelines & data export", tint: SECTION_TINT.legal },
        { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history", tint: SECTION_TINT.danger },
        { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us", tint: SECTION_TINT.legal },
        ...(isAdmin
          ? [
              {
                key: "admin",
                label: "Admin",
                icon: <ShieldAlert className="w-5 h-5" />,
                desc: "Moderation, payouts & platform health",
                tint: SECTION_TINT.legal,
                href: "/admin",
              },
            ]
          : []),
      ],
    },
  ];

  // "Profile" row in the header (Edit) doesn't get a pill — its own
  // edit affordance is right there, and the avatar Camera dot plus the
  // "+ Add a short bio" CTA already cover the photo/bio nudges inline.

  return {
    tier,
    hasPhoto,
    memberSinceLabel,
    earnedBadges,
    menuGroups,
  };
}
