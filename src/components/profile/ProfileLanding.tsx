import { useState, useEffect, useRef } from "react";
import { getProfileCompletion } from "@/lib/profileCompletion";
import {
  LogOut, MapPin,
  CreditCard, Shield,
  Star, Edit, CalendarDays, Gavel,
  ChevronRight as ChevronRightIcon, ChevronDown,
  HelpCircle, Bell, AlertTriangle, Heart, Crown,
  ShieldCheck, Trash2,
  BadgeCheck, Camera, Check,
  TrendingUp, MoreHorizontal, QrCode, Share2, Home,
  Users, Type, PawPrint,
  ClipboardList, FileText,
  Sun, Moon, Monitor,
  CheckCircle2,
  Video, Play, X, BarChart2,
} from "lucide-react";
import { useDarkMode, type Theme } from "@/hooks/useDarkMode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shareNative } from "@/lib/nativeShare";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import { ProfileStatsTrend } from "@/components/profile/ProfileStatsTrend";
import { SkillsManager } from "@/components/profile/SkillsManager";
import { EarningsSparkline } from "@/components/profile/EarningsSparkline";
import { hapticLight } from "@/lib/haptics";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  desc: string;
  href?: string;
  /** HSL token expression (e.g. "var(--bark)") used to tint the row's
      icon tile — gives each surface its own warm accent instead of one
      flat grey. */
  tint?: string;
  /** Render a small "Action needed" red dot when true. */
  needsAction?: boolean;
  /** Short, warm completeness nudge (e.g. "Add a photo"). Optional —
      when set, renders as a small amber pill under the label so the
      user knows *what* to fix before opening the row. Distinct from
      `needsAction`: that's reserved for the louder destructive
      payout-not-enabled state. */
  incompleteLabel?: string;
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
  /** The auth'd user's UUID — used to build the public profile share URL. */
  userId?: string | null;
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
  /** Whether senior mode is currently enabled for this profile. */
  seniorMode?: boolean;
  /** Called when the user toggles senior mode on/off. */
  onToggleSeniorMode?: (enabled: boolean) => void;
  /**
   * Last-6-weeks take-home earnings, oldest → newest, for the header
   * sparkline teaser. `null` (not enough signal) hides the teaser.
   */
  earningsSparkline?: number[] | null;
  /** Total lifetime take-home, shown beside the sparkline. */
  totalEarnings?: number;
}

export function ProfileLanding({
  profile,
  userId,
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
  seniorMode = false,
  onToggleSeniorMode,
  earningsSparkline = null,
  totalEarnings = 0,
}: ProfileLandingProps) {
  const { theme, setTheme } = useDarkMode();

  // Recent work + reviews collapse into one disclosure so the hero
  // stays compact — they can make the card very tall on an
  // established profile.
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  // Profile-completion checklist disclosure. Collapsed by default so the
  // checklist is a quiet, opt-in nudge rather than permanent clutter; the
  // whole block is hidden once the profile is 100% complete (below).
  const [completionOpen, setCompletionOpen] = useState(false);
  // Intro-video state — tracks upload progress and the local preview URL.
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // QR code modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qrOpen || !profile?.user_id) return;
    if (qrDataUrl) return; // already generated
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(
          `https://www.louisianahelpr.com/verify/${profile.user_id}`,
          { width: 240, margin: 2, color: { dark: "#1a1208", light: "#faf7f2" } },
        );
        if (!cancelled) setQrDataUrl(url);
      } catch {
        /* QR generation failure is non-fatal — modal still opens */
      }
    })();
    return () => { cancelled = true; };
  }, [qrOpen, profile?.user_id, qrDataUrl]);
  // Hard size ceiling — Supabase Storage upload rejects files over its
  // per-bucket limit, and an iPhone 4K HEVC 60-second clip easily exceeds
  // 100 MB. Reject upfront with a clear toast instead of letting the
  // request silently 5xx after a long upload. Real client-side
  // compression is phase 2; this is the cheap guard rail.
  const VIDEO_UPLOAD_MAX_BYTES = 30 * 1024 * 1024; // 30 MB
  const handleVideoUpload = async (file: File) => {
    if (!profile?.user_id) return;
    if (file.size > VIDEO_UPLOAD_MAX_BYTES) {
      toast.error(
        `Video is ${Math.round(file.size / 1024 / 1024)} MB. Trim under 30 MB (≈30 seconds of 1080p, or 60 seconds of 720p) and try again.`,
      );
      return;
    }
    setVideoUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "mp4";
      const path = `${profile.user_id}/intro.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("profile-videos")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("profile-videos").getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ intro_video_url: urlData.publicUrl })
        .eq("user_id", profile.user_id);
      if (updateError) throw updateError;
      // Reload page so ProfileLanding reflects the new URL from the DB.
      window.location.reload();
    } catch (err) {
      toast.error("Couldn't upload that video. Please try again.");
      report(err, { tags: { source: "ProfileLanding.handleVideoUpload" } });
    } finally {
      setVideoUploading(false);
    }
  };
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
  const payoutIncomplete =
    stripeConnectStatus === null
      ? false
      : !stripeConnectStatus.payouts_enabled;
  const bioMissing = (profile?.bio?.trim().length ?? 0) < 20;

  // Settings hub, grouped into four scannable editorial sections per the
  // S18 design card: Account · Work · Money · Legal. Pure information-
  // architecture grouping — every row keeps the exact tab `key` / `href`
  // it had before, so nothing is dropped or re-targeted. Surfaces that
  // don't map cleanly to a bucket are folded into their nearest one
  // (family/pets → Account; host/community/benefits → Work;
  // credits/records/referrals → Money; warnings/support → Legal).
  const menuGroups: { title: string; items: MenuItem[] }[] = [
    {
      title: "Account",
      items: [
        { key: "profile", label: "Edit profile", icon: <Edit className="w-5 h-5" />, desc: "Name, photo, bio & contact details", tint: "var(--bark)" },
        {
          key: "security",
          label: "Account Security",
          icon: <Shield className="w-5 h-5" />,
          desc: "Email, password & login",
          tint: "var(--sage)",
          incompleteLabel: !phoneVerified ? "Verify phone" : undefined,
        },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get", tint: "var(--gold-warm)" },
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
          desc: "Pet profiles, vet notes & evacuation",
          tint: "var(--sage)",
          href: "/pets",
        },
      ],
    },
    {
      title: "Work",
      items: [
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Calendar, upcoming jobs & weekly hours", tint: "var(--burnt-sienna)" },
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
          key: "pay-it-forward",
          label: "Pay It Forward",
          icon: <Heart className="w-5 h-5" />,
          desc: "Donate job credits for neighbors who need help",
          tint: "155 50% 30%",
          href: "/pay-it-forward",
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
        { key: "earnings", label: "Earnings", icon: <TrendingUp className="w-5 h-5" />, desc: "Payouts, tips & tax exports", tint: "var(--gold-warm)" },
        {
          key: "payment",
          label: "Payout & Payments",
          icon: <CreditCard className="w-5 h-5" />,
          desc: "Bank account & payment methods",
          tint: "var(--bark)",
          needsAction: stripeNeedsAction,
          incompleteLabel: payoutIncomplete && !stripeNeedsAction ? "Set payout method" : undefined,
        },
        { key: "subscription", label: "Upgrade plan", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc, tint: "var(--burnt-sienna)", href: "/subscription" },
        { key: "analytics", label: "Analytics", icon: <BarChart2 className="w-5 h-5" />, desc: "Trends, categories & hire rate", tint: "var(--stormy-sky)", href: "/analytics" },
        {
          key: "time-credits",
          label: "Time Credits",
          icon: <Crown className="w-5 h-5" />,
          desc: "Earn credits by helping, spend them on your own jobs",
          tint: "var(--gold-warm)",
          href: "/time-credits",
        },
        { key: "referral", label: "Referrals", icon: <Heart className="w-5 h-5" />, desc: "Invite friends & earn credits", tint: "var(--gold-warm)" },
        {
          key: "home-history",
          label: "Home History",
          icon: <ClipboardList className="w-5 h-5" />,
          desc: "Your home's permanent maintenance record",
          tint: "var(--sage)",
          href: "/home-history",
        },
        {
          key: "work-record",
          label: "Work Record",
          icon: <FileText className="w-5 h-5" />,
          desc: "Shareable verified earnings document",
          tint: "var(--gold-warm)",
          href: "/work-record",
        },
      ],
    },
    {
      title: "Legal",
      items: [
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy & guidelines", tint: "var(--sage)" },
        {
          key: "data-rights",
          label: "Data & privacy",
          icon: <ShieldCheck className="w-5 h-5" />,
          desc: "Export or delete your data",
          tint: "var(--stormy-sky)",
          href: "/data-rights",
        },
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
        {/* Action row — Edit pill (right) + Share icon (left of Edit).
            Both sit in the top-right corner without crowding the header. */}
        <div className="absolute top-3.5 right-3 flex items-center gap-1.5">
          {/* Share profile — only shown when we have a userId to build
              the deep-link from. Opens the OS share sheet on native. */}
          {userId && (
            <button
              type="button"
              aria-label="Share your profile"
              onClick={() => {
                const ratingText = avgRating
                  ? avgRating.toFixed(1) + "★"
                  : "New helper";
                void shareNative({
                  title: `${displayName} on Helpr`,
                  text: `${displayName} · ${completedCount} job${completedCount === 1 ? "" : "s"} · ${ratingText}\n\nHire me on Helpr:`,
                  url: `https://www.louisianahelpr.com/user/${userId}`,
                  dialogTitle: "Share your profile",
                });
              }}
              className="h-10 w-10 rounded-full bg-[hsl(var(--bark)/0.10)] hover:bg-[hsl(var(--bark)/0.16)] active:scale-95 inline-flex items-center justify-center text-[hsl(var(--bark))] transition-all"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onSelectTab("profile")}
            aria-label="Edit profile"
            // h-10 hits the iOS/Android 40pt minimum tap target; nudged
            // down half a step so it doesn't crowd the status bar inset.
            className="h-10 pl-2.5 pr-3 rounded-full bg-[hsl(var(--bark)/0.10)] hover:bg-[hsl(var(--bark)/0.16)] active:scale-95 inline-flex items-center gap-1 text-[hsl(var(--bark))] transition-all"
          >
            <Edit className="w-3.5 h-3.5" />
            <span className="text-ds-11 font-sans font-semibold">Edit</span>
          </button>
        </div>

        {/* pr-[132px] reserves space for the Share icon (40px) + gap (6px)
            + Edit pill (~86px) so the name/location row never wraps into
            those controls on narrow phones. */}
        <div className="flex flex-row items-center gap-4 pr-[132px]">
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

        {/* Earnings sparkline teaser — a tiny last-6-weeks take-home
            trend that taps through to the full Earnings screen. Only
            renders when there's enough signal to draw a meaningful line
            (the parent passes null otherwise), so it never shows an empty
            or flat chart. */}
        {earningsSparkline && earningsSparkline.length >= 2 && (
          <button
            type="button"
            onClick={() => { hapticLight(); onSelectTab("earnings"); }}
            aria-label="View your earnings"
            className="mt-3.5 pt-3.5 w-full min-h-[44px] flex items-center justify-between gap-3 text-left active:opacity-70 transition-opacity"
            style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
          >
            <div className="min-w-0">
              <p
                className="font-serif italic uppercase text-ds-9"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Earnings · last 6 weeks
              </p>
              <p className="text-ds-15 font-bold leading-tight mt-0.5" style={{ color: "hsl(var(--ink-deep))" }}>
                ${Number(formatPrice(totalEarnings)).toLocaleString()}
                <span className="ml-1.5 text-ds-10 font-medium text-muted-foreground">total</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <EarningsSparkline
                values={earningsSparkline}
                label="Your earnings over the last 6 weeks"
              />
              <ChevronRightIcon className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            </div>
          </button>
        )}

        {/* Activity-trend disclosure — small area chart, collapsed by
            default so we don't push the rest of the page down. Self-
            fetches its data when opened so the parent stays slim. The
            chart queries jobs.helper_id which maps to auth.user_id —
            *not* the profiles.id PK, so we pass user_id. */}
        {profile?.user_id && (
          <ProfileStatsTrend helperId={profile.user_id} />
        )}

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
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >+ Add a short bio so applicants know who they're hiring.</button>
          )}
        </div>

        {/* ── Intro video ─────────────────────────────────────────────
            Own-profile only. If no video, a dashed-border CTA nudges
            the user to record or upload. If a video exists, a compact
            row with a play button and "Re-record" link renders instead.
            The actual video modal lives in the overlay below. */}
        <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
          {profile?.intro_video_url ? (
            // Video exists — compact play row
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setVideoOpen(true)}
                aria-label="Play intro video"
                className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 active:scale-95 transition-transform"
                style={{ background: "hsl(var(--ink-deep))" }}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play className="w-5 h-5 fill-white text-white" />
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-ds-13 font-semibold leading-tight" style={{ color: "hsl(var(--ink-deep))" }}>
                  Intro video
                  {(profile as any).intro_video_duration_seconds != null && (
                    <span className="ml-2 text-ds-10 font-medium text-muted-foreground">
                      {Math.floor((profile as any).intro_video_duration_seconds / 60)}:
                      {String((profile as any).intro_video_duration_seconds % 60).padStart(2, "0")}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="mt-0.5 text-ds-11 font-semibold active:opacity-70"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                >
                  Re-record or replace
                </button>
              </div>
            </div>
          ) : (
            // No video — compact single-row dashed CTA. Headline + button
            // sit side-by-side; the "2× more hires" subtitle is dropped to
            // halve the card height (it was the largest profile-screen
            // element on first paint).
            <div
              className="rounded-xl flex items-center gap-3 p-3"
              style={{
                border: "1.5px dashed hsl(var(--olivewood) / 0.30)",
                background: "hsl(var(--parchment) / 0.4)",
              }}
            >
              <div
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center"
                style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
              >
                <Video className="w-4 h-4" style={{ color: "hsl(var(--burnt-sienna))" }} />
              </div>
              <p
                className="flex-1 min-w-0 font-semibold text-ds-13 leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Record a 60-second intro video
              </p>
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={videoUploading}
                className="shrink-0 h-9 px-3.5 rounded-full text-ds-12 font-sans font-semibold disabled:opacity-60 active:scale-95 transition-all"
                style={{
                  background: "hsl(var(--burnt-sienna))",
                  color: "hsl(var(--parchment))",
                }}
              >
                {videoUploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          )}
          {/* Hidden file input — shared by the CTA and the "Re-record" link. */}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVideoUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* ── Intro video fullscreen overlay ──────────────────────────
            Only mounts when the user has a video and taps the thumbnail. */}
        {videoOpen && profile?.intro_video_url && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.88)" }}
            onClick={() => setVideoOpen(false)}
          >
            <button
              type="button"
              aria-label="Close video"
              onClick={() => setVideoOpen(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <X className="w-5 h-5 text-white" />
            </button>
            <video
              src={profile.intro_video_url}
              controls
              autoPlay
              playsInline
              className="w-full max-w-sm rounded-ds-md max-h-[70dvh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {/* Your skills — the helper adds/manages skills on their own
            profile; endorsement counts are shown inline. Only rendered
            when a user_id is known (i.e. a real signed-in account row). */}
        {profile?.user_id && (
          <SkillsManager userId={profile.user_id} />
        )}

        {/* QR code button — shows the helper's shareable verification QR.
            Only visible on the user's own profile (profile.user_id is
            always set on the self-view). */}
        {profile?.user_id && (
          <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="flex items-center gap-2.5 w-full text-left active:opacity-70 transition-opacity"
            >
              <div
                className="w-9 h-9 rounded-ds-sm flex items-center justify-center shrink-0"
                style={{ background: "hsl(var(--bark) / 0.08)" }}
              >
                <QrCode className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ds-13 font-semibold leading-tight" style={{ color: "hsl(var(--ink-deep))" }}>
                  My QR Code
                </p>
                <p className="text-ds-11 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Share with your poster to verify at the door
                </p>
              </div>
              <ChevronRightIcon className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            </button>
          </div>
        )}

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
                                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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
              {completion.items.map((item) => {
                const cue = completionTargets[item.label]?.cue;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleCompletionItemTap(item.label)}
                    disabled={item.done}
                    // min-h-[44px] guarantees the iOS/Android tap target even
                    // though the visual row is compact; a completed row is
                    // disabled (no-op + default cursor).
                    aria-label={item.done ? `${item.label} — done` : `${item.label} — tap to finish`}
                    className="w-full min-h-[44px] flex items-center gap-2.5 rounded-ds-md px-2.5 py-2 text-left enabled:active:bg-secondary/40 transition-colors disabled:cursor-default"
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
                      <span className="inline-flex items-center gap-1 shrink-0">
                        {cue && (
                          <span
                            className="text-ds-11 font-semibold"
                            style={{ color: "hsl(var(--burnt-sienna))" }}
                          >
                            {cue}
                          </span>
                        )}
                        <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2.25} />
                      </span>
                    )}
                  </button>
                );
              })}
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
                <div className="rounded-ds-lg liquid-glass overflow-hidden">
                  {group.items.map((item, idx) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        if (item.href) onNavigate(item.href);
                        else onSelectTab(item.key);
                      }}
                      className="glass-press group/row w-full flex items-center justify-between gap-4 pl-4 pr-3.5 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left relative"
                    >
                      {idx > 0 && (
                        <span
                          aria-hidden
                          className="hairline pointer-events-none absolute top-0 left-[60px] right-[14px]"
                        />
                      )}
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Icon tile — the per-icon red corner-dot was
                            removed; "Action needed" inline text below
                            (plus the group-level dot in the section
                            header) is the readable signal, and three
                            stacked reds was visual noise. */}
                        <div className="shrink-0">
                          <div
                            className="w-10 h-10 rounded-ds-md flex items-center justify-center transition-all group-hover/row:shadow-sm"
                            style={{
                              color: `hsl(${item.tint ?? "var(--olivewood)"})`,
                              background: `hsl(${item.tint ?? "var(--olivewood)"} / 0.12)`,
                            }}
                          >
                            {item.icon}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-ds-13 font-semibold text-foreground leading-tight flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{item.label}</span>
                            {item.needsAction && (
                              <span className="text-ds-10 font-bold uppercase tracking-wider text-destructive">
                                Action needed
                              </span>
                            )}
                            {/* Soft amber completeness pill — distinct from the
                                louder "Action needed" red text so a payout
                                blocker still stands out next to a friendly
                                "Add a photo" nudge. Uses burnt-sienna at low
                                opacity so it reads as warm-warning, not
                                destructive. */}
                            {!item.needsAction && item.incompleteLabel && (
                              <span
                                className="inline-flex items-center gap-1 text-ds-10 font-bold rounded-full px-1.5 py-0.5"
                                style={{
                                  background: "hsl(var(--burnt-sienna) / 0.12)",
                                  color: "hsl(var(--burnt-sienna))",
                                  letterSpacing: "0.04em",
                                }}
                              >
                                <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.5} />
                                {item.incompleteLabel}
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

          {/* Display & accessibility — color mode + senior mode grouped
              under one section so the two display preferences read as a
              pair instead of an "Appearance" header followed, two cards
              later, by an unlabeled senior-mode toggle. */}
          <section>
            <div className="flex items-center gap-2 px-1 mb-1.5">
              <h2
                className="font-serif italic uppercase text-ds-9"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Display
              </h2>
            </div>
            <div className="space-y-2">
              {/* Color mode — Light / Auto / Dark segmented control */}
              <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 flex flex-col gap-2">
                <p className="text-ds-12 font-semibold text-foreground leading-tight">
                  Color mode
                </p>
                <div
                  className="flex rounded-ds-md overflow-hidden"
                  style={{ border: "0.5px solid hsl(var(--bark) / 0.2)" }}
                  role="group"
                  aria-label="Color mode"
                >
                  {(
                    [
                      { value: "light" as Theme, Icon: Sun, label: "Light" },
                      { value: "system" as Theme, Icon: Monitor, label: "Auto" },
                      { value: "dark" as Theme, Icon: Moon, label: "Dark" },
                    ] as const
                  ).map(({ value, Icon, label }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={theme === value}
                      onClick={() => setTheme(value)}
                      className="flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors"
                      style={{
                        background:
                          theme === value
                            ? "hsl(var(--bark) / 0.12)"
                            : "transparent",
                        color:
                          theme === value
                            ? "hsl(var(--bark))"
                            : "hsl(var(--olivewood) / 0.8)",
                      }}
                    >
                      <Icon className="w-4 h-4" strokeWidth={2} />
                      <span
                        className="text-ds-10 font-sans font-semibold uppercase"
                        style={{ letterSpacing: "0.06em" }}
                      >
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Senior mode toggle — enlarges text and tap targets. Lives
                  beside Color mode since both are display preferences. */}
              {onToggleSeniorMode && (
                <div className="rounded-ds-lg liquid-glass overflow-hidden">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={seniorMode}
                    onClick={() => onToggleSeniorMode(!seniorMode)}
                    className="glass-press w-full flex items-center justify-between gap-4 pl-4 pr-3.5 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="shrink-0">
                        <div
                          className="w-10 h-10 rounded-ds-md flex items-center justify-center"
                          style={{
                            background: "hsl(var(--stormy-sky) / 0.12)",
                            color: "hsl(var(--stormy-sky))",
                          }}
                        >
                          <Type className="w-5 h-5" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-ds-13 font-semibold text-foreground leading-tight">
                          Senior mode
                        </p>
                        <p className="text-ds-11 text-muted-foreground mt-0.5 truncate">
                          Larger text and bigger tap targets
                        </p>
                      </div>
                    </div>
                    {/* Toggle pill */}
                    <div
                      className="shrink-0 w-11 h-6 rounded-full relative transition-colors duration-200"
                      style={{
                        background: seniorMode
                          ? "hsl(var(--stormy-sky))"
                          : "hsl(var(--sand) / 0.8)",
                      }}
                    >
                      <div
                        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                        style={{
                          transform: seniorMode ? "translateX(22px)" : "translateX(2px)",
                        }}
                      />
                    </div>
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Worker protections card — static info card reassuring helpers
              that Helpr has their back on late cancellations and payment
              disputes. Shown on every helper's own profile. */}
          <div
            className="rounded-ds-lg overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, hsl(155 50% 35% / 0.06) 0%, hsl(155 50% 35% / 0.02) 100%)",
              border: "0.5px solid hsl(155 50% 35% / 0.18)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255,255,255,0.40), 0 2px 8px -2px hsl(var(--olivewood) / 0.06)",
            }}
          >
            <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
              <ShieldCheck
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(155 50% 32%)" }}
              />
              <p
                className="text-ds-13 font-semibold leading-tight"
                style={{ color: "hsl(155 50% 25%)" }}
              >
                Your protections
              </p>
            </div>
            <div className="px-4 pb-3.5 space-y-2">
              {([
                "Late-cancellation credit ($10) if a poster cancels < 24h before start",
                "Payment within 48h of confirmed completion — even during disputes",
                "Your rating stays protected if a job is cancelled through no fault of yours",
              ] as const).map((line) => (
                <div key={line} className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-3.5 h-3.5 mt-0.5 shrink-0"
                    style={{ color: "hsl(155 50% 38%)" }}
                    strokeWidth={2.25}
                  />
                  <p
                    className="font-serif italic text-ds-12 leading-snug"
                    style={{ color: "hsl(155 40% 35%)" }}
                  >
                    {line}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Helpr Wrapped banner — year-in-review shortcut. Year-round
              because the data is always there; links into /wrapped which
              handles its own auth gate. */}
          <button
            type="button"
            onClick={() => onNavigate("/wrapped")}
            aria-label={`View your ${new Date().getFullYear()} Helpr Wrapped`}
            className="w-full rounded-ds-lg overflow-hidden active:scale-[0.99] transition-transform text-left"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--bark) / 0.10) 0%, hsl(var(--burnt-sienna) / 0.12) 100%)",
              border: "0.5px solid hsl(var(--bark) / 0.20)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255,255,255,0.40), 0 2px 8px -2px hsl(var(--olivewood) / 0.10)",
            }}
          >
            <div className="flex items-center gap-3 px-4 py-3.5">
              <TrendingUp
                className="w-5 h-5 shrink-0"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-ds-13 font-semibold leading-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  Your {new Date().getFullYear()} Wrapped
                </p>
                <p
                  className="text-ds-11 font-serif italic mt-0.5"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  See your year on Helpr
                </p>
              </div>
              <MoreHorizontal
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              />
            </div>
          </button>

          {/* Account actions — two stacked pills of the same shape so the
              footer reads as a finished pair. Sign out is a soft muted
              fill in brand bark; Delete account is the same pill outlined
              in burnt-sienna — the brand's destructive tone. */}
          <div className="pt-1 space-y-2.5">
            <button
              type="button"
              onClick={onRequestLogout}
              className="glass-press w-full rounded-ds-lg bg-card py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
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

      {/* ── QR code modal ─────────────────────────────────────────────── */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs mx-auto text-center">
          <DialogHeader>
            <DialogTitle className="text-center">My QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Verification QR code"
                className="w-60 h-60 rounded-ds-md"
                style={{
                  boxShadow: "0 2px 12px hsl(var(--olivewood) / 0.12)",
                }}
              />
            ) : (
              <div
                className="w-60 h-60 rounded-ds-md flex items-center justify-center animate-pulse"
                style={{ background: "hsl(var(--bark) / 0.06)" }}
              >
                <QrCode className="w-12 h-12" style={{ color: "hsl(var(--bark) / 0.3)" }} />
              </div>
            )}
            <p className="text-ds-12 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Share with your poster so they can verify you at the door.
            </p>
            <button
              type="button"
              onClick={async () => {
                if (!profile?.user_id) return;
                await shareNative({
                  title: "Verify me on Helpr",
                  text: `Scan or open this link to verify my identity on Helpr`,
                  url: `https://www.louisianahelpr.com/verify/${profile.user_id}`,
                  dialogTitle: "Share QR Link",
                });
              }}
              className="w-full rounded-ds-md py-3 inline-flex items-center justify-center gap-2 font-semibold text-sm active:scale-[0.99] transition-all"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
              }}
            >
              <Share2 className="w-4 h-4" />
              Share QR Link
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ProfileLanding;
