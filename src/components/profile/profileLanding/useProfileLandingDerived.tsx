import {
  Shield, ShieldAlert, Bell, PawPrint, ClipboardList,
  CalendarDays, Heart, ShieldCheck, Home, Gift, Coins, UserPlus,
  TrendingUp, Crown, FileText, Gavel, HelpCircle,
  AlertTriangle, Type, Clock,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { MenuItem, Profile } from "./types";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

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
    // Backed by Stripe's verdict, NOT `idv_status`. `idv_status` is flipped by
    // the upload flow and by an admin manual-approve nobody actually performs,
    // so it asserted a human ID review that does not happen.
    // `stripe_identity_verified` is cached from the account.updated webhook and
    // is TRUE only when Stripe has no outstanding identity requirement — see
    // supabase/functions/_shared/stripeIdentity.ts.
    { ok: profile?.stripe_identity_verified === true, label: "ID verified by Stripe" },
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
      ? `${TIER_PERKS.elite.name} — top visibility`
      : tier === "pro"
        ? `${TIER_PERKS.pro.name} — upgrade to ${TIER_PERKS.elite.name}`
        : tier === "basic"
          ? `${TIER_PERKS.basic.name} — upgrade to ${TIER_PERKS.pro.name}`
          : "Free — tap to upgrade";

  // Completeness gaps surfaced per-row so the user knows *what's*
  // missing without having to open each tab. Derived from existing
  // profile state, no new column required. Each gap maps to the row
  // its action lives under so the user goes straight to the right
  // place. Phone verification uses the `phone_verified_at` column when
  // the prod schema supplies it; falls back to "has phone" otherwise.
  const phoneVerified = !!(profile as unknown as { phone_verified_at?: string | null })
    ?.phone_verified_at || !!profile?.phone?.trim();
  // Settings hub, grouped into four scannable editorial sections per the
  // S18 design card: Account · Work · Money · Legal. Pure information-
  // architecture grouping — every row keeps the exact tab `key` / `href`
  // it had before, so nothing is dropped or re-targeted. Surfaces that
  // don't map cleanly to a bucket are folded into their nearest one
  // (family/pets/home record → Account; insights/host/community
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
          // Not "job credits" (owner, 2026-08-30) — there is no credit balance
          // in this product. /gift-card sends a real Helpr gift card by email
          // that the recipient claims and puts toward any job.
          desc: "Send a Helpr gift card by email",
          tint: SECTION_TINT.work,
          href: "/gift-card",
        },
        // "Benefits & Perks" (/benefits) removed 2026-08-31 (owner): the page
        // it opened had no partner agreements behind it, so the row promised
        // "health coverage, financial tools & supply discounts" that Helpr
        // never actually offered. Page and route deleted; the row goes with
        // them rather than becoming a dead entry point.
      ],
    },
    {
      title: "Money",
      items: [
        {
          key: "auto-tip",
          // Matches the screen's own title verbatim (owner, 2026-08-31). The
          // row used to read "Auto-Tip & Instant Release" onto a page titled
          // "Auto-Tip", so the entry point named one more setting than the
          // screen it opened admitted to holding. Both are now "After a Job",
          // and the description carries the two things that happen there.
          label: "After a Job",
          icon: <Coins className="w-5 h-5" />,
          desc: "Automatic tips & instant payment release",
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
        // "Posted Jobs" (→ /my-posts) and "Completed Jobs"
        // (→ /my-posts?filter=done) were the last two rows here until
        // 2026-08-31, when the owner removed them: "Remove posted and
        // completed jobs from here."
        //
        // They were already only doorways. The standalone Posted/Completed
        // Profile *tabs* were deleted earlier (they duplicated My Posts,
        // which has richer status filtering), and these rows were rewired to
        // deep-link into My Posts — so Account offered two extra spellings of
        // the Posts tab that the bottom nav and the desktop rail both already
        // carry, one of them a pre-applied filter chip. Nothing is lost:
        // posting history lives in My Posts (`/my-posts`, Activity's "posted"
        // tab) and completion history in its "Done" bucket (`?filter=done` —
        // POSTED_STATUS_FILTERS / postedActivityBucket in activityFilters.ts).
        //
        // No route was orphaned by this: `/my-posts` is a primary nav
        // destination (MobileNav, DesktopSidebarNav) and the target of a dozen
        // notification deep links. `/profile?tab=posted_jobs` /
        // `?tab=completed_jobs` still resolve — `resolveTab` in
        // src/pages/profile/types.ts maps any unknown tab to `landing`, which
        // is the standing guard for stale bookmarks and must stay.
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
        { key: "legal", label: "Legal", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy, guidelines & data export", tint: SECTION_TINT.legal },
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
