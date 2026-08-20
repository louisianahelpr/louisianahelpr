import {
  Shield, ShieldAlert, Bell, Users, PawPrint, ClipboardList,
  CalendarDays, Heart, ShieldCheck, Home, Star, Gift, Coins, UserPlus,
  TrendingUp, Crown, FileText, Gavel, HelpCircle,
  AlertTriangle, Type, Clock,
} from "lucide-react";
import { getProfileCompletion } from "@/lib/profileCompletion";
import { hapticLight } from "@/lib/haptics";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { PayoutPrompt } from "@/hooks/useStripeConnectStatus";
import type { MenuItem, Profile } from "./types";

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

export function useProfileLandingDerived({
  profile,
  avatarBroken,
  payoutPrompt,
  onSelectTab,
  onNavigate,
}: UseProfileLandingDerivedArgs) {
  // The admin-panel shortcut used to be a Shield icon button in the Dashboard
  // app bar. Home no longer has an app bar, and /admin is an account-level
  // destination rather than per-screen chrome, so it is a row in this settings
  // list now — gated on the same `isAdmin` flag, so non-admins never see it.
  const { isAdmin } = useCurrentUser();

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
    // Staff-only, and first so an admin doesn't scroll past four groups of
    // their own account settings to reach the moderation queue. It renders
    // for nobody else, so it costs a normal user nothing.
    ...(isAdmin
      ? [{
          title: "Admin",
          items: [{
            key: "admin",
            label: "Admin panel",
            icon: <ShieldAlert className="w-5 h-5" />,
            desc: "Moderation queue, users & platform tools",
            tint: "var(--destructive)",
            href: "/admin",
          }],
        }]
      : []),
    {
      title: "Account",
      items: [
        {
          key: "security",
          label: "Account Security",
          icon: <Shield className="w-5 h-5" />,
          desc: "Email, password & login",
          tint: "var(--sage)",
          incompleteLabel: !phoneVerified ? "Verify phone" : undefined,
        },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get", tint: "var(--stormy-sky)" },
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
          tint: "var(--bark)",
        },
        {
          key: "family",
          label: "Family & care",
          icon: <Users className="w-5 h-5" />,
          desc: "Manage jobs for a family member",
          tint: "var(--stormy-sky)",
          href: "/family",
        },
        {
          key: "pets",
          label: "My Pets",
          icon: <PawPrint className="w-5 h-5" />,
          desc: "Pet profiles & vet notes",
          tint: "var(--sage)",
          href: "/pets",
        },
        {
          key: "home-history",
          label: "Home History",
          icon: <ClipboardList className="w-5 h-5" />,
          desc: "Your home's permanent maintenance record",
          tint: "var(--sage)",
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
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Your calendar & upcoming jobs", tint: "var(--burnt-sienna)" },
        { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Weekly hours & the available-now signal", tint: "var(--sage)" },
        { key: "saved_helpers", label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer", tint: "var(--burnt-sienna)" },
        {
          key: "credentials",
          label: "Licensed & Insured",
          icon: <ShieldCheck className="w-5 h-5" />,
          desc: "Add your license and insurance",
          tint: "var(--bark)",
          incompleteLabel: credentialsIncomplete ? "Verify credentials" : undefined,
        },
        {
          key: "str-settings",
          label: "Host Automation",
          icon: <Home className="w-5 h-5" />,
          desc: "Auto-post cleanings on Airbnb / VRBO checkout",
          tint: "var(--bark)",
          href: "/str-settings",
        },
        {
          key: "gift-card",
          label: "Gift Card",
          icon: <Gift className="w-5 h-5" />,
          desc: "Donate job credits for neighbors who need help",
          tint: "155 50% 30%",
          href: "/gift-card",
        },
        {
          key: "benefits",
          label: "Benefits & Perks",
          icon: <Star className="w-5 h-5" />,
          desc: "Health coverage, financial tools & supply discounts",
          tint: "var(--burnt-sienna)",
          href: "/benefits",
        },
      ],
    },
    {
      title: "Money",
      items: [
        {
          key: "auto-tip",
          label: "Auto-tip",
          icon: <Coins className="w-5 h-5" />,
          desc: "Tip automatically when a job is done",
          tint: "var(--burnt-sienna)",
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
          label: "Earnings & payouts",
          icon: <TrendingUp className="w-5 h-5" />,
          desc: "Wallet, analytics, payout setup & tax exports",
          tint: "var(--burnt-sienna)",
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
        { key: "subscription", label: "Membership", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc, tint: "var(--burnt-sienna)" },
        { key: "referral", label: "Referrals", icon: <UserPlus className="w-5 h-5" />, desc: "Invite friends & earn credits", tint: "var(--burnt-sienna)" },
        {
          key: "work-record",
          label: "Work Record",
          icon: <FileText className="w-5 h-5" />,
          desc: "Shareable verified earnings document",
          tint: "var(--burnt-sienna)",
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
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy, guidelines & data export", tint: "var(--sage)" },
        { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history", tint: "var(--destructive)" },
        { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us", tint: "var(--bark)" },
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
