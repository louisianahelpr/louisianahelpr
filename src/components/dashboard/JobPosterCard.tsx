import { Star, ChevronRight, Crown, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { TrustRow } from "@/components/TrustRow";
import type { EnrichedJob } from "./types";

interface JobPosterCardProps {
  /** The job whose poster is shown. */
  job: EnrichedJob;
  /** Completed jobs between the current helper and this poster. */
  repeatJobs: number;
  /** Combined cancellation rate (%) of the poster across posted and
   *  worked jobs. Null while loading or when the ≥5-job sample-size
   *  floor isn't met. When present, surfaced inline near the name so
   *  the helpr can read it without leaving the job dialog. */
  cancellationRate?: number | null;
}

/**
 * JobPosterCard — the "Posted by" mini-profile tile in JobDetailDialog:
 * avatar, name, rating, helper badges, and the trust-signal row
 * (escrow, Pro/Elite poster, trusted, repeat-customer).
 *
 * Extracted verbatim from JobDetailDialog.tsx.
 */
export function JobPosterCard({ job, repeatJobs, cancellationRate }: JobPosterCardProps) {
  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });
  const posterInitials = (job.posterName || "User")
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const hasReviews = (job.posterReviewCount ?? 0) >= 3;
  const hasTier =
    job.posterSubscriptionTier === "elite" ||
    job.posterSubscriptionTier === "pro" ||
    job.posterSubscriptionTier === "basic";
  const showTrustRow = hasTier || hasReviews || repeatJobs >= 2;

  return (
    <Link
      to={`/user/${job.customer_id}`}
      className="relative block p-2.5 rounded-ds-md group glass-press transition-colors"
      style={{
        backgroundColor: "hsla(0, 0%, 100%, 0.55)",
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        border: "0.5px solid hsl(var(--bark) / 0.18)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
          "0 1px 2px hsl(var(--olivewood) / 0.05)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-sans font-semibold text-[0.75rem] tracking-[0.06em] uppercase overflow-hidden"
          style={{
            backgroundColor: "hsl(var(--bark) / 0.12)",
            border: "1px solid hsl(var(--bark) / 0.22)",
            color: "hsl(var(--bark))",
            boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.5)",
          }}
        >
          {job.posterAvatarUrl ? (
            <img
              loading="lazy"
              decoding="async"
              src={job.posterAvatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            posterInitials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-ds-10 font-sans font-semibold uppercase"
            style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.06em" }}
          >
            Posted by
          </p>
          <div className="flex items-baseline gap-2">
            <p className="font-display italic font-bold leading-tight truncate text-[1rem] min-w-0" style={{ color: "hsl(var(--ink-deep))" }}>
              {job.posterName}
            </p>
            <span className="flex items-center gap-0.5 text-ds-11 shrink-0">
              {(job.posterReviewCount ?? 0) > 0 ? (
                <>
                  <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                  <span className="font-display italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    {job.posterAvgRating?.toFixed(1)}
                  </span>
                  <span className="font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    ({job.posterReviewCount})
                  </span>
                </>
              ) : (
                <span className="font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  New
                </span>
              )}
            </span>
          </div>
          <p className="font-serif italic text-ds-11 leading-tight" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            {(job.posterCompletedJobs ?? 0) > 0 && (
              <>
                {" "}<span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
                {job.posterCompletedJobs} {job.posterCompletedJobs === 1 ? "job" : "jobs"}
              </>
            )}
            {cancellationRate != null && (
              <>
                {" "}<span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
                {/* Colored against thresholds: <5% reads green (low),
                    5–14% neutral, ≥15% warning sienna. Matches the
                    profile-page cancellation card's color stops. */}
                <span
                  className="tabular-nums"
                  style={{
                    color: cancellationRate < 5
                      ? "hsl(var(--pif-tint))"
                      : cancellationRate < 15
                        ? "hsl(var(--olivewood) / 0.8)"
                        : "hsl(var(--burnt-sienna))",
                  }}
                >
                  {cancellationRate.toFixed(0)}% cancelled
                </span>
              </>
            )}
          </p>
        </div>
        {posterBadges.length > 0 && (
          <div className="shrink-0">
            <HelperBadges badges={posterBadges} />
          </div>
        )}
        {/* "View profile" affordance — chevron on the right edge so the
            card visually reads as tappable. */}
        <ChevronRight
          className="shrink-0 w-4 h-4 transition-transform group-hover:translate-x-0.5"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          strokeWidth={2}
        />
      </div>

      {/* Trust signal row — poster tier (Pro/Elite) is rendered inline;
          poster-data signals (Trusted, Worked together) go through the
          shared TrustRow component. Hidden entirely when a poster has no
          tier and no trust data, so new posters don't get an empty band. */}
      {showTrustRow && (
        <div
          className="flex items-center justify-center gap-3 mt-2 pt-2"
          style={{
            borderTop: "0.5px solid hsl(var(--bark) / 0.12)",
          }}
        >
          {job.posterSubscriptionTier === "elite" && (
            <span
              className="inline-flex items-center gap-1 text-ds-10 font-sans font-semibold uppercase"
              style={{ color: "hsl(var(--gold-warm))", letterSpacing: "0.06em" }}
            >
              <Crown className="w-3.5 h-3.5" strokeWidth={2.25} />
              Elite Poster
            </span>
          )}
          {job.posterSubscriptionTier === "pro" && (
            <span
              className="inline-flex items-center gap-1 text-ds-10 font-sans font-semibold uppercase"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.06em" }}
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2.25} />
              Pro Poster
            </span>
          )}
          {job.posterSubscriptionTier === "basic" && (
            <span
              className="inline-flex items-center gap-1 text-ds-10 font-sans font-semibold uppercase"
              style={{ color: "hsl(var(--bark))", letterSpacing: "0.06em" }}
            >
              <Star className="w-3.5 h-3.5" strokeWidth={2.25} />
              Basic Poster
            </span>
          )}
          {/* Poster-data trust signals via the reusable TrustRow component.
              "Trusted" maps to avgRating+reviewCount (shown when ≥3 reviews).
              "Worked together N×" maps to repeatHirePercent (≥2 jobs → 100%). */}
          <TrustRow
            avgRating={hasReviews ? (job.posterAvgRating ?? undefined) : undefined}
            reviewCount={hasReviews ? (job.posterReviewCount ?? undefined) : undefined}
            repeatHirePercent={repeatJobs >= 2 ? 100 : undefined}
          />
        </div>
      )}
    </Link>
  );
}
