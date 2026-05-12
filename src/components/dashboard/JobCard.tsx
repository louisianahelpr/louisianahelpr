import {
  MapPin, Calendar, DollarSign, Star, Zap, Rocket, Clock, Timer, Users, Repeat,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";

import { categoryLabels, categoryColors, categoryIcons } from "@/components/activity/activityConstants";
import { parseLocalDate } from "@/lib/dateUtils";
import { getCityState } from "@/lib/locationUtils";
import type { EnrichedJob } from "./types";

interface JobCardProps {
  job: EnrichedJob;
  effectiveFee: number;
  currentUserId?: string;
  showApply?: boolean;
  onApply: (jobId: string) => void;
  onReport: (jobId: string) => void;
  onSelect: (job: EnrichedJob) => void;
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: (jobId: string) => void;
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
}

// Category colors apply ONLY to the category badge pill at the top of
// the card. The job title itself stays in `text-foreground` (deep
// charcoal) across all categories so the brand reads consistently and
// the colored badge stays the single accent in the row. The `accent`
// gradient tints are kept for the boosted/recommended highlight strip.
const JobCard = ({ job, effectiveFee, currentUserId: _currentUserId, showApply: _showApply = true, onSelect, index = 0, isExpanded: _isExpanded = false, onToggleExpand: _onToggleExpand, isSaved: _isSaved = false, onToggleSave: _onToggleSave }: JobCardProps) => {
  // Per-helpr take-home: gross share minus the platform's commission, plus
  // the customer-paid urgent bonus. Matches JobDetailDialog math 1:1.
  // (The 10% sales tax on the platform commission is paid by the platform,
  // not the helpr — historically deducted here, which made the card and
  // dialog disagree by ~$1.)
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelperBudget = job.budget / helpersCount;
  const commission = perHelperBudget * (effectiveFee / 100);
  const netEarnings = perHelperBudget - commission + (job.urgent_fee ?? 0);
  const earnings = netEarnings.toFixed(2);
  const catStyle = categoryColors[job.category] || categoryColors.other;

  const cityState = getCityState(job.location);

  // Expiry info
  const expiryText = job.expires_at
    ? new Date(job.expires_at) <= new Date()
      ? "Expired"
      : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left"
    : null;
  const isExpiringSoon = job.expires_at && differenceInHours(new Date(job.expires_at), new Date()) < 24;

  // Stagger entry via CSS animation-delay — avoids pulling framer-motion into
  // the dashboard's hot list path (saves ~42KB on iOS cold start).
  const entryDelay = `${Math.min(index * 70, 500)}ms`;
  // Poster initials for the avatar fallback (no avatar URL on the
  // EnrichedJob shape — we keep this lightweight by deriving from name).
  const posterInitials = (job.posterName || "User")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const ratingDisplay = (job.posterReviewCount ?? 0) > 0 ? job.posterAvgRating?.toFixed(1) : null;

  return (
    <div
      style={{ animationDelay: entryDelay, animationFillMode: "both" }}
      className="animate-fade-in group relative rounded-2xl border border-border/60 bg-card cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary overflow-hidden"
      onClick={() => onSelect(job)}
      role="button"
      tabIndex={0}
      aria-label={`View ${job.title} — $${job.budget}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(job);
        }
      }}
    >
      {/* Category rail — vertical color stripe down the left edge of
          the card. Makes the feed scannable: same category jobs read as
          a cluster, different categories pop visually. Color comes from
          the category's `dot` class so it matches the existing icon. */}
      <span
        aria-hidden
        className={`absolute left-0 top-0 bottom-0 w-1 ${catStyle.dot}`}
      />
      <div className="w-full px-3.5 py-3 flex items-center gap-3">
        {/* Avatar with category icon badge — poster initials in a
            Bark-tinted glass circle, with a small colored circle on
            top-left that mirrors the category filter icon + color. */}
        <div className="relative shrink-0">
          <a
            href={`/user/${job.customer_id}`}
            onClick={(e) => e.stopPropagation()}
            className="block w-11 h-11 rounded-full flex items-center justify-center font-sans font-semibold text-[0.78rem] tracking-[0.06em] uppercase transition-transform hover:scale-105 overflow-hidden"
            style={{
              backgroundColor: "hsl(var(--bark) / 0.12)",
              // Tier halo around poster avatar: gold for Elite posters,
              // sienna for Pro, default subtle bark for free. Surfaces
              // subscriber posters in the helper's feed at a glance.
              boxShadow:
                job.posterSubscriptionTier === "elite"
                  ? "0 0 0 2px hsl(var(--gold-warm)), inset 0 1px 1px 0 rgba(255, 255, 255, 0.5)"
                  : job.posterSubscriptionTier === "pro"
                    ? "0 0 0 2px hsl(var(--burnt-sienna)), inset 0 1px 1px 0 rgba(255, 255, 255, 0.5)"
                    : "inset 0 1px 1px 0 rgba(255, 255, 255, 0.5)",
              border:
                job.posterSubscriptionTier === "elite" || job.posterSubscriptionTier === "pro"
                  ? "none"
                  : "1px solid hsl(var(--bark) / 0.22)",
              color: "hsl(var(--bark))",
            }}
            aria-label={`View ${job.posterName}'s profile`}
          >
            {(job as any).posterAvatarUrl ? (
              <img
                loading="lazy"
                decoding="async"
                src={(job as any).posterAvatarUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              posterInitials
            )}
          </a>
          {(() => {
            const CategoryIcon = categoryIcons[job.category] || categoryIcons.other;
            return (
              <span
                aria-label={categoryLabels[job.category] || job.category}
                className={`absolute -top-0.5 -left-0.5 w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-card ${catStyle.dot}`}
              >
                <CategoryIcon className="w-2.5 h-2.5 text-white/85" strokeWidth={2.25} />
              </span>
            );
          })()}
        </div>

        {/* Center: title · location · date · rating */}
        <div className="min-w-0 flex-1 space-y-1">
          <h3
            className="font-display italic font-bold text-foreground leading-tight line-clamp-2"
            style={{
              fontSize: "0.95rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.012em",
            }}
          >
            {job.title}
          </h3>
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[10.5px] text-muted-foreground leading-tight">
            <span className="flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate max-w-[110px] font-serif italic">{cityState}</span>
            </span>
            <span className="opacity-30">·</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-2.5 h-2.5 shrink-0" />
              <span className="font-serif italic">
                {!job.start_time && !job.date_needed
                  ? "Flexible"
                  : parseLocalDate(job.date_needed).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
            </span>
            {expiryText && (
              <>
                <span className="opacity-30">·</span>
                <span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}>
                  <Timer className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-serif italic">{expiryText}</span>
                </span>
              </>
            )}
            {ratingDisplay && (
              <>
                <span className="opacity-30">·</span>
                <span className="flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5 fill-accent text-accent shrink-0" />
                  <span className="font-medium text-foreground">{ratingDisplay}</span>
                </span>
              </>
            )}
            <>
              <span className="opacity-30">·</span>
              <span className="flex items-center gap-1 opacity-80">
                <Clock className="w-2.5 h-2.5 shrink-0" />
                <span className="font-serif italic">
                  {formatDistanceToNow(new Date(job.created_at), { addSuffix: false })} ago
                </span>
              </span>
            </>
            {job.is_group_job && (
              <>
                <span className="opacity-30">·</span>
                <span
                  className="flex items-center gap-1"
                  style={{ color: "hsl(var(--primary))" }}
                >
                  <Users className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
                  <span className="font-serif italic font-medium">
                    needs {job.helpers_needed ?? 2} helprs
                  </span>
                </span>
              </>
            )}
            {job.is_recurring && (
              <>
                <span className="opacity-30">·</span>
                <span className="flex items-center gap-1">
                  <Repeat className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
                  <span className="font-serif italic">
                    {(job as any).recurrence_interval || "Recurring"}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right column: price tile with Boosted / Urgent badges
            overlapping its top edge — same notification-stamp pattern
            as the category icon over the avatar. */}
        <div className="relative shrink-0 flex flex-col items-end">
        {/* Badge cluster — both Boosted and Urgent sit at the top-right
            corner of the price tile. Stacked horizontally with Urgent
            (alarm cue) inner-most so it reads first when both apply. */}
        {(job.isBoosted || job.is_urgent) && (
          <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1">
            {job.isBoosted && (
              <span
                aria-label="Boosted"
                className="boosted-shimmer boosted-pulse inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider"
                style={{
                  color: "hsl(38 60% 28%)",
                  border: "0.5px solid hsl(var(--gold-warm) / 0.6)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "inset 0 -1px 1px 0 hsl(var(--gold-warm) / 0.20), " +
                    "0 1px 2px hsl(var(--gold-warm) / 0.20), " +
                    "0 4px 10px -3px hsl(var(--gold-warm) / 0.34)",
                }}
              >
                <Rocket className="w-2.5 h-2.5" strokeWidth={2.25}
                  style={{ color: "hsl(var(--gold-warm))", fill: "hsl(var(--gold-warm) / 0.35)" }} />
                Boosted
              </span>
            )}
            {job.is_urgent && (
              <span
                aria-label="Urgent"
                className="urgent-pulse inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[8px] font-bold uppercase tracking-wider"
                style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
              >
                <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
              </span>
            )}
          </div>
        )}
        {/* Price tile — premium achievement-badge feel: warm parchment
            translucency, double inner-shadow (bright top rim + soft
            bottom seat), gold-warm hairline at the top edge for the
            "earned" cue. */}
        <div
          className="flex flex-col items-center px-2.5 py-1.5 rounded-ds-md"
          style={{
            background: "linear-gradient(180deg, hsla(38, 50%, 96%, 0.78) 0%, hsla(38, 30%, 92%, 0.62) 100%)",
            backdropFilter: "blur(20px) saturate(170%)",
            WebkitBackdropFilter: "blur(20px) saturate(170%)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            boxShadow:
              "inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.85), " +
              "inset 0 -1px 2px 0 hsl(var(--bark) / 0.10), " +
              "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.18), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 6px 14px -4px hsl(var(--bark) / 0.22)",
          }}
        >
          <span
            className="flex items-center font-display leading-none tabular-nums"
            style={{
              fontWeight: 800,
              fontSize: "1.05rem",
              color: "hsl(var(--bark))",
              letterSpacing: "-0.02em",
            }}
          >
            <DollarSign className="w-3.5 h-3.5" strokeWidth={2.25} />
            {earnings}
          </span>
          {(job.urgent_fee ?? 0) > 0 && (
            <span
              className="font-sans font-semibold mt-0.5 text-[8.5px] tracking-[0.04em]"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              incl. ${Number(job.urgent_fee).toFixed(0)} urgent bonus
            </span>
          )}
          <span
            className="text-[7.5px] uppercase mt-0.5 font-sans"
            style={{
              color: "hsl(var(--olivewood) / 0.6)",
              letterSpacing: "0.16em",
              fontWeight: 600,
            }}
          >
            You earn
          </span>
        </div>
        </div>
      </div>

    </div>
  );
};

export default JobCard;
