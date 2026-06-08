import { useState } from "react";
import { getProfileCompletion } from "@/lib/profileCompletion";
import {
  LogOut, MapPin,
  CreditCard, Shield,
  Star, Edit, CalendarDays, Clock, Gavel,
  ChevronRight as ChevronRightIcon, ChevronDown,
  HelpCircle, Bell, AlertTriangle, Heart, Crown,
  ShieldCheck, Trash2,
  BadgeCheck, Camera, Check,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import HelperTierBadge from "@/components/profile/HelperTierBadge";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  desc: string;
  href?: string;
  /** Render a small "Action needed" red dot when true. */
  needsAction?: boolean;
}

interface ReviewPreview {
  rating: number;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
}

interface ProfileLandingProps {
  profile: Profile | null;
  displayName: string;
  initials: string;
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
  avgRating: number | null;
  reviewCount: number;
  postedCount: number;
  completedCount: number;
  stripeConnectStatus: { connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null;
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
  onLoadInlineJobs: () => void;
  onRequestDelete: () => void;
  onRequestLogout: () => void;
  /** Up to 2 most recent reviews surfaced on the hero card. */
  reviewsPreview?: ReviewPreview[];
  /** True when the helper-stats sub-loader failed. */
  statsError?: boolean;
  /** True when the review-preview sub-loader failed. */
  reviewsError?: boolean;
  /** Retries just the helper-stats sub-section. */
  onRetryStats?: () => void;
  /** Retries just the review-preview sub-section. */
  onRetryReviews?: () => void;
}

export function ProfileLanding({
  profile,
  displayName,
  initials,
  avatarBroken,
  setAvatarBroken,
  avgRating,
  reviewCount,
  postedCount,
  completedCount,
  stripeConnectStatus,
  onSelectTab,
  onNavigate,
  onLoadInlineJobs,
  onRequestDelete,
  onRequestLogout,
  reviewsPreview = [],
  statsError = false,
  reviewsError = false,
  onRetryStats,
  onRetryReviews,
}: ProfileLandingProps) {
  // Recent work + reviews collapse into one disclosure so the hero
  // stays compact — they can make the card very tall on an
  // established profile.
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  // Profile-completion checklist disclosure. Collapsed by default so the
  // checklist is a quiet, opt-in nudge rather than permanent clutter; the
  // whole block is hidden once the profile is 100% complete (below).
  const [completionOpen, setCompletionOpen] = useState(false);
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
  const stripeNeedsAction =
    profile?.approval_status === "approved" &&
    stripeConnectStatus !== null &&
    !stripeConnectStatus.payouts_enabled;
  const subscriptionDesc =
    tier === "elite"
      ? "Elite plan — top visibility"
      : tier === "pro"
        ? "Pro plan — upgrade to Elite"
        : "Free plan — tap to upgrade";

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

  const menuGroups: { title: string; items: MenuItem[] }[] = [
    {
      title: "Account",
      items: [
        { key: "credentials", label: "Licensed & Insured", icon: <ShieldCheck className="w-5 h-5" />, desc: "Add your license and insurance" },
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Calendar and upcoming jobs" },
        { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Set your weekly working hours" },
        { key: "saved_helpers", label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer" },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get" },
      ],
    },
    {
      title: "Money",
      items: [
        { key: "payment", label: "Payout & Payments", icon: <CreditCard className="w-5 h-5" />, desc: "Bank account & payment methods", needsAction: stripeNeedsAction },
        { key: "subscription", label: "Subscription", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc },
        { key: "referral", label: "Referrals", icon: <Heart className="w-5 h-5" />, desc: "Invite friends & earn credits" },
      ],
    },
    {
      title: "Settings & Support",
      items: [
        { key: "security", label: "Account Security", icon: <Shield className="w-5 h-5" />, desc: "Email, password & login" },
        { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history" },
        { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us" },
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy & guidelines" },
      ],
    },
  ];

  return (
    <>
      {/* ── Identity header ──────────────────────────────────────────
          A confident profile header: avatar with the ID-verified badge,
          name + tier, location/tenure, then a clean three-up trust
          strip (rating · jobs done · jobs posted). The same radial
          Sienna→Verdigris backdrop as the Dashboard greeting card. */}
      <div
        className="relative liquid-glass shrink-0 p-4 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
            "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
            "0 1px 2px hsl(var(--olivewood) / 0.05), " +
            "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
            "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
        }}
      >
        {/* Labeled "Edit" pill — a bare pencil circle was easy to miss;
            the text makes the affordance obvious. */}
        <button
          onClick={() => onSelectTab("profile")}
          aria-label="Edit profile"
          // h-10 hits the iOS/Android 40pt minimum tap target; nudged
          // down half a step so it doesn't crowd the status bar inset.
          className="absolute top-3.5 right-3 h-10 pl-2.5 pr-3 rounded-full bg-secondary/60 hover:bg-secondary active:scale-95 inline-flex items-center gap-1 text-foreground/75 hover:text-foreground transition-all"
        >
          <Edit className="w-3.5 h-3.5" />
          <span className="text-ds-11 font-sans font-semibold">Edit</span>
        </button>

        <div className="flex flex-row items-center gap-4 pr-[84px]">
          {/* Avatar — a real focal point on this applicant-facing page.
              Tier-styled ring uses gold for elite, sienna for pro,
              bark for everyone else. ID-verified checkmark sits on the
              bottom-right as a trust signal visible at a glance. */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => onSelectTab("profile")}
              aria-label={hasPhoto ? "Edit profile" : "Add a profile photo"}
              className={cn(
                "w-[88px] h-[88px] rounded-[26px] squircle flex items-center justify-center text-ds-24 font-display italic font-bold overflow-hidden active:scale-[0.98] transition-transform",
                // When a real photo is present the gradient is hidden by
                // the `<img>` overlay; when it isn't, the warm hashed
                // gradient replaces the old flat `bg-primary/10` so each
                // user has a recognizable placeholder. `--ink-deep` text
                // + a hair of drop-shadow keeps initials readable on
                // every variant in the palette.
                hasPhoto
                  ? "bg-primary/10 text-primary"
                  : cn(
                      "bg-gradient-to-br text-[hsl(var(--ink-deep))] drop-shadow-sm",
                      avatarGradientFor(profile?.id),
                    ),
              )}
              style={{
                boxShadow:
                  tier === "elite"
                    ? "0 0 0 2.5px hsl(var(--gold-warm))"
                    : tier === "pro"
                      ? "0 0 0 2.5px hsl(var(--burnt-sienna))"
                      : "0 0 0 2px hsl(var(--bark) / 0.18)",
              }}
            >
              {hasPhoto ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={profile!.avatar_url as string}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setAvatarBroken(true)}
                />
              ) : initials}
            </button>
            {hasPhoto && profile?.idv_status === "verified" && (
              <div
                aria-label="ID verified"
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: "hsl(var(--bark))",
                  border: "2px solid hsl(var(--parchment))",
                }}
              >
                <BadgeCheck className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.5} />
              </div>
            )}
            {!hasPhoto && (
              <div
                aria-hidden
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: "hsl(var(--bark))",
                  border: "2px solid hsl(var(--parchment))",
                }}
              >
                <Camera className="w-3.5 h-3.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.25} />
              </div>
            )}
          </div>

          {/* Name + tier + location, vertically centered against the avatar */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="font-display italic font-bold leading-tight"
                style={{
                  fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.025em",
                }}
              >
                {displayName || "Welcome back"}
              </h1>
              {/* Subscription tier badge — only shown when tier is not free.
                  Pro = sienna, Elite = gold-warm. */}
              {tier === "pro" && (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    color: "hsl(var(--burnt-sienna))",
                    background: "hsl(var(--burnt-sienna) / 0.12)",
                    letterSpacing: "0.08em",
                  }}
                >
                  Pro
                </span>
              )}
              {tier === "elite" && (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{
                    color: "hsl(var(--gold-warm))",
                    background: "hsl(var(--gold-warm) / 0.14)",
                    letterSpacing: "0.08em",
                  }}
                >
                  <Crown className="w-2.5 h-2.5" /> Elite
                </span>
              )}
            </div>
            {profile?.location && (
              // Wraps to a second line on a narrow column instead of
              // double-truncating; only an unusually long city ever
              // ellipsizes, and the short "New member"/"Since …" tenure
              // stays intact (it travels as one shrink-0 group).
              <p className="text-ds-11 text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-1">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-full min-w-0">{profile.location}</span>
                {memberSinceLabel && (
                  <span className="shrink-0 inline-flex items-center gap-1">
                    <span className="opacity-50">·</span>
                    <span>{memberSinceLabel}</span>
                  </span>
                )}
              </p>
            )}
            {/* Earned trust badges — only the EARNED ones render, so the
                row reads as proof, not a checklist of gaps. The
                verification-ladder badge (#112) lives alongside them as
                the headline trust signal — tap reveals what the tier
                means and the exact gap to the next rung, which makes
                this the one self-facing surface where progression hints
                drive behavior. Self-hides at tier 0. */}
            {(earnedBadges.length > 0 || profile) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <HelperTierBadge
                  profile={{
                    approval_status: profile?.approval_status ?? null,
                    idv_status: profile?.idv_status ?? null,
                    stripe_account_id: profile?.stripe_account_id ?? null,
                  }}
                  stats={{
                    completedJobs: completedCount,
                    avgRating: avgRating ?? 0,
                    reviewCount,
                  }}
                  size="sm"
                />
                {earnedBadges.map((b) => (
                  <span
                    key={b.label}
                    className="inline-flex items-center gap-1 text-ds-9 font-sans font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                  >
                    <BadgeCheck className="w-2.5 h-2.5" />
                    {b.label}
                  </span>
                ))}
              </div>
            )}
            {!profile?.full_name?.trim() && (
              <button
                onClick={() => onSelectTab("profile")}
                className="mt-1.5 text-ds-11 font-semibold text-primary hover:underline"
              >
                + Add your name
              </button>
            )}
          </div>
        </div>

        {/* Trust strip — rating · jobs done · jobs posted, given room to
            breathe in three even columns instead of a cramped inline
            line. A failed stats load shows a small inline error here, so
            a partial failure stays scoped to this strip. */}
        <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
          {statsError ? (
            <ProfileSectionError
              section="your profile stats"
              onRetry={() => onRetryStats?.()}
            />
          ) : (
            /* Buttons use `h-full py-2` so the middle column's vertical
               `border-x border-border/50` divider spans the full height
               of the trust strip; previously the borders only matched
               the (variable) intrinsic height of the middle column. */
            <div className="grid grid-cols-3 items-stretch">
              <button
                onClick={() => onSelectTab("reviews")}
                className="flex flex-col items-center justify-center gap-0.5 py-2 h-full active:opacity-60 transition-opacity"
              >
                <span className="inline-flex items-center gap-1">
                  <Star
                    className="w-3.5 h-3.5 text-primary"
                    fill={reviewCount > 0 ? "currentColor" : "none"}
                  />
                  {/* "New" until the first review lands — a 5.0 with 0
                      reviews is a default, not an earned rating. */}
                  {reviewCount > 0 ? (
                    <span className="text-ds-15 font-bold text-foreground leading-none">
                      {avgRating ? avgRating.toFixed(1) : "5.0"}
                    </span>
                  ) : (
                    <span className="text-ds-13 font-bold text-foreground leading-none">New</span>
                  )}
                </span>
                <span className="text-ds-9 font-sans font-medium uppercase tracking-wider text-muted-foreground">
                  {reviewCount > 0 ? `${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}` : "Rating"}
                </span>
              </button>
              <button
                onClick={() => { if (completedCount > 0) { onLoadInlineJobs(); onSelectTab("completed_jobs"); } }}
                className="flex flex-col items-center justify-center gap-0.5 py-2 h-full border-x border-border/50 active:opacity-60 transition-opacity"
              >
                <span className="text-ds-15 font-bold text-foreground leading-none">{completedCount}</span>
                <span className="text-ds-9 font-sans font-medium uppercase tracking-wider text-muted-foreground">
                  Jobs done
                </span>
              </button>
              <button
                onClick={() => { if (postedCount > 0) { onLoadInlineJobs(); onSelectTab("posted_jobs"); } }}
                className="flex flex-col items-center justify-center gap-0.5 py-2 h-full active:opacity-60 transition-opacity"
              >
                <span className="text-ds-15 font-bold text-foreground leading-none">{postedCount}</span>
                <span className="text-ds-9 font-sans font-medium uppercase tracking-wider text-muted-foreground">
                  Jobs posted
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Bio excerpt — surfaces the user's pitch on the landing page,
            since this is what applicants see when deciding whether to apply.
            Empty state nudges the user to write one. */}
        <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
          {profile?.bio?.trim() ? (
            <p
              className="font-serif italic text-ds-13 leading-snug line-clamp-3"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              {profile.bio}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => onSelectTab("profile")}
              className="w-full text-left font-serif italic text-ds-13 leading-snug active:opacity-70 transition-opacity"
              style={{ color: "hsl(var(--olivewood) / 0.55)" }}
            >+ Add a short bio so applicants know who they're hiring.</button>
          )}
        </div>

        {/* Work & reviews — collapsed into one disclosure so the header
            stays short. Renders only when there's something to show, OR
            when the review sub-loader failed (so the failure has a home
            and a retry). */}
        {(portfolioUrls.length > 0 || reviewsPreview.length > 0 || reviewsError) && (
          <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
            {reviewsError && reviewsPreview.length === 0 && portfolioUrls.length === 0 ? (
              <ProfileSectionError
                section="your recent reviews"
                onRetry={() => onRetryReviews?.()}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowcaseOpen((o) => !o)}
                  aria-expanded={showcaseOpen}
                  className="w-full flex items-center justify-between gap-2 active:opacity-70 transition-opacity"
                >
                  <span className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    Work &amp; reviews
                  </span>
                  <span className="inline-flex items-center gap-1 text-ds-11 font-semibold" style={{ color: "hsl(var(--bark))" }}>
                    {showcaseOpen ? "Hide" : "View"}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showcaseOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>

                {showcaseOpen && (
                  <div className="mt-3 space-y-3">
                    {portfolioUrls.length > 0 && (
                      <div>
                        <p className="font-serif italic uppercase text-ds-9 mb-2" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                          Recent work
                        </p>
                        {/* Horizontal scroll with scroll-snap so each
                            thumbnail snaps cleanly on touch-fling even
                            at 320 px (iPhone SE). snap-x mandatory +
                            snap-start keeps the leftmost item always
                            partially visible so the scroller reads as
                            scrollable at a glance. */}
                        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 scrollbar-hide pb-1 snap-x snap-mandatory">
                          {portfolioUrls.slice(0, 6).map((url, i) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => onSelectTab("profile")}
                              className="shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border/40 active:scale-95 transition-transform snap-start"
                              aria-label={`Work sample ${i + 1}`}
                            >
                              <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {reviewsError ? (
                      <ProfileSectionError
                        section="your recent reviews"
                        onRetry={() => onRetryReviews?.()}
                      />
                    ) : reviewsPreview.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                            Recent reviews
                          </p>
                          <button
                            type="button"
                            onClick={() => onSelectTab("reviews")}
                            className="text-ds-11 font-semibold active:opacity-70"
                            style={{ color: "hsl(var(--bark))" }}
                          >
                            See all →
                          </button>
                        </div>
                        <div className="space-y-2">
                          {reviewsPreview.map((r, i) => {
                            const days = Math.max(
                              0,
                              Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000),
                            );
                            const when =
                              days < 1 ? "today" :
                              days < 7 ? `${days}d ago` :
                              days < 30 ? `${Math.floor(days / 7)}w ago` :
                              days < 365 ? `${Math.floor(days / 30)}mo ago` :
                              `${Math.floor(days / 365)}y ago`;
                            return (
                              <button
                                key={`${r.created_at}-${i}`}
                                type="button"
                                onClick={() => onSelectTab("reviews")}
                                className="w-full text-left rounded-xl p-2.5 active:scale-[0.99] active:opacity-80 transition-all"
                                style={{
                                  background: "hsla(0, 0%, 100%, 0.55)",
                                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                                }}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="flex items-center gap-0.5">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <Star
                                        key={n}
                                        className="w-3 h-3"
                                        style={{
                                          color: n <= r.rating ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
                                          fill: n <= r.rating ? "hsl(var(--burnt-sienna))" : "transparent",
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <span className="text-ds-11 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
                                    {r.reviewerName}
                                  </span>
                                  <span className="text-ds-10 text-muted-foreground shrink-0">· {when}</span>
                                </div>
                                {r.feedback?.trim() ? (
                                  <p
                                    className="font-serif italic text-ds-13 leading-snug line-clamp-2"
                                    style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                                  >
                                    "{r.feedback}"
                                  </p>
                                ) : (
                                  <p
                                    className="font-serif italic text-ds-11 leading-snug"
                                    style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                                  >
                                    {r.jobTitle}
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Finish your profile ──────────────────────────────────────
          Completion checklist. Sits right under the header (the most
          sensible spot — it's the user's own next action), as a quiet
          collapsed disclosure rather than permanent clutter. The whole
          block is HIDDEN once every actionable enhancement is done. */}
      {completion.nextLabel !== null && (
        <div
          className="liquid-glass shrink-0 overflow-hidden"
          style={{
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
          }}
        >
          <button
            type="button"
            onClick={() => setCompletionOpen((o) => !o)}
            aria-expanded={completionOpen}
            className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-secondary/30 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-ds-13 font-semibold text-foreground">Finish your profile</span>
                <span
                  className="text-ds-10 font-bold tabular-nums px-1.5 py-0.5 rounded-full"
                  style={{
                    color: "hsl(var(--bark))",
                    background: "hsl(var(--bark) / 0.10)",
                  }}
                >
                  {completionPct}%
                </span>
              </div>
              <div className="h-1.5 mt-2 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${completionPct}%`,
                    background:
                      completionPct >= 66
                        ? "hsl(var(--bark) / 0.85)"
                        : "hsl(var(--burnt-sienna) / 0.75)",
                  }}
                />
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground/70 shrink-0 transition-transform ${completionOpen ? "rotate-180" : ""}`}
            />
          </button>

          {completionOpen && (
            <div className="px-4 pb-4 pt-1 space-y-1.5">
              {completion.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onSelectTab("profile")}
                  disabled={item.done}
                  className="w-full flex items-center gap-2.5 rounded-ds-md px-2.5 py-2 text-left enabled:active:bg-secondary/40 transition-colors disabled:cursor-default"
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      item.done ? "" : "border border-dashed"
                    }`}
                    style={
                      item.done
                        ? { background: "hsl(var(--bark))" }
                        : { borderColor: "hsl(var(--olivewood) / 0.35)" }
                    }
                  >
                    {item.done && (
                      <Check className="w-3 h-3" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3} />
                    )}
                  </span>
                  <span
                    className={`flex-1 text-ds-13 ${
                      item.done ? "text-muted-foreground line-through" : "text-foreground font-medium"
                    }`}
                  >
                    {item.label}
                  </span>
                  {!item.done && (
                    <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" strokeWidth={2.25} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Settings & navigation ────────────────────────────────────
          One unified pattern: every sub-section is a list row grouped
          under a quiet section label. (Replaces the old mix of square
          category tiles + a separate row list — list-of-rows scales
          cleaner and is easier to scan.) */}
      <div
        className="liquid-glass"
        style={{
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "0 1px 2px hsl(var(--olivewood) / 0.06), " +
            "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
        }}
      >
        <div className="px-4 pt-3 pb-4 space-y-4">
          {/* Payout banner — slim single-row alert. The whole row taps
              through to Payment Settings. */}
          {profile?.approval_status === "approved" && stripeConnectStatus && !stripeConnectStatus.payouts_enabled && (
            <button
              type="button"
              onClick={() => onSelectTab("payment")}
              className="w-full flex items-center gap-2.5 rounded-ds-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-left active:scale-[0.99] transition-all"
            >
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <p className="flex-1 min-w-0 text-ds-11 text-foreground leading-snug">
                <span className="font-semibold">Set up your payout account</span> to accept jobs and get paid.
              </p>
              <span className="shrink-0 text-ds-11 font-semibold text-destructive inline-flex items-center gap-0.5">
                Set up <ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2.25} />
              </span>
            </button>
          )}

          {/* Unified list-of-rows navigation, grouped by section. */}
          {menuGroups.map((group) => {
            const groupNeedsAction = group.items.some((i) => i.needsAction);
            return (
              <section key={group.title}>
                <div className="flex items-center gap-2 px-1 mb-1.5">
                  <h2
                    className="font-serif italic uppercase text-ds-9"
                    style={{
                      color: "hsl(var(--burnt-sienna) / 0.78)",
                      letterSpacing: "0.18em",
                    }}
                  >
                    {group.title}
                  </h2>
                  {groupNeedsAction && (
                    // Decorative red dot — purely a visual cue that one of
                    // the rows below needs action. Each row that needs
                    // action already renders the visible text "Action
                    // needed" (see below), so the dot adds no information
                    // for AT users. `aria-hidden` keeps it out of the a11y
                    // tree and avoids the aria-prohibited-attr violation
                    // that an `aria-label` on a generic <span> would
                    // produce.
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rounded-full bg-destructive"
                    />
                  )}
                </div>
                <div className="rounded-ds-lg bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] overflow-hidden">
                  {group.items.map((item, idx) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        if (item.href) onNavigate(item.href);
                        else onSelectTab(item.key);
                      }}
                      className="group/row w-full flex items-center justify-between gap-4 pl-4 pr-3.5 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left relative"
                    >
                      {idx > 0 && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-0 left-[60px] right-[14px] h-px bg-border/55"
                        />
                      )}
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Icon tile — the per-icon red corner-dot was
                            removed; "Action needed" inline text below
                            (plus the group-level dot in the section
                            header) is the readable signal, and three
                            stacked reds was visual noise. */}
                        <div className="shrink-0">
                          <div className="w-10 h-10 rounded-ds-md bg-muted/60 text-muted-foreground flex items-center justify-center transition-colors group-hover/row:bg-primary/10 group-hover/row:text-primary">
                            {item.icon}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-ds-13 font-semibold text-foreground leading-tight">
                            {item.label}
                            {item.needsAction && (
                              <span className="ml-2 text-ds-10 font-bold uppercase tracking-wider text-destructive">
                                Action needed
                              </span>
                            )}
                          </p>
                          <p className="text-ds-11 text-muted-foreground mt-0.5 truncate">{item.desc}</p>
                        </div>
                      </div>
                      <span className="w-5 flex items-center justify-center shrink-0">
                        <ChevronRightIcon className="w-4 h-4 text-muted-foreground/70" strokeWidth={2.25} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Account actions — two stacked pills of the same shape so the
              footer reads as a finished pair. Sign out is a soft muted
              fill in brand bark; Delete account is the same pill outlined
              in burnt-sienna — the brand's destructive tone. */}
          <div className="pt-1 space-y-2.5">
            <button
              type="button"
              onClick={onRequestLogout}
              className="w-full rounded-ds-lg bg-secondary/60 py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] active:bg-secondary transition-all"
              style={{
                color: "hsl(var(--bark))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
              }}
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              className="w-full rounded-ds-lg py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
              style={{
                background: "transparent",
                border: "1px solid hsl(var(--burnt-sienna) / 0.32)",
                color: "hsl(var(--burnt-sienna))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
              }}
            >
              <Trash2 className="w-4 h-4" /> Delete account
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProfileLanding;
