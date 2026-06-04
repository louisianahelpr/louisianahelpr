import { memo, type KeyboardEvent } from "react";
import {
  MapPin, Calendar, Clock, Star, Zap, Rocket, Timer, Users, Repeat, Lock,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";

import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { parseLocalDate } from "@/lib/dateUtils";
import { formatTime12 } from "@/components/TimePickerSelect";
import { getCityState } from "@/lib/locationUtils";
import { usePrefetchOnTouch } from "@/lib/usePrefetchOnTouch";
import { prefetchJobDialog } from "./prefetchJobDialog";
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
  /**
   * Guest/read-only variant for the public Browse page. Hides helper-only
   * affordances — the per-helpr "You earn" net-pay math (a guest has no
   * fee tier yet) — and shows the gross budget with a persistent
   * "Sign up to apply" CTA instead. The signed-in Dashboard leaves this
   * unset, so its behaviour is unchanged.
   */
  variant?: "default" | "guest";
  /**
   * Show the gross posted budget + neutral "Budget" label instead of the
   * helper-side "You earn" net-pay figure — WITHOUT adopting the full
   * `variant="guest"` treatment (which also pins a "Sign up to apply" lock
   * footer to every card). Used by the native guest dashboard, where the
   * "Need help, or want to earn?" framing is two-sided, so a one-sided
   * "You earn" label misreads for a visitor who wants to post/hire.
   */
  guestPricing?: boolean;
}

// Category colors apply ONLY to the category badge pill at the top of
// the card. The job title itself stays in `text-foreground` (deep
// charcoal) across all categories so the brand reads consistently and
// the colored badge stays the single accent in the row. The `accent`
// gradient tints are kept for the boosted/recommended highlight strip.
const JobCard = ({ job, effectiveFee, currentUserId: _currentUserId, showApply: _showApply = true, onSelect, index = 0, isExpanded: _isExpanded = false, onToggleExpand: _onToggleExpand, isSaved: _isSaved = false, onToggleSave: _onToggleSave, variant = "default", guestPricing = false }: JobCardProps) => {
  const isGuest = variant === "guest";
  // Show the gross posted budget (vs the helper's net take-home) whenever
  // the full guest variant is active OR the lighter guestPricing flag is set.
  const showBudget = isGuest || guestPricing;
  // Per-helpr take-home: gross share minus the platform's commission, plus
  // the customer-paid urgent bonus. Matches JobDetailDialog math 1:1.
  // (The 10% sales tax on the platform commission is paid by the platform,
  // not the helpr — historically deducted here, which made the card and
  // dialog disagree by ~$1.)
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelperBudget = job.budget / helpersCount;
  const commission = perHelperBudget * (effectiveFee / 100);
  const netEarnings = perHelperBudget - commission + (job.urgent_fee ?? 0);
  // Guests have no fee tier yet — show the gross posted budget rather
  // than a helpr-specific net-pay figure. Drop a whole-dollar amount's
  // trailing ".00" so round prices ($126) read cleaner than the cents-laden
  // ones that genuinely need them ($85.50) — cents shown only when non-zero.
  const amountCents = Math.round((showBudget ? job.budget : netEarnings) * 100);
  const earnings = amountCents % 100 === 0 ? String(amountCents / 100) : (amountCents / 100).toFixed(2);
  const catStyle = categoryColors[job.category] || categoryColors.other;

  // Freshness signal: a job posted within the last 48h gets a "New" chip in
  // the meta row so a browsing guest sees the feed is live, not stale.
  const isNew = differenceInHours(new Date(), new Date(job.created_at)) < 48;

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
  const ratingDisplay = (job.posterReviewCount ?? 0) > 0 ? job.posterAvgRating?.toFixed(1) : null;

  // Warm JobDetailDialog's two head-count queries in the ~80ms gap
  // between touchstart and click on mobile — by the time the dialog's
  // own useEffect fires the same queries, the request path (auth,
  // RLS, PostgREST plan) is already hot. Hook is no-op'd for guests:
  // their tap goes to /signup, not the dialog. Mouse/keyboard users
  // get the same warm-up via the hook's onMouseEnter handler.
  const prefetchHandlers = usePrefetchOnTouch(() =>
    prefetchJobDialog(job.id, job.customer_id),
  );

  // In the guest variant the card is wrapped in a /signup <Link> by the
  // caller (Jobs.tsx), so the card root must NOT be a nested interactive
  // element — drop role/tabIndex/handlers and let the Link own the tap.
  const interactiveProps = isGuest
    ? {}
    : {
        onClick: () => onSelect(job),
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `View ${job.title} — $${job.budget}`,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(job);
          }
        },
        ...prefetchHandlers,
      };

  return (
    <div
      style={{ animationDelay: entryDelay, animationFillMode: "both" }}
      className="animate-fade-in group relative rounded-2xl border border-border/60 bg-card cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      {...interactiveProps}
    >
      {/* Clipped inner surface — rounds the rail, body, and guest CTA to
          the card shape. The category tab + rail both live inside this clip
          so they share the card's rounded top-left corner and read as one
          continuous shape. */}
      <div className="relative rounded-2xl overflow-hidden">
        {/* Category rail — vertical color stripe down the left edge. The
            tab below sits flush on top of it (same left edge) so the tab's
            flat left side flows straight into the rail with no gap. */}
        <span
          aria-hidden
          className={`absolute left-0 top-0 bottom-0 w-1.5 ${catStyle.dot}`}
        />
        {/* Category tab — anchored at the top-left, flat left edge (squared)
            continuing the rail, rounded pill nose on the right. The poster
            avatar moved to the job-detail view (JobPosterCard) so the feed
            card stays uncluttered. */}
        <span
          className={`absolute top-0 left-0 z-20 inline-flex items-center gap-1 pl-3 pr-2.5 py-1 rounded-l-none rounded-br-lg rounded-tr-none border-b border-r text-[10px] font-semibold leading-none shadow-sm ${catStyle.badge}`}
        >
          <CategoryIcon
            category={job.category}
            aria-hidden
            className="w-2.5 h-2.5 shrink-0"
            strokeWidth={2.25}
          />
          <span className="font-serif italic">{categoryLabels[job.category] || job.category}</span>
        </span>
        <div className="w-full px-3.5 pt-6 pb-2.5">
        {/* Title leads the top row and wraps to at most two lines (never
            cut off mid-word); the price tile sits opposite it. */}
        <div className="flex items-center justify-between gap-3">
          <h3
            className="font-display italic font-bold text-foreground leading-tight line-clamp-2 flex-1 min-w-0"
            style={{
              fontSize: "1.05rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {job.title}
          </h3>

          {/* Right column: price tile with Boosted / Urgent badges
              overlapping its top edge. */}
          <div className="relative shrink-0 flex flex-col items-end">
          {/* Badge cluster — both Boosted and Urgent sit at the top-right
              corner of the price tile. Stacked horizontally with Urgent
              (alarm cue) inner-most so it reads first when both apply. */}
          {(job.isBoosted || job.is_urgent) && (
            // Sits just inside the card's rounded edge so the cluster
            // isn't clipped by the root `overflow-hidden` (which is kept
            // so the colored category rail stays inside the rounded
            // corners). Previously `-top-2 -right-2` got chopped.
            <div className="absolute -top-1 -right-1 z-10 flex items-center gap-1">
              {job.isBoosted && (
                <span
                  aria-label="Boosted"
                  className="boosted-shimmer boosted-pulse inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider"
                  style={{
                    color: "color-mix(in srgb, hsl(var(--gold-warm)) 58%, #000 42%)",
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
              {job.is_urgent && (() => {
                // Urgent badge doubles as a liquidity signal — when the
                // poster attached an urgent_fee, the badge spells the
                // bonus out ("+$15 URGENT") so the helpr sees the extra
                // pay, not just an alarm cue. Falls back to plain
                // "URGENT" when no bonus was set.
                const bonus = Number(job.urgent_fee ?? 0);
                // At most one looping animation per card: Boosted (a paid
                // promotion) is the higher-priority signal, so when a job
                // is both Boosted and Urgent the Urgent badge stays static
                // — it's still fully present, just not a second animation
                // competing for the eye.
                const urgentAnimates = !job.isBoosted;
                return (
                  <span
                    aria-label={bonus > 0 ? `Urgent — $${bonus.toFixed(0)} bonus` : "Urgent"}
                    className={`${urgentAnimates ? "urgent-pulse " : ""}inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[8px] font-bold uppercase tracking-wider`}
                    style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
                  >
                    <Zap className="w-2.5 h-2.5 text-accent fill-accent" />
                    {bonus > 0 ? `+$${bonus.toFixed(0)} Urgent` : "Urgent"}
                  </span>
                );
              })()}
            </div>
          )}
          {/* Price chip — quiet flat warm-parchment tint with a single
              hairline border (no emboss), so the job title leads the card
              and the price sits as a calm secondary figure. */}
          <div
            className="flex flex-col items-center px-2.5 py-1.5 rounded-ds-md"
            style={{
              background: "hsl(38 34% 94%)",
              border: "0.5px solid hsl(var(--bark) / 0.18)",
            }}
          >
            <span
              className="font-display leading-none tabular-nums"
              style={{
                fontWeight: 800,
                fontSize: "0.95rem",
                color: "color-mix(in srgb, hsl(var(--bark)) 86%, #000 14%)",
                letterSpacing: "-0.02em",
              }}
            >
              {/* Literal `$` glyph (not the lucide icon) pulled tight to the
                  digits so the amount reads as one confident figure — the
                  icon left a visible "$ 85.50" gap. Sized close to the digits
                  (0.82em) and near-baseline so the sign and number read as one
                  matched price tag rather than a tiny raised superscript. */}
              <span
                style={{ fontSize: "0.82em", verticalAlign: "0.02em", marginRight: "0.5px" }}
              >
                $
              </span>
              {earnings}
            </span>
            {!showBudget && (job.urgent_fee ?? 0) > 0 && (
              <span
                className="font-sans font-semibold mt-0.5 text-[10px] tracking-[0.04em]"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                incl. ${Number(job.urgent_fee).toFixed(0)} urgent bonus
              </span>
            )}
            {/* "You earn" disambiguates the helpr's net take-home from the
                gross posted budget, so it stays. The guest/poster "Budget"
                caption was dropped — the figure is self-evidently the posted
                budget there, and repeating the word down every card was noise
                that also made the price tile tower over one-line titles. */}
            {!showBudget && (
              <span
                className="text-[9px] uppercase mt-0.5 font-sans"
                style={{
                  color: "hsl(45 8% 64%)",
                  letterSpacing: "0.1em",
                  fontWeight: 600,
                }}
              >
                You earn
              </span>
            )}
          </div>
          </div>
        </div>

        {/* Meta row — category lives in the badge above, so this leads
            with location. */}
        <div className="mt-2 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[10.5px] text-muted-foreground leading-tight">
            {isNew && (
              <span
                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                style={{
                  background: "hsl(var(--burnt-sienna) / 0.12)",
                  color: "hsl(var(--burnt-sienna))",
                  letterSpacing: "0.06em",
                }}
              >
                New
              </span>
            )}
            <span className="flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate max-w-[110px] font-serif italic">{cityState}</span>
            </span>
            <span className="opacity-30">·</span>
            {/* Date and time are separate meta chips, each with its own icon
                (calendar / clock), matching the weight of the rest of the row.
                "Due" is dropped — the date is self-evidently the day the work
                must be done. The time chip only renders when a start_time is set. */}
            {!job.date_needed && !job.start_time ? (
              <span className="flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 shrink-0" />
                <span className="font-serif italic">Flexible</span>
              </span>
            ) : (
              <>
                {job.date_needed && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5 shrink-0" />
                    <span className="font-serif italic">
                      {parseLocalDate(job.date_needed).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  </span>
                )}
                {job.start_time && (
                  <>
                    <span className="opacity-30">·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span className="font-serif italic">{formatTime12(job.start_time)}</span>
                    </span>
                  </>
                )}
              </>
            )}
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
            {/* "Posted X ago" was dropped from the row — it was the same on
                every card (no decision value) and added a third wrapped line
                on small phones. Freshness is still signalled by the "New"
                chip (<48h) at the head of the row. */}
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
              // Same sub-360px guard as the age chip: hide the
              // recurring chip on the smallest phones so the meta
              // row stays on two lines max.
              <>
                <span className="opacity-30 hidden [@media(min-width:360px)]:inline">·</span>
                <span className="hidden [@media(min-width:360px)]:flex items-center gap-1">
                  <Repeat className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
                  <span className="font-serif italic">
                    {job.recurrence_interval || "Recurring"}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>

      {/* Guest CTA — a persistent (never hover-gated) "Sign up to apply"
          affordance pinned to the card foot. Phones have no hover state,
          so the old opacity-0/group-hover overlay was permanently
          invisible and unclickable on the native app. The whole card is
          also a /signup link (see the wrapping <a> in Jobs.tsx). */}
      {isGuest && (
        <div
          className="flex items-center justify-center gap-1.5 px-3.5 py-2 border-t"
          style={{
            borderColor: "hsl(var(--bark) / 0.12)",
            background: "hsl(var(--bark) / 0.04)",
          }}
        >
          <Lock className="w-3 h-3" style={{ color: "hsl(var(--primary))" }} />
          <span
            className="font-sans font-bold uppercase text-[10px]"
            style={{ color: "hsl(var(--primary))", letterSpacing: "0.08em" }}
          >
            Sign up to apply
          </span>
        </div>
      )}
      </div>
    </div>
  );
};

// Memoized: the Dashboard feed re-renders on unrelated state changes
// (banners, dialogs, etc.). With referentially-stable props from
// BrowseTasksFeed, React.memo skips re-rendering cards whose job data
// and per-card flags (isExpanded / isSaved) haven't changed.
const MemoizedJobCard = memo(JobCard);
MemoizedJobCard.displayName = "JobCard";

export default MemoizedJobCard;
