import { useState, useRef } from "react";
import {
  MapPin, Star, Edit, ChevronRight as ChevronRightIcon, ChevronDown,
  BadgeCheck, Camera, Crown, QrCode, Share2, Video, Play, X,
} from "lucide-react";
import { shareNative } from "@/lib/nativeShare";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import { ProfileStatsTrend } from "@/components/profile/ProfileStatsTrend";
import { SkillsManager } from "@/components/profile/SkillsManager";
import { EarningsSparkline } from "@/components/profile/EarningsSparkline";
import { hapticLight } from "@/lib/haptics";
import type { Profile, ReviewPreview } from "./types";

interface IdentityHeaderProps {
  profile: Profile | null;
  userId?: string | null;
  displayName: string;
  initials: string;
  setAvatarBroken: (v: boolean) => void;
  avgRating: number | null;
  reviewCount: number;
  postedCount: number;
  completedCount: number;
  onSelectTab: (key: string) => void;
  onLoadInlineJobs: () => void;
  reviewsPreview: ReviewPreview[];
  statsError: boolean;
  reviewsError: boolean;
  onRetryStats?: () => void;
  onRetryReviews?: () => void;
  earningsSparkline: number[] | null;
  totalEarnings: number;
  tier: string;
  hasPhoto: boolean;
  memberSinceLabel: string | null;
  earnedBadges: { ok: boolean; label: string }[];
  portfolioUrls: string[];
  videoUploading: boolean;
  handleVideoUpload: (file: File) => void;
  setQrOpen: (open: boolean) => void;
}

export function IdentityHeader({
  profile,
  userId,
  displayName,
  initials,
  setAvatarBroken,
  avgRating,
  reviewCount,
  postedCount,
  completedCount,
  onSelectTab,
  onLoadInlineJobs,
  reviewsPreview,
  statsError,
  reviewsError,
  onRetryStats,
  onRetryReviews,
  earningsSparkline,
  totalEarnings,
  tier,
  hasPhoto,
  memberSinceLabel,
  earnedBadges,
  portfolioUrls,
  videoUploading,
  handleVideoUpload,
  setQrOpen,
}: IdentityHeaderProps) {
  // Recent work + reviews collapse into one disclosure so the hero
  // stays compact — they can make the card very tall on an
  // established profile.
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  // Intro-video state — tracks the fullscreen preview open state.
  const [videoOpen, setVideoOpen] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);

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

        <div className="flex flex-row items-center gap-4">
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
            {/* Only the name line clears the absolutely-positioned Share
                icon (40px) + gap (6px) + Edit pill (~86px) at top-right via
                pr-[132px]. The location + badges sit BELOW the buttons'
                bottom edge, so they take the full column width instead of
                being needlessly crushed (which forced "New Orleans, LA" to
                wrap mid-phrase). */}
            <div className="flex items-center gap-2 flex-wrap pr-[132px]">
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
                <span className="break-words">{profile.location}</span>
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
    </>
  );
}
