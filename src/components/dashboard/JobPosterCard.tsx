import { Star, ChevronRight, Lock, Crown, Sparkles, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import type { EnrichedJob } from "./types";

interface JobPosterCardProps {
  /** The job whose poster is shown. */
  job: EnrichedJob;
  /** Completed jobs between the current helper and this poster. */
  repeatJobs: number;
}

/**
 * JobPosterCard — the "Posted by" mini-profile tile in JobDetailDialog:
 * avatar, name, rating, helper badges, and the trust-signal row
 * (escrow, Pro/Elite poster, trusted, repeat-customer).
 *
 * Extracted verbatim from JobDetailDialog.tsx.
 */
export function JobPosterCard({ job, repeatJobs }: JobPosterCardProps) {
  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });
  const posterInitials = (job.posterName || "User")
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <a
      href={`/user/${job.customer_id}`}
      className="relative block p-2.5 rounded-ds-md group transition-colors"
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
            className="text-[10px] font-sans font-semibold uppercase"
            style={{ color: "hsl(var(--olivewood) / 0.65)", letterSpacing: "0.06em" }}
          >
            Posted by
          </p>
          <div className="flex items-baseline gap-2">
            <p className="font-display italic font-bold leading-tight truncate text-[1rem] min-w-0" style={{ color: "hsl(var(--ink-deep))" }}>
              {job.posterName}
            </p>
            <span className="flex items-center gap-0.5 text-[11px] shrink-0">
              <Star className={`w-3.5 h-3.5 ${(job.posterReviewCount ?? 0) > 0 ? "fill-accent text-accent" : "text-muted-foreground/50"}`} />
              <span className="font-display italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {(job.posterReviewCount ?? 0) > 0 ? job.posterAvgRating?.toFixed(1) : "0.0"}
              </span>
              <span className="font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
                ({job.posterReviewCount ?? 0})
              </span>
            </span>
          </div>
          <p className="font-serif italic text-[11px] leading-tight" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            {(job.posterCompletedJobs ?? 0) > 0 && (
              <>
                {" "}<span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
                {job.posterCompletedJobs} jobs
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
          style={{ color: "hsl(var(--olivewood) / 0.5)" }}
          strokeWidth={2}
        />
      </div>

      {/* Trust signal row — only show truthful platform/poster facts.
          Helpr escrow is always true (platform guarantee). Pro/Elite
          tier badge only renders when the poster actually has one.
          Repeat-poster badge shows when they've posted multiple jobs. */}
      <div
        className="flex items-center justify-center gap-3 mt-2 pt-2 text-[10px] font-sans font-semibold uppercase"
        style={{
          color: "hsl(var(--olivewood) / 0.7)",
          letterSpacing: "0.06em",
          borderTop: "0.5px solid hsl(var(--bark) / 0.12)",
        }}
      >
        <span className="inline-flex items-center gap-1">
          <Lock className="w-3.5 h-3.5" style={{ color: "hsl(var(--burnt-sienna) / 0.75)" }} strokeWidth={2.25} />
          Helpr Escrow
        </span>
        {job.posterSubscriptionTier === "elite" && (
          <>
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
            <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--gold-warm))" }}>
              <Crown className="w-3.5 h-3.5" strokeWidth={2.25} />
              Elite Poster
            </span>
          </>
        )}
        {job.posterSubscriptionTier === "pro" && (
          <>
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
            <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--burnt-sienna))" }}>
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2.25} />
              Pro Poster
            </span>
          </>
        )}
        {(job.posterReviewCount ?? 0) >= 3 && (
          <>
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5" style={{ color: "hsl(var(--burnt-sienna) / 0.75)" }} strokeWidth={2.25} fill="currentColor" />
              Trusted
            </span>
          </>
        )}
        {repeatJobs >= 2 && (
          <>
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
            <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--bark))" }}>
              <Users className="w-3.5 h-3.5" strokeWidth={2.25} />
              Worked together {repeatJobs}×
            </span>
          </>
        )}
      </div>
    </a>
  );
}
