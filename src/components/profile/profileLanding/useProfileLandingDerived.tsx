import { ID_VERIFIED_LABEL } from "@/components/profile/IdVerifiedPill";
import {
  ShieldAlert, UserPlus, TrendingUp, Crown, Gavel, HelpCircle,
  AlertTriangle, Bug, Gift,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMembershipsOn, MEMBERSHIPS_HIDDEN_IN_THIS_APP } from "@/hooks/useMembershipsOn";
import type { MenuItem, Profile } from "./types";
import { ACCOUNT_MENU_GROUP, SECTION_TINT } from "./workMenuGroup";
import { REPORT_BUG_TITLE, TAB_TITLES } from "@/pages/profile/types";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { hasIdBadge } from "@/lib/awardGate";

interface UseProfileLandingDerivedArgs {
  profile: Profile | null;
}


export function useProfileLandingDerived({
  profile,
}: UseProfileLandingDerivedArgs) {
  const { isAdmin } = useCurrentUser();
  // Roadmap F4: memberships are off. The Membership row shows only while the
  // hidden "memberships" switch is on for this viewer, or for a member who
  // still holds a plan (so they can still see and manage it).
  const membershipsOn = useMembershipsOn();
  // The admin-panel shortcut used to be a Shield icon button in the Dashboard
  // app bar. Home no longer has an app bar, and /admin is an account-level

  // Derived state — drives "Action needed" dots on menu items so the
  // user sees blockers at a glance without having to navigate into each
  // tab to discover them.
  const tier = (profile?.subscription_tier ?? "free") as string;
  // Just "is the column non-null". It used to also AND in `!avatarBroken`,
  // a page-level flag that only an `<img onError>` handler could ever set —
  // and those came out when every avatar moved onto `<UserAvatar>`, whose
  // guards catch the failures `onError` never could (a 200 that decodes to a
  // flat block). Nothing set the flag after that, so the term was constant
  // `true` and the whole state pair was dead weight threaded through five
  // files. Whether a photo can actually be RENDERED is `<UserAvatar>`'s
  // verdict, reported via `onPhotoRejected` — see `IdentityHeader`.
  const hasPhoto = !!profile?.avatar_url;

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
    // Stripe Identity only (owner 2026-10-21), the same bit the public badge
    // reads (get_safe_profiles.is_id_verified). Payout setup is its own badge.
    {
      ok: hasIdBadge(profile?.idv_status),
      // The one form's wording (IdVerifiedPill.tsx, Q987); `id` makes the
      // header draw it as the gold pill rather than a generic chip.
      label: ID_VERIFIED_LABEL,
      id: true,
    },
    { ok: profile?.license_status === "verified", label: "Licensed" },
    { ok: profile?.insurance_status === "verified", label: "Insured" },
  ]).filter((b) => b.ok);
  // No payout badge is derived here on purpose: <PayoutStatusRow /> (fed
  // by useStripeConnectStatus in SettingsSection) is the single voice for
  // payout state — a second derivation here would be two answers to one
  // question, and on a failed status check it would be a guess dressed as
  // a fact.
  // Every paid rung names the NEXT rung, not a favourite one. This used to
  // skip Plus entirely, so a Plus member read "Free — tap to upgrade" on the
  // row describing the $15/mo plan they were paying for.
  const subscriptionDesc =
    tier === "elite"
      ? `${TIER_PERKS.elite.name} — top visibility`
      : tier === "plus"
        ? `${TIER_PERKS.plus.name} — upgrade to ${TIER_PERKS.elite.name}`
        : tier === "pro"
          ? `${TIER_PERKS.pro.name} — upgrade to ${TIER_PERKS.plus.name}`
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
  // Profile = Account / Money / Help (owner, 2026-10-19). Jobs rows live in the
  // Jobs section's settings (jobsSettingsGroups.tsx), not here.
  const menuGroups: { title: string; items: MenuItem[] }[] = [
    {
      ...ACCOUNT_MENU_GROUP,
      items: ACCOUNT_MENU_GROUP.items.map((item) =>
        item.key === "security" && !phoneVerified ? { ...item, incompleteLabel: "Verify phone" } : item,
      ),
    },
    {
      title: "Money",
      items: [
        {
          key: "earnings",
          label: "Money",
          icon: <TrendingUp className="w-5 h-5" />,
          desc: "Wallet, analytics, payout setup & tax exports",
          tint: SECTION_TINT.money,
        },
        // A plan holder still sees the row on the web to manage it; the store app
        // never shows memberships (useMembershipsOn).
        ...((membershipsOn || (tier !== "free" && !MEMBERSHIPS_HIDDEN_IN_THIS_APP))
          ? [{ key: "subscription", label: "Membership", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc, tint: SECTION_TINT.money }]
          : []),
        { key: "referral", label: "Referrals", icon: <UserPlus className="w-5 h-5" />, desc: "Invite friends & earn credits", tint: SECTION_TINT.money },
        {
          key: "gift-card",
          label: "Gift card",
          icon: <Gift className="w-5 h-5" />,
          desc: "Send a Helpr gift card by email",
          tint: SECTION_TINT.money,
          href: "/profile?tab=gift_card",
        },
      ],
    },
    {
      title: "Help",
      items: [
        { key: "support", label: TAB_TITLES.support, icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us", tint: SECTION_TINT.legal },
        { key: "report_bug", label: REPORT_BUG_TITLE, icon: <Bug className="w-5 h-5" />, desc: "Something not working? We attach the details", tint: SECTION_TINT.legal, href: "/profile?tab=support&topic=report" },
        { key: "legal", label: TAB_TITLES.legal, icon: <Gavel className="w-5 h-5" />, desc: "Terms, rules & privacy", tint: SECTION_TINT.legal },
        { key: "warnings", label: TAB_TITLES.warnings, icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history", tint: SECTION_TINT.danger },
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
