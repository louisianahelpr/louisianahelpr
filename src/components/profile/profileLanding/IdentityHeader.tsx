import { useState, useRef } from "react";
import {
  MapPin, ChevronRight as ChevronRightIcon, ChevronDown,
  BadgeCheck, Camera, Crown, QrCode, Video, Play,
  Star, Share2, Edit,
} from "lucide-react";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import { ProfileStatsTrend } from "@/components/profile/ProfileStatsTrend";
import { SkillsManager } from "@/components/profile/SkillsManager";
import { EarningsSparkline } from "@/components/profile/EarningsSparkline";
import { hapticLight } from "@/lib/haptics";
import { shareNative } from "@/lib/nativeShare";
import type { Profile, ReviewPreview } from "./types";
import { formatVideoDuration } from "./identityHeader/identityHeaderHelpers";
import { IntroVideoOverlay } from "./identityHeader/IntroVideoOverlay";
import { RecentReviewsList } from "./identityHeader/RecentReviewsList";

interface IdentityHeaderProps {
  profile: Profile | null;
  userId?: string | null;
  displayName: string;
  initials: string;
  setAvatarBroken: (v: boolean) => void;
  avgRating: number | null;
  reviewCount: number;
  completedCount: number;
  onSelectTab: (key: string) => void;
  reviewsPreview: ReviewPreview[];
  reviewsError: boolean;
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
  completedCount,
  onSelectTab,
  reviewsPreview,
  reviewsError,
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
                  aria-hidden="true"
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
                  Basic = neutral bark (gold is reserved for the earned
                  Pro/Elite prestige, per HelperBadges), Pro = sienna,
                  Elite = gold-warm. */}
              {tier === "basic" && (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{
                    color: "hsl(var(--bark))",
                    background: "hsl(var(--bark) / 0.10)",
                    letterSpacing: "0.08em",
                  }}
                >
                  <Star className="w-2.5 h-2.5" /> Basic
                </span>
              )}
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

        {/* Affordance row — Reviews · Share · Edit · QR code, side by
            side in four even boxes. The Reviews box keeps the star +
            rating so the headline trust signal stays visible; the other
            three are the profile's primary self-actions. */}
        <div className="mt-3.5 grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => { hapticLight(); onSelectTab("reviews"); }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-xl px-1 py-2 active:scale-95 transition-transform"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--ink-deep))" }}>
              <Star className="w-3.5 h-3.5 fill-current" style={{ color: "hsl(var(--gold-warm))" }} />
              <span className="text-ds-13 font-bold leading-none">
                {avgRating ? avgRating.toFixed(1) : "New"}
              </span>
            </span>
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
            </span>
          </button>

          <button
            type="button"
            aria-label="Share your profile"
            disabled={!userId}
            onClick={() => {
              hapticLight();
              const ratingText = avgRating ? avgRating.toFixed(1) + "★" : "New helper";
              void shareNative({
                title: `${displayName} on Helpr`,
                text: `${displayName} · ${completedCount} job${completedCount === 1 ? "" : "s"} · ${ratingText}\n\nHire me on Helpr:`,
                url: `https://www.louisianahelpr.com/user/${userId}`,
                dialogTitle: "Share your profile",
              });
            }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-xl px-1 py-2 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <Share2 className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              Share
            </span>
          </button>

          <button
            type="button"
            aria-label="Edit profile"
            onClick={() => { hapticLight(); onSelectTab("profile"); }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-xl px-1 py-2 active:scale-95 transition-transform"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <Edit className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              Edit
            </span>
          </button>

          <button
            type="button"
            aria-label="My QR code"
            disabled={!profile?.user_id}
            onClick={() => { hapticLight(); setQrOpen(true); }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-xl px-1 py-2 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <QrCode className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              QR code
            </span>
          </button>
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
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
                      {formatVideoDuration((profile as any).intro_video_duration_seconds)}
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
          <IntroVideoOverlay url={profile.intro_video_url} onClose={() => setVideoOpen(false)} />
        )}

        {/* Your skills — the helper adds/manages skills on their own
            profile; endorsement counts are shown inline. Only rendered
            when a user_id is known (i.e. a real signed-in account row). */}
        {profile?.user_id && (
          <SkillsManager userId={profile.user_id} />
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
                  <span className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
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
                        <p className="font-serif italic uppercase text-ds-9 mb-2" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
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
                              <img loading="lazy" decoding="async" src={url} alt="" aria-hidden="true" className="w-full h-full object-cover" />
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
                      <RecentReviewsList reviewsPreview={reviewsPreview} onSelectTab={onSelectTab} />
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
