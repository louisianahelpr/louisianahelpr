import {
  Shield, Bell, Users, PawPrint, ClipboardList,
  CalendarDays, Heart, ShieldCheck, Home, Star, Gift, Coins, UserPlus,
  TrendingUp, Crown, FileText, Gavel, HelpCircle,
  AlertTriangle, Type, Clock,
} from "lucide-react";
import { getProfileCompletion } from "@/lib/profileCompletion";
import { hapticLight } from "@/lib/haptics";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { PayoutPrompt } from "@/hooks/useStripeConnectStatus";
import type { MenuItem, Profile } from "./types";
import { FAMILY_ENABLED } from "@/config/familyEnabled";

interface UseProfileLandingDerivedArgs {
  profile: Profile | null;
  avatarBroken: boolean;
  completedCount: number;
  avgRating: number | null;
  reviewCount: number;
  /**
   * Payout state, already resolved into a single verdict by
   * `useStripeConnectStatus` — so the "Payout & Payments" row badge and the
   * banner above it are reading the same answer, not two derivations of it.
   */
  payoutPrompt: PayoutPrompt;
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
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
 * Warnings & Strikes and Admin stay destructive-red — the one deliberate
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
  /** Legal, warnings, support. Red — owner call 2026-08-20: this is the
   *  consequences group, so it carries the warning colour as a set rather
   *  than red appearing on Warnings alone inside an otherwise calm block. */
  legal: "var(--destructive)",
  /** Admin panel + Warnings & Strikes. Same red; kept as its own key so a
   *  future move of either row out of the Legal section keeps its colour. */
  danger: "var(--destructive)",
} as const;

export function useProfileLandingDerived({
  profile,
  avatarBroken,
  payoutPrompt,
  onSelectTab,
  onNavigate,
}: UseProfileLandingDerivedArgs) {
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
  // `setup` is the ONLY verdict that means "this account cannot receive
  // money yet". An `error` verdict deliberately does NOT badge the row: a
  // failed status call is not evidence that the account is broken, and
  // <PayoutStatusRow /> already says "we couldn't check" out loud — a red
  // "Action needed" dot on top of that would be a guess dressed as a fact.
  // (The old code fabricated a disconnected status on failure, which is
  // exactly that guess.)
  const payoutNeedsSetup = payoutPrompt.kind === "setup";
  const stripeNeedsAction = payoutNeedsSetup && profile?.approval_status === "approved";
  const subscriptionDesc =
    tier === "elite"
      ? "Elite — top visibility"
      : tier === "pro"
        ? "Pro — upgrade to Elite"
        : tier === "basic"
          ? "Basic — upgrade to Pro"
          : "Free — tap to upgrade";

  // ─── Portfolio gallery + completion meter ──────────────────────────
  // portfolio_urls is on profiles (text[]). Gallery shows up to 6 inline
  // on the landing; tap navigates into Edit Profile to manage. The
  // completion meter uses the shared getProfileCompletion helper, which
  // tracks only post-signup enhancements (signup already requires
  // photo / name / phone / bio / city / ID doc).
  const portfolioUrls: string[] = (profile?.portfolio_urls ?? []) as string[];
  // Core signup fields (the "Big 7" gate) — already satisfied by every
  // normally-onboarded account. They count toward the percentage so a
  // finished profile reads as mostly-complete instead of a discouraging
  // 0%; the checklist below still lists only the actionable enhancements.
  const coreComplete = [
    !!profile?.full_name?.trim(),
    !!profile?.avatar_url,
    (profile?.bio?.trim().length ?? 0) >= 20,
    !!profile?.date_of_birth,
    !!profile?.phone?.trim(),
    !!profile?.location?.trim(),
    !!profile?.id_document_url,
  ];
  const completion = getProfileCompletion({
    zipCode: profile?.zip_code,
    idvStatus: profile?.idv_status,
    portfolioCount: portfolioUrls.length,
    core: coreComplete,
  });
  const completionPct = completion.pct;

  // Map each completion-checklist item to the exact place that fixes it,
  // so an incomplete row is one tap from the right edit surface (not a
  // generic "open Edit Profile"). Keyed by the labels emitted from
  // getProfileCompletion. `tab` routes through onSelectTab; `href`
  // navigates. A short cue tells the user what they'll land on. Unknown
  // labels fall back to the Edit-Profile form.
  const completionTargets: Record<string, { tab?: string; href?: string; cue: string }> = {
    "ZIP code": { tab: "profile", cue: "Add ZIP" },
    "ID verified": { tab: "credentials", cue: "Verify ID" },
    "Work photos": { tab: "profile", cue: "Add photos" },
  };
  const handleCompletionItemTap = (label: string) => {
    hapticLight();
    const target = completionTargets[label];
    if (target?.href) onNavigate(target.href);
    else onSelectTab(target?.tab ?? "profile");
  };

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
  const payoutIncomplete = payoutNeedsSetup;
  const bioMissing = (profile?.bio?.trim().length ?? 0) < 20;

  // Settings hub, grouped into four scannable editorial sections per the
  // S18 design card: Account · Work · Money · Legal. Pure information-
  // architecture grouping — every row keeps the exact tab `key` / `href`
  // it had before, so nothing is dropped or re-targeted. Surfaces that
  // don't map cleanly to a bucket are folded into their nearest one
  // (family/pets/home record → Account; insights/host/community/benefits
  // → Work; credits/referrals/earnings docs → Money; warnings/support →
  // Legal).
  const menuGroups: { title: string; items: MenuItem[] }[] = [
    // NO ADMIN ROW HERE — it lives in the desktop side panel now (owner: "for
    // webpage, take admin panel out of profile and move to side panel").
    // Admin is a top-level destination, not an account setting: it sits beside
    // Home / Posts / Jobs / Messages / Profile rather than three taps inside
    // one of them. See DesktopSidebarNav.
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
      ],
    },
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
          incompleteLabel: credentialsIncomplete ? "Verify credentials" : undefined,
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
          label: "Auto-Tip",
          icon: <Coins className="w-5 h-5" />,
          desc: "Tip automatically when a job is done",
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
          needsAction: stripeNeedsAction,
          incompleteLabel: payoutIncomplete && !stripeNeedsAction ? "Set payout method" : undefined,
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
      ],
    },
  ];

  // "Profile" row in the header (Edit) doesn't get a pill — its own
  // edit affordance is right there. But the bio nudge sits under the
  // hero anyway, so we surface "Add a photo" / "Add bio" on the
  // landing's existing inline prompts (the avatar Camera dot and the
  // "+ Add a short bio" CTA already cover those).
  void bioMissing;

  return {
    tier,
    hasPhoto,
    memberSinceLabel,
    earnedBadges,
    portfolioUrls,
    completion,
    completionPct,
    completionTargets,
    handleCompletionItemTap,
    menuGroups,
  };
}
