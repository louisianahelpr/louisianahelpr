import { memo, useCallback, useRef, useState, type KeyboardEvent } from "react";
import {
  MapPin, Calendar, Clock, Star, Zap, Rocket, Timer, Users, Repeat, Lock, Heart, CheckCheck, Bookmark,
} from "lucide-react";
import { hapticLight, hapticMedium, hapticSuccess } from "@/lib/haptics";
import { useLongPress } from "@/hooks/useLongPress";
import { formatDistanceToNow, differenceInHours } from "date-fns";

import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { parseLocalDate } from "@/lib/dateUtils";
import { formatTime12 } from "@/components/TimePickerSelect";
import { getCity } from "@/lib/locationUtils";
import { haversineMiles } from "@/lib/geo";
import { getParishCentroid, getCentroidFromLocation } from "@/lib/parishCentroids";
import { usePrefetchOnTouch } from "@/lib/usePrefetchOnTouch";
import { useDrivingTime } from "@/hooks/useDrivingTime";
import { prefetchJobDialog } from "./prefetchJobDialog";
import { JobPrice } from "./JobPrice";
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
  /**
   * Viewer's cached location (from useUserLocation, session-cached). When
   * present + the job resolves to a parish centroid, the meta row leads
   * with a "~X mi" distance pill. Hidden silently otherwise so a denied
   * location prompt never makes the card look broken.
   */
  userLat?: number | null;
  userLng?: number | null;
  /**
   * Long-press handler — when defined, a 500ms press on the card opens
   * a quick-action sheet (Save / Hide / Share / Report) instead of the
   * detail dialog. The dashboard owner (Dashboard.tsx) supplies this;
   * guest mode leaves it undefined so the card behaves the same way it
   * did before (tap → /signup).
   */
  onLongPress?: (jobId: string) => void;
}

// Category colors apply ONLY to the category badge pill at the top of
// the card. The job title itself stays in `text-foreground` (deep
// charcoal) across all categories so the brand reads consistently and
// the colored badge stays the single accent in the row. The `accent`
// gradient tints are kept for the boosted/recommended highlight strip.
const JobCard = ({ job, effectiveFee, currentUserId: _currentUserId, showApply: _showApply = true, onSelect, index = 0, isExpanded: _isExpanded = false, onToggleExpand: _onToggleExpand, isSaved: _isSaved = false, onToggleSave: _onToggleSave, variant = "default", guestPricing = false, userLat = null, userLng = null, onLongPress }: JobCardProps) => {
  const isGuest = variant === "guest";

  // Double-tap-to-save (Instagram-style). A single tap still opens the
  // detail view, but we delay it ~280ms so a fast second tap can claim
  // the gesture as a "save" instead. Double-tap only ever SAVES — it
  // never un-saves — so a quick double-tap can't accidentally remove a
  // bookmark the user already has. The heart-pop overlay + success
  // haptic only fire when the tap actually adds the save.
  const DOUBLE_TAP_MS = 280;
  const [showHeart, setShowHeart] = useState(false);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);
  // Keep the latest isSaved in a ref so the tap handler reads fresh state
  // without re-creating itself (and re-spreading on the card) every render.
  const isSavedRef = useRef(_isSaved);
  isSavedRef.current = _isSaved;

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      // Second tap inside the window → double-tap: cancel the pending
      // single-tap navigation and save (only if not already saved).
      lastTapRef.current = 0;
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      if (_onToggleSave) {
        // Double-tap only ever SAVES — only toggle when not already saved
        // (so a quick double-tap can't accidentally un-bookmark). The
        // heart-pop + success haptic fire either way as confirmation.
        if (!isSavedRef.current) _onToggleSave(job.id, true);
        hapticSuccess();
        setShowHeart(true);
      } else {
        hapticLight();
      }
      return;
    }
    lastTapRef.current = now;
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      hapticLight();
      onSelect(job);
    }, DOUBLE_TAP_MS);
  }, [job, onSelect, _onToggleSave]);

  // Long-press hook — fires onLongPress after 500ms hold, falls through
  // to a normal tap (onSelect) when the user lifts before the threshold.
  // We always create the hook to keep the component's render shape
  // stable across renders, but ignore its props when there's no handler.
  // The tap is routed through handleTap so the double-tap-to-save gesture
  // works alongside the long-press quick-action sheet.
  const longPress = useLongPress({
    threshold: 500,
    onLongPress: () => {
      if (onLongPress) {
        hapticMedium();
        onLongPress(job.id);
      }
    },
    onTap: handleTap,
  });
  // Show the gross posted budget (vs the helper's net take-home) whenever
  // the full guest variant is active OR the lighter guestPricing flag is set.
  const showBudget = isGuest || guestPricing;
  // Per-helpr split count for the shared JobPrice element. The net-take-home
  // math itself now lives in JobPrice (the single money component), so the
  // card and detail view can never disagree.
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const catStyle = categoryColors[job.category] || categoryColors.other;

  // Freshness signal: a job posted within the last 30 minutes gets a "New"
  // chip — aligned with the Pro/Elite early-access window so the badge
  // appears exactly when fresh jobs flow into the feed for paid subscribers.
  // After 30 min the badge drops away and all helpers can see the job.
  const isNew = Date.now() - new Date(job.created_at).getTime() < 30 * 60_000;

  const cityState = getCity(job.location);

  // Distance pill — uses the viewer's cached session location (lifted in
  // from Dashboard via useUserLocation, which caches at the module level
  // for 5 minutes) and the job's parish centroid. open_jobs_browse masks
  // precise coords, so we fall back to parish-level granularity ("~X mi")
  // rather than a misleading street-precise number. Renders silently as
  // null when either side is missing.
  const destCentroid =
    userLat != null && userLng != null
      ? getParishCentroid((job as { parish?: string | null }).parish) ??
        getCentroidFromLocation(job.location)
      : null;
  const distanceMiles =
    destCentroid && userLat != null && userLng != null
      ? haversineMiles(userLat, userLng, destCentroid.lat, destCentroid.lng)
      : null;
  const distanceLabel = distanceMiles == null
    ? null
    : distanceMiles < 1
      ? "<1 mi"
      : distanceMiles < 10
        ? `${distanceMiles.toFixed(1)} mi`
        : `${Math.round(distanceMiles)} mi`;
  // Driving-time estimate — MapKit Directions when ready, heuristic
  // otherwise. Combined with the distance pill below to read "12 min ·
  // 4.5 mi" instead of just distance, which is more useful for a helpr
  // deciding whether a job is worth the drive.
  const drivingMinutes = useDrivingTime(
    userLat,
    userLng,
    destCentroid?.lat ?? null,
    destCentroid?.lng ?? null,
    distanceMiles,
  );
  const drivingLabel = drivingMinutes == null
    ? null
    : drivingMinutes < 60
      ? `${drivingMinutes} min`
      : `${Math.floor(drivingMinutes / 60)}h ${drivingMinutes % 60}m`;

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
  // With onLongPress supplied, the press/release handlers from
  // useLongPress own both tap (fires onSelect on short release) and
  // long-press (fires the quick-action sheet at threshold). Without it
  // we fall back to a plain onClick so the gesture surface stays simple.
  const interactiveProps = isGuest
    ? {}
    : onLongPress
      ? {
          ...longPress,
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `View ${job.title} — $${job.budget}`,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              hapticLight();
              onSelect(job);
            }
          },
          ...prefetchHandlers,
        }
      : {
          onClick: handleTap,
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `View ${job.title} — $${job.budget}`,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              hapticLight();
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
          {/* Freshness lives in the category tab — a quiet burnt-sienna dot
              + "New" — so it reads as metadata at the corner and never
              competes with the job title for the eye. */}
          {isNew && (
            <span className="inline-flex items-center gap-1 ml-0.5" aria-label="New listing">
              <span
                aria-hidden
                className="w-1 h-1 rounded-full"
                style={{ background: "hsl(var(--burnt-sienna))" }}
              />
              <span
                className="font-sans font-bold uppercase not-italic"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.06em", fontSize: "8px" }}
              >
                New
              </span>
            </span>
          )}
        </span>
        <div className="w-full px-3.5 pt-6 pb-2.5">
        {/* Title leads the top row and wraps to at most two lines (never
            cut off mid-word); the price tile sits opposite it. */}
        <div className="flex items-center justify-between gap-3">
          {/* Title leads its row cleanly — the "New" freshness marker lives
              in the category tab at the top-left corner, so nothing crowds
              the headline. */}
          <div className="flex items-start gap-1.5 flex-1 min-w-0">
            <h3
              className="font-display italic font-bold text-foreground leading-tight line-clamp-2 min-w-0"
              style={{
                fontSize: "1.05rem",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.02em",
              }}
            >
              {job.title}
            </h3>
          </div>

          {/* Right column: price tile with Boosted / Urgent badges
              overlapping its top edge. */}
          <div className="relative shrink-0 flex flex-col items-end">
          {/* Badge cluster — Boosted, Urgent, and Instant Book sit at the
              top-right corner of the price tile. Stacked horizontally with
              Urgent inner-most so it reads first when both apply. */}
          {(job.isBoosted || job.is_urgent || (job as { instant_book?: boolean }).instant_book || (job as { pricing_mode?: string }).pricing_mode === "accept_bids") && (
            // Sits just inside the card's rounded edge so the cluster
            // isn't clipped by the root `overflow-hidden` (which is kept
            // so the colored category rail stays inside the rounded
            // corners). Previously `-top-2 -right-2` got chopped.
            <div className="absolute -top-1 -right-1 z-10 flex items-center gap-1">
              {(job as { pricing_mode?: string }).pricing_mode === "accept_bids" && (
                <span
                  className="text-ds-10 font-sans font-semibold uppercase px-1.5 py-0.5 rounded-ds-sm"
                  style={{ background: "hsl(var(--bark) / 0.1)", color: "hsl(var(--bark))", letterSpacing: "0.06em", border: "0.5px solid hsl(var(--bark) / 0.3)" }}
                >
                  Open bids
                </span>
              )}
              {(job as { instant_book?: boolean }).instant_book && (
                <span
                  aria-label="Instant book — apply and get confirmed immediately"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider"
                  style={{
                    background: "hsl(var(--sage) / 0.15)",
                    color: "hsl(var(--sage))",
                    border: "0.5px solid hsl(var(--sage) / 0.45)",
                  }}
                >
                  <CheckCheck className="w-2.5 h-2.5" strokeWidth={2.25} />
                  Instant
                </span>
              )}
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
                    className={`${urgentAnimates ? "urgent-pulse " : ""}inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[8px] font-bold uppercase tracking-wider`}
                    style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
                  >
                    <Zap className="w-2.5 h-2.5 text-accent fill-accent" />
                    {bonus > 0 ? `+$${bonus.toFixed(0)} Urgent` : "Urgent"}
                  </span>
                );
              })()}
            </div>
          )}
          {/* Price chip — the single shared JobPrice element (collapsed
              "You earn $72", tap to reveal "Budget $80 − 10% fee"), so the
              same job never shows two different numbers across surfaces. */}
          <JobPrice
            budget={job.budget}
            effectiveFee={effectiveFee}
            urgentFee={job.urgent_fee ?? 0}
            helpersNeeded={helpersCount}
            showBudget={showBudget}
            variant="chip"
          />
          </div>
        </div>

        {/* Meta row — category lives in the badge above, so this leads
            with location. */}
        <div className="mt-2 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[10.5px] text-muted-foreground leading-tight">
            <span className="flex items-center gap-1 min-w-0">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate max-w-[110px] font-serif italic">{cityState}</span>
            </span>
            {distanceLabel && (
              <span
                aria-label={
                  drivingLabel
                    ? `Approximately ${drivingLabel} drive, ${distanceLabel} away`
                    : `Approximately ${distanceLabel} away`
                }
                className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full font-sans font-semibold whitespace-nowrap"
                style={{
                  fontSize: "9.5px",
                  letterSpacing: "0.02em",
                  background: "hsl(var(--burnt-sienna) / 0.10)",
                  color: "hsl(var(--burnt-sienna))",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                }}
              >
                {drivingLabel ? `${drivingLabel} · ${distanceLabel}` : distanceLabel}
              </span>
            )}
            <span className="opacity-30">·</span>
            {/* Date + time live in ONE no-wrap group so the time can never
                drop to its own line on its own — the pair moves together.
                "Due" is dropped — the date is self-evidently the day the work
                must be done. The time chip only renders when a start_time is set. */}
            {!job.date_needed && !job.start_time ? (
              <span className="flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 shrink-0" />
                <span className="font-serif italic">Flexible</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-x-2">
                {job.date_needed && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5 shrink-0" />
                    <span className="font-serif italic whitespace-nowrap">
                      {parseLocalDate(job.date_needed).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  </span>
                )}
                {job.date_needed && job.start_time && <span className="opacity-30">·</span>}
                {job.start_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5 shrink-0" />
                    <span className="font-serif italic whitespace-nowrap">{formatTime12(job.start_time)}</span>
                  </span>
                )}
              </span>
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

      {/* Save / bookmark — surfaced ON the card (the double-tap-to-save
          gesture is undiscoverable, so a visible affordance backs it up).
          Only when a toggle handler is wired and not in the guest variant.
          ≥44px tap target; hapticLight on toggle. stopPropagation so the
          tap saves instead of opening the detail view. */}
      {!isGuest && _onToggleSave && (
        <button
          type="button"
          aria-label={_isSaved ? "Unsave job" : "Save job"}
          aria-pressed={_isSaved}
          onClick={(e) => {
            e.stopPropagation();
            hapticLight();
            _onToggleSave(job.id, !_isSaved);
          }}
          className="absolute bottom-1.5 right-1.5 z-20 inline-flex items-center justify-center w-11 h-11 rounded-full transition-transform active:scale-90"
          style={{ color: _isSaved ? "hsl(var(--primary))" : "hsl(var(--olivewood) / 0.45)" }}
        >
          <Bookmark
            className="w-4 h-4"
            strokeWidth={2}
            style={_isSaved ? { fill: "hsl(var(--primary))" } : undefined}
          />
        </button>
      )}

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

      {/* Double-tap-to-save heart pop — Instagram-style. Centered over the
          card, pops in then fades up over ~600ms. pointer-events-none so it
          never blocks taps; unmounts on animation end. */}
      {showHeart && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-30 animate-heart-pop"
          onAnimationEnd={() => setShowHeart(false)}
          style={{
            filter: "drop-shadow(0 4px 12px hsl(var(--burnt-sienna) / 0.45))",
          }}
        >
          <Heart
            className="w-20 h-20"
            strokeWidth={1.5}
            style={{
              color: "hsl(var(--burnt-sienna))",
              fill: "hsl(var(--burnt-sienna))",
            }}
          />
        </span>
      )}
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
