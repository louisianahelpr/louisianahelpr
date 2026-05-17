import { useState } from "react";
import {
  DollarSign, LogOut, MapPin,
  CreditCard, Shield,
  Star, Edit, CalendarDays, Clock, Gavel,
  ChevronRight as ChevronRightIcon, ChevronDown,
  HelpCircle, Bell, AlertTriangle, Heart, Crown,
  ShieldCheck, Trash2,
  BadgeCheck, ImagePlus, Camera,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

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
  activeMenuGroup: string | null;
  setActiveMenuGroup: (v: string | null) => void;
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
  onLoadInlineJobs: () => void;
  onRequestDelete: () => void;
  onRequestLogout: () => void;
  /** Up to 2 most recent reviews surfaced on the hero card. */
  reviewsPreview?: ReviewPreview[];
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
  activeMenuGroup,
  setActiveMenuGroup,
  onSelectTab,
  onNavigate,
  onLoadInlineJobs,
  onRequestDelete,
  onRequestLogout,
  reviewsPreview = [],
}: ProfileLandingProps) {
  // Recent work + reviews collapse into one disclosure so the hero
  // stays compact — they can make the card very tall on an
  // established profile.
  const [showcaseOpen, setShowcaseOpen] = useState(false);
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
    { ok: (profile as any)?.license_status === "verified", label: "Licensed" },
    { ok: (profile as any)?.insurance_status === "verified", label: "Insured" },
  ]).filter((b) => b.ok);
  const stripeNeedsAction =
    profile?.approval_status === "approved" &&
    stripeConnectStatus !== null &&
    !stripeConnectStatus.payouts_enabled;
  const idvNeedsAction =
    profile?.idv_status === "not_started" || profile?.idv_status === "failed";

  const subscriptionDesc =
    tier === "elite"
      ? "Elite plan — top visibility"
      : tier === "pro"
        ? "Pro plan — bump to Elite for max reach"
        : "Free plan — upgrade for more visibility";

  // ─── Portfolio gallery + completion meter ──────────────────────────
  // portfolio_urls is on profiles (text[]). Gallery shows up to 6 inline
  // on the landing; tap navigates into Edit Profile to manage. The
  // completion meter shares the same 6-item checklist as ProfileEditForm
  // so the % matches between landing and edit views.
  const portfolioUrls: string[] = ((profile as any)?.portfolio_urls ?? []) as string[];
  const completionItems = [
    { label: "Profile photo", done: !!profile?.avatar_url },
    { label: "Phone", done: !!(profile as any)?.phone },
    { label: "Location", done: !!profile?.location && !!(profile as any)?.zip_code },
    { label: "Bio", done: !!profile?.bio && profile.bio.trim().length >= 20 },
    {
      label: "ID verified",
      done:
        profile?.idv_status === "verified" ||
        profile?.idv_status === "pending" ||
        profile?.idv_status === "processing" ||
        profile?.idv_status === "manual_review",
    },
    { label: "Work photos", done: portfolioUrls.length > 0 },
  ];
  const completionDone = completionItems.filter((i) => i.done).length;
  const completionPct = Math.round((completionDone / completionItems.length) * 100);

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
        { key: "payment", label: "Payout & Payments", icon: <CreditCard className="w-5 h-5" />, desc: "Bank account, payment methods & summary", needsAction: stripeNeedsAction },
        { key: "subscription", label: "Subscription", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc },
        { key: "referral", label: "Referrals", icon: <Heart className="w-5 h-5" />, desc: "Invite friends & earn credits" },
      ],
    },
    {
      title: "Settings & Support",
      items: [
        { key: "security", label: "Account Security", icon: <Shield className="w-5 h-5" />, desc: "Email, password & login", needsAction: idvNeedsAction },
        { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history" },
        { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us" },
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy & guidelines" },
      ],
    },
  ];

  return (
    <>
      {/* Top box — hero with avatar + name + stats. Same radial
          Sienna→Verdigris backdrop as the Dashboard greeting card. */}
      <div
        className="relative liquid-glass shrink-0 p-3.5 overflow-hidden"
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
          className="absolute top-2.5 right-2.5 h-8 pl-2 pr-2.5 rounded-full bg-secondary/60 hover:bg-secondary active:scale-95 inline-flex items-center gap-1 text-foreground/75 hover:text-foreground transition-all"
        >
          <Edit className="w-3.5 h-3.5" />
          <span className="text-ds-11 font-sans font-semibold">Edit</span>
        </button>
        <div className="flex flex-row items-start gap-4 pr-[72px]">
          {/* Avatar — bumped 75px → 92px so it's a real focal point on this
              applicant-facing page (was a tiny chip next to a wide name).
              Tier-styled ring uses gold for elite, accent for pro, primary
              for everyone else. ID-verified checkmark sits on the bottom-
              right as a trust signal that's visible at a glance. */}
          <div className="relative shrink-0">
            {/* Avatar taps through to Edit Profile. When there's no
                photo it carries a camera badge — profile photo is
                required at signup, so a missing one only happens on
                seeded / legacy accounts, but the nudge still helps
                them. */}
            <button
              type="button"
              onClick={() => onSelectTab("profile")}
              aria-label={hasPhoto ? "Edit profile" : "Add a profile photo"}
              className="w-[92px] h-[92px] rounded-[26px] squircle bg-primary/10 text-primary flex items-center justify-center text-ds-24 font-display italic font-bold overflow-hidden active:scale-[0.98] transition-transform"
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
          {/* Identity + tier + stats, all stacked tight on the right */}
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
                  Pro = sienna, Elite = gold-warm. Small enough not to crowd
                  the name; visible enough to read as a signal. */}
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
              <p className="text-ds-11 text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{profile.location}</span>
                {memberSinceLabel && (
                  <>
                    <span className="opacity-50">·</span>
                    <span className="truncate">{memberSinceLabel}</span>
                  </>
                )}
              </p>
            )}
            {/* Trust badges — only the EARNED ones render, so the row
                reads as proof, not a checklist of gaps. Unearned items
                are nudged via the completion meter + Credentials tab. */}
            {earnedBadges.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
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
            {/* Integrated stats — single inline line directly under badges */}
            <div className="flex items-center gap-3 mt-2 text-ds-11">
              <button
                onClick={() => onSelectTab("reviews")}
                className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
              >
                <Star
                  className="w-3 h-3 text-primary"
                  fill={reviewCount > 0 ? "currentColor" : "none"}
                />
                {/* "New" until the first review lands — a 5.0 with 0
                    reviews is a default, not an earned rating. */}
                {reviewCount > 0 ? (
                  <>
                    <span className="font-bold text-foreground">{avgRating ? avgRating.toFixed(1) : "5.0"}</span>
                    <span className="text-muted-foreground">({reviewCount})</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">New</span>
                )}
              </button>
              <span className="w-px h-3 bg-border/60" />
              <button
                onClick={() => { if (postedCount > 0) { onLoadInlineJobs(); onSelectTab("posted_jobs"); } }}
                className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
              >
                <span className="font-bold text-foreground">{postedCount}</span>
                <span className="text-muted-foreground">Posted</span>
              </button>
              <span className="w-px h-3 bg-border/60" />
              <button
                onClick={() => { if (completedCount > 0) { onLoadInlineJobs(); onSelectTab("completed_jobs"); } }}
                className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
              >
                <span className="font-bold text-foreground">{completedCount}</span>
                <span className="text-muted-foreground">Done</span>
              </button>
            </div>
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
        {/* Bio excerpt — surfaces the user's pitch on the landing page,
            since this is what applicants see when deciding whether to apply.
            Empty state nudges the user to write one (it's the single
            highest-leverage thing a helper can do for visibility). */}
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
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
        {/* Work & reviews — collapsed into one disclosure so the hero
            stays short. Renders only when there's something to show;
            an empty portfolio is nudged by the completion meter below
            (its checklist already includes "Work photos"), so the
            standalone empty-state nudge was removed as redundant. */}
        {(portfolioUrls.length > 0 || reviewsPreview.length > 0) && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
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
                    <div className="flex gap-2 overflow-x-auto -mx-1 px-1 scrollbar-hide pb-1">
                      {portfolioUrls.slice(0, 6).map((url, i) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => onSelectTab("profile")}
                          className="shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border/40 active:scale-95 transition-transform"
                          aria-label={`Work sample ${i + 1}`}
                        >
                          <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {reviewsPreview.length > 0 && (
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
                                className="font-serif italic text-ds-12 leading-snug line-clamp-2"
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
                )}
              </div>
            )}
          </div>
        )}
        {/* Completion meter — compact single row (bar + inline
            "NN% · next step" link) instead of the old eyebrow-row +
            bar two-row block, so the content-dense hero gets one row
            shorter. Auto-hides at 100%. */}
        {completionPct < 100 && (
          <div
            className="mt-3 pt-3 flex items-center gap-3"
            style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
          >
            <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden">
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
            <button
              type="button"
              onClick={() => onSelectTab("profile")}
              className="shrink-0 text-ds-11 font-semibold active:opacity-70 whitespace-nowrap"
              style={{ color: "hsl(var(--bark))" }}
            >
              {completionPct}% · {completionItems.find((i) => !i.done)?.label} →
            </button>
          </div>
        )}
      </div>

      {/* Bottom box — menu groups + account actions. A normal,
          fully-rounded card with a soft contained shadow. (It used to
          carry the flat-bottom "bleed under the dock" treatment, but
          this content is short and the landing tab scrolls naturally,
          so that just produced a hard cut-off edge below Delete
          account instead of a finished card.) */}
      <div
        className="liquid-glass"
        style={{
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "0 1px 2px hsl(var(--olivewood) / 0.06), " +
            "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
        }}
      >
        <div className="px-4 pt-3 pb-4 space-y-3">
          {/* Payout banner — slim single-row alert. It used to be a
              big bordered card + full-width solid button that dominated
              the page; the MONEY tab chip now also carries a blocker
              dot, so this can inform without shouting. The whole row
              taps through to Payment Settings. */}
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

          {/* Category buttons replace the old always-expanded long list. */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2.5">
              {menuGroups.map((group) => {
                const isActive = activeMenuGroup === group.title;
                const GroupIcon = group.title === "Account" ? Edit : group.title === "Money" ? DollarSign : HelpCircle;
                // Bubble a blocker dot onto the tab chip when any item
                // inside the group needs action — so the user spots it
                // without opening every tab.
                const groupNeedsAction = group.items.some((i) => i.needsAction);

                return (
                  <button
                    key={group.title}
                    type="button"
                    onClick={() => setActiveMenuGroup(isActive ? null : group.title)}
                    className={`relative min-h-[78px] rounded-[20px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] px-2 py-2.5 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${isActive ? "ring-2 ring-primary/30 text-primary" : "text-foreground hover:bg-secondary/40"}`}
                    aria-expanded={isActive}
                  >
                    {groupNeedsAction && (
                      <span
                        aria-label="Action needed"
                        className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-destructive ring-2 ring-white"
                      />
                    )}
                    <span className={`w-9 h-9 rounded-ds-md flex items-center justify-center ${isActive ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground"}`}>
                      <GroupIcon className="w-4.5 h-4.5" />
                    </span>
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] leading-tight text-center">
                      {group.title === "Settings & Support" ? "Settings" : group.title}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeMenuGroup && (() => {
              const group = menuGroups.find((menuGroup) => menuGroup.title === activeMenuGroup);
              if (!group) return null;
              // Caret connector — a white diamond pointing up from the
              // expanded list to whichever tab chip is active, so the
              // list visibly belongs to the lit-up tab. The px nudge
              // corrects for the grid's gap-2.5 (≈3.3px per column).
              const activeIndex = menuGroups.findIndex((g) => g.title === activeMenuGroup);

              return (
                <div>
                  <div className="relative h-2" aria-hidden>
                    <div
                      className="absolute w-3 h-3 rotate-45 bg-white"
                      style={{
                        left: `calc(${(activeIndex + 0.5) * 33.333}% + ${(activeIndex - 1) * 3.33}px)`,
                        bottom: "-2px",
                        transform: "translateX(-50%) rotate(45deg)",
                        boxShadow: "-1.5px -1.5px 2px hsl(160 10% 12% / 0.05)",
                      }}
                    />
                  </div>
                  <div className="rounded-[24px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] overflow-hidden">
                    {group.items.map((item, idx) => (
                      <button
                        key={item.label}
                        onClick={() => {
                          if (item.href) onNavigate(item.href);
                          else onSelectTab(item.key);
                        }}
                        className="group/row w-full flex items-center justify-between gap-4 pl-5 pr-4 py-3.5 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left relative"
                      >
                        {idx > 0 && (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-0 left-[68px] right-[15px] h-px bg-border/60"
                          />
                        )}
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="relative shrink-0">
                            <div className="w-10 h-10 rounded-ds-md bg-muted/60 text-muted-foreground flex items-center justify-center transition-colors group-hover/row:bg-primary/10 group-hover/row:text-primary">
                              {item.icon}
                            </div>
                            {item.needsAction && (
                              <span
                                aria-label="Action needed"
                                className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-destructive ring-2 ring-white"
                              />
                            )}
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
                </div>
              );
            })()}
          </div>

          {/* Account actions — two stacked pills of the same shape so
              the footer reads as a finished pair. Both are restrained
              (sign-out + delete are low-frequency actions that
              shouldn't out-shout the settings list above): Sign out is
              a soft muted fill in brand bark, Delete account is the
              same pill outlined in burnt-sienna — the brand's
              destructive tone, matching the Delete-account dialog. */}
          <div className="pt-2 space-y-2.5">
            <button
              type="button"
              onClick={onRequestLogout}
              className="w-full rounded-[20px] bg-secondary/60 py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] active:bg-secondary transition-all"
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
              className="w-full rounded-[20px] py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
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
