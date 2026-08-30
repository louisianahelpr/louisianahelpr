import { memo, useCallback, type KeyboardEvent } from "react";
import {
  MapPin, Calendar, Clock, Star, Zap, Rocket, Timer, Users, Repeat, CheckCheck,
} from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import { differenceInHours } from "date-fns";

import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { formatJobDate, formatTimeLeft } from "@/lib/dateUtils";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { earlyAccessDelayMs } from "@/lib/earlyAccess";
import { formatTime12 } from "@/components/TimePickerSelect";
import { getCity } from "@/lib/locationUtils";
import { haversineMiles } from "@/lib/geo";
import { getParishCentroid, getCentroidFromLocation } from "@/lib/parishCentroids";
import { usePrefetchOnTouch } from "@/lib/usePrefetchOnTouch";
import { useDrivingTime } from "@/hooks/useDrivingTime";
import { prefetchJobDialog } from "./prefetchJobDialog";
import { JobPrice, computeNet } from "./JobPrice";
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
   * Guest/read-only variant for the public Browse page. Makes the card body
   * inert and pins a persistent "Sign up to apply" CTA footer instead of a
   * silent whole-card tap. Pricing still shows the helper-side net "You earn"
   * take-home (driven by `effectiveFee`) — guests want to see what they'd
   * pocket. The signed-in Dashboard leaves this unset (behaviour unchanged).
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
   * Marks this card as one of the top relevance-matched picks. When true a
   * small, unobtrusive "Recommended" pill renders near the category label.
   * Only the first couple of recommended cards set this — the rest of the
   * feed leaves it false and shows no pill.
   */
  recommended?: boolean;
}

// Category colors apply ONLY to the category badge pill at the top of
// the card. The job title itself stays in `text-foreground` (deep
// charcoal) across all categories so the brand reads consistently and
// the colored badge stays the single accent in the row. The `accent`
// gradient tints are kept for the boosted/recommended highlight strip.
const JobCard = ({ job, effectiveFee, currentUserId: _currentUserId, showApply: _showApply = true, onSelect, index = 0, isExpanded: _isExpanded = false, onToggleExpand: _onToggleExpand, isSaved: _isSaved = false, onToggleSave: _onToggleSave, variant = "default", guestPricing = false, userLat = null, userLng = null, recommended = false }: JobCardProps) => {
  const isGuest = variant === "guest";

  // A tap always opens the job detail view. Saving lives behind the
  // bookmark control in the detail dialog — the card tap is reserved for
  // "show me more" so it never feels like the heart is hijacking the tap.
  const handleTap = useCallback(() => {
    hapticLight();
    onSelect(job);
  }, [job, onSelect]);

  // Show the gross posted budget (vs the helper's net take-home) whenever
  // the full guest variant is active OR the lighter guestPricing flag is set.
  // Net "You earn" take-home is the default for guests too (they're shown an
  // assumed fee tier via effectiveFee). Only the explicit `guestPricing` flag
  // forces the gross "Budget" figure — `variant="guest"` no longer does, so a
  // guest card can show take-home AND the "Sign up to apply" CTA together.
  const showBudget = guestPricing;
  // Per-helpr split count for the shared JobPrice element. The net-take-home
  // math itself now lives in JobPrice (the single money component), so the
  // card and detail view can never disagree.
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  // Announce the SAME figure the visible JobPrice chip shows: net take-home by
  // default, gross budget only on guest/poster surfaces. Reusing computeNet
  // keeps the screen-reader label from drifting to the gross budget while
  // sighted users see the lower net number.
  // formatPriceFloor on the net branch, matching what the chip renders —
  // a screen-reader user must hear the same take-home a sighted user reads.
  // This said formatPriceExact while JobPrice's visible chip floored, so the
  // two announced different numbers for the same job ("$57.66" heard vs "$57"
  // seen). The chip is the authority: floor both.
  const priceAria = showBudget
    ? `$${formatPrice(job.budget)}`
    : `$${formatPriceFloor(computeNet(job.budget, effectiveFee, job.urgent_fee ?? 0, helpersCount).netEarnings)}`;
  const catStyle = categoryColors[job.category] || categoryColors.other;

  // Freshness signal: a job still inside the early-access window gets a "New"
  // chip. DERIVED from the shared perk value (the free-tier delay — 20 min)
  // rather than restated: this used to hardcode 30 min next to a comment
  // claiming alignment with the 20-min window, so the badge outlived the
  // exclusivity it advertised. Subscribers see the badge while the job is
  // still early-access; it drops exactly when every helper can see the job.
  const isNew = Date.now() - new Date(job.created_at).getTime() < earlyAccessDelayMs(null);

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

  // How long the work takes — jobs.estimated_hours, collected on every post
  // and returned by BOTH feed sources (the `open_jobs_browse` view the
  // signed-in dashboard reads and the `get_ranked_open_jobs` RPC the public
  // /jobs page reads). It varies per job (2h vs 8h changes whether a helpr
  // even considers it), which is exactly what the expiry countdown it
  // replaces did NOT do.
  //
  // The date/time group deliberately shows WHEN THE JOB IS — `date_needed` and
  // `start_time`. An estimated-duration chip ("~6h") briefly lived in this slot
  // while every seeded job had a NULL `start_time` and the row looked empty;
  // that was solving the symptom. Duration still has a home on the job detail
  // (JobStatTiles' "Estimated" tile) — the card answers "when", not "how long".
  // Expiry — an URGENCY signal, not a permanent meta line.
  //
  // Every job is created with the same 14-day window, so an unconditional
  // countdown printed the identical string ("14 days left") on literally
  // every card in the feed: zero decision value, and it consumed the one
  // no-wrap meta slot a browsing helpr actually reads. It only becomes
  // information once the window is genuinely closing — so it now renders
  // inside a 48h horizon (or once expired) and stays silent before that.
  // Under 24h it also goes destructive-red, the same tier as before.
  const expiresAt = job.expires_at ? new Date(job.expires_at) : null;
  const hoursToExpiry = expiresAt ? differenceInHours(expiresAt, new Date()) : null;
  const isExpired = !!expiresAt && expiresAt <= new Date();
  const showExpiry = !!expiresAt && (isExpired || (hoursToExpiry !== null && hoursToExpiry < 48));
  const expiryText = !showExpiry || !expiresAt
    ? null
    : isExpired
      ? "Expired"
      : formatTimeLeft(expiresAt);
  const isExpiringSoon = showExpiry && (isExpired || (hoursToExpiry !== null && hoursToExpiry < 24));

  // Stagger entry via CSS animation-delay — avoids pulling framer-motion into
  // the dashboard's hot list path (saves ~42KB on iOS cold start).
  const entryDelay = `${Math.min(index * 70, 500)}ms`;
  // The poster's average rating used to render here as a star + number.
  // Removed (owner, 2026-08-27) under the same rule already applied to the
  // "Verified" cue below: poster attributes belong on the poster's profile
  // and the job detail view, not on a scanning list card whose job is place /
  // date / time / price, not who posted it.

  // Warm JobDetailDialog's two head-count queries in the ~80ms gap
  // between touchstart and click on mobile — by the time the dialog's
  // own useEffect fires the same queries, the request path (auth,
  // RLS, PostgREST plan) is already hot. Hook is no-op'd for guests:
  // their tap goes to /signup, not the dialog. Mouse/keyboard users
  // get the same warm-up via the hook's onMouseEnter handler.
  const prefetchHandlers = usePrefetchOnTouch(() =>
    prefetchJobDialog(job.id, job.customer_id),
  );

  // In the guest variant the card is wrapped in an outer interactive
  // element by the caller (a <button> in Jobs.tsx that opens the preview),
  // so the card root must NOT be a nested interactive element — drop
  // role/tabIndex/handlers and let the wrapper own the tap.
  const interactiveProps = isGuest
    ? {
        // Guest: the whole card routes to /signup on tap (onSelect is
        // requireSignup on the guest dashboard; a noop under Jobs.tsx, which
        // wraps the card in its own <Link>). Plain onClick only — no
        // role/tabIndex — so the Jobs.tsx <Link> wrapper doesn't end up with a
        // nested interactive element.
        onClick: () => { hapticLight(); onSelect(job); },
        ...prefetchHandlers,
      }
    : {
        onClick: handleTap,
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `View ${job.title} — ${priceAria}`,
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
      // h-full: the card is a grid item in both feeds (guest /jobs and the
      // authed browse grid). CSS Grid stretches the ITEM to the tallest in its
      // row, but the card sized to its own content instead, so a two-line title
      // left its neighbour visibly shorter and rows looked ragged. h-full makes
      // the card actually fill the cell it was already given. In a non-stretch
      // parent (auto height) this resolves to auto, so single-card contexts are
      // unaffected.
      className="motion-safe:animate-fade-in group relative h-full rounded-2xl border border-border/60 bg-card cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      {...interactiveProps}
    >
      {/* Clipped inner surface — rounds the rail, body, and guest CTA to
          the card shape. The category tab + rail both live inside this clip
          so they share the card's rounded top-left corner and read as one
          continuous shape. */}
      <div className="relative h-full rounded-2xl overflow-hidden">
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
        <div className="absolute top-0 left-0 z-20 flex items-stretch gap-1">
          <span
            className={`inline-flex items-center gap-1 pl-3 pr-2.5 py-1 rounded-l-none rounded-br-lg rounded-tr-none border-b border-r text-ds-10 font-semibold leading-none shadow-sm ${catStyle.badge}`}
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
                  className="w-1.5 h-1.5 rounded-full motion-safe:animate-pulse"
                  style={{
                    background: "hsl(var(--burnt-sienna))",
                    boxShadow: "0 0 0 2px hsl(var(--burnt-sienna) / 0.22), 0 0 6px hsl(var(--burnt-sienna) / 0.55)",
                  }}
                />
                <span
                  className="font-sans font-bold uppercase not-italic text-ds-9"
                  style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.07em",}}
                >
                  New
                </span>
              </span>
            )}
          </span>
          {/* Recommended — sits to the RIGHT of the category tab in the same
              tab style (a relevance chip hanging from the top edge), instead of
              an extra row above the title that pushed the title down. */}
          {recommended && (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-b-lg border-b border-r text-ds-10 font-semibold leading-none shadow-sm pointer-events-none"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                color: "hsl(var(--burnt-sienna))",
                borderColor: "hsl(var(--burnt-sienna) / 0.20)",
              }}
            >
              <Star
                className="w-2.5 h-2.5 shrink-0"
                strokeWidth={2}
                style={{ fill: "hsl(var(--burnt-sienna) / 0.3)" }}
              />
              <span className="font-sans font-semibold leading-none">Recommended</span>
            </span>
          )}
        </div>
        {/* Status corner — mirrors the category tab on the opposite
            (top-right) corner. Shows the single highest-priority signal as
            a clean accent instead of a cluster stacked over the price. */}
        {(() => {
          const corner =
            "absolute top-0 right-0 z-20 inline-flex items-center gap-1 pl-2.5 pr-3 py-1 rounded-bl-lg border-b border-l text-ds-9 font-bold uppercase leading-none shadow-sm";
          if (job.isBoosted)
            return (
              <span
                className={`boosted-pulse ${corner}`}
                aria-label="Boosted"
                style={{
                  // --boost, not gold (P1). A --boost token already existed for
                  // exactly this chip; painting it gold made a paid promotion
                  // look identical to a Pro badge, which is why gold stopped
                  // signalling status. 25° vs 38° — barely a shade apart, but
                  // now the two mean different things.
                  color: "hsl(var(--boost-ink))",
                  background: "hsl(var(--boost-tint) / 0.16)",
                  borderColor: "hsl(var(--boost-tint) / 0.5)",
                  letterSpacing: "0.05em",
                }}
              >
                <Rocket className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} style={{ color: "hsl(var(--boost-tint))", fill: "hsl(var(--boost-tint) / 0.35)" }} />
                Boosted
              </span>
            );
          if (job.is_urgent) {
            const bonus = Number(job.urgent_fee ?? 0);
            return (
              <span
                className={`urgent-pulse ${corner}`}
                aria-label={bonus > 0 ? `Urgent — $${formatPrice(bonus)} bonus` : "Urgent"}
                style={{
                  color: "hsl(var(--accent))",
                  background: "hsl(var(--accent) / 0.15)",
                  borderColor: "hsl(var(--accent) / 0.5)",
                  letterSpacing: "0.05em",
                }}
              >
                <Zap className="w-2.5 h-2.5 shrink-0" style={{ color: "hsl(var(--accent))", fill: "hsl(var(--accent))" }} />
                {/* Just "Urgent", not "+$10 Urgent" (owner, 2026-08-30: the
                    dollar prefix read as "does the helper get this on TOP of
                    the posted budget?" — ambiguous, since the bonus is
                    already folded into the net take-home JobPrice shows).
                    The bonus amount is still in the aria-label for anyone
                    who needs the detail; it just isn't the visible claim. */}
                Urgent
              </span>
            );
          }
          if ((job as { instant_book?: boolean }).instant_book)
            return (
              <span
                className={corner}
                aria-label="Instant book"
                style={{ color: "hsl(var(--sage))", background: "hsl(var(--sage) / 0.15)", borderColor: "hsl(var(--sage) / 0.45)", letterSpacing: "0.05em" }}
              >
                <CheckCheck className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
                Instant
              </span>
            );
          return null;
        })()}
        <div className="w-full px-3.5 pt-6 pb-2.5">
        {/* Title + price share the top row — price chip is vertically
            centered against the title so on a two-line title it sits in the
            middle. The location/date/time meta spans the full card width
            below. Titles clamp to two lines — see the note on the h3. */}
        <div className="flex items-center justify-between gap-3">
          <h3
            // TWO lines, not one (owner). Clamping by LINE rather than by a
            // character count is still the right mechanism — a fixed character
            // limit can't know the column width, and an em-heavy title
            // ("Assemble IKEA PAX wardrobe + dresser") wraps well before a
            // digit-heavy one of equal length. But one line was clamping the
            // one thing the card is about: at 375 the feed read "Replace a
            // leaking kitchen…" and "Grocery run and pharmacy…", so the reader
            // had to open a job to find out what it was.
            //
            // Two lines keeps every card exactly the same height — which is
            // what the clamp was protecting — and fits almost every real title
            // whole. `min-w-0` is what lets it shrink inside the flex row at
            // all.
            className="text-headline-card flex-1 font-display italic font-bold text-foreground leading-tight line-clamp-2 min-w-0"
            style={{
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {job.title}
          </h3>
          <JobPrice
            budget={job.budget}
            effectiveFee={effectiveFee}
            urgentFee={job.urgent_fee ?? 0}
            helpersNeeded={helpersCount}
            showBudget={showBudget}
            variant="chip"
            className="shrink-0"
          />
        </div>

        {/* Meta row — category lives in the badge above, so this leads
            with location. */}
        <div className="mt-2 flex flex-col gap-1 text-ds-11 text-muted-foreground leading-tight">
          {/* Row 1 — where + when. The expiry countdown deliberately does NOT
              live here: this row is flex-nowrap, so every extra chip steals
              width from the city, which has min-w-0 and collapses first. With
              the countdown competing, cities rendered as "Hou…", "Gonz…",
              "Brouss…" on a 402pt phone while cards without a countdown showed
              "Shreveport" and "New Orleans" in full — i.e. the single most
              important local-marketplace signal was the first thing dropped.
              Urgency now gets its own row below, which is also what the
              My Posts / My Jobs cards already do. */}
          {/* STAYS ON ONE LINE — never wraps (owner: "should never go to a
              second line. all job cards should remain same size always").
              A wrapping row was tried and rejected: it fixed the truncation but
              made a group-job card one line taller than every card around it,
              and equal card height is the stronger rule. Feed cards are scanned
              as a column, so a single tall card reads as a layout break.
              The width the group-job chip needs is bought back below instead —
              see the `is_group_job` chip, which drops its separator and rides
              tighter than the rest of the row. */}
          <div className="flex items-center gap-x-2 flex-nowrap overflow-hidden">
            <span className="flex items-center gap-1 min-w-0">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {/* min-w floor: the row above moved urgency out precisely so the
                  city would stop collapsing first, but a rating chip still
                  squeezed it — adjacent cards in one feed rendered "Lafayette",
                  "Lafayet…" and "Lafay…" for the same parish. The floor keeps
                  the parish recognisable; the cap still bounds it on wide cards. */}
              <span className="truncate min-w-[6ch] max-w-[150px] font-sans">{cityState}</span>
            </span>
            {distanceLabel && (
              <span
                aria-label={
                  drivingLabel
                    ? `Approximately ${drivingLabel} drive, ${distanceLabel} away`
                    : `Approximately ${distanceLabel} away`
                }
                className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full font-sans font-semibold whitespace-nowrap text-ds-9"
                style={{
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
            {/* Date + time + duration live in ONE no-wrap group so the "when"
                of a job can never be split across lines — the trio moves
                together. "Due" is dropped — the date is self-evidently the day
                the work must be done. The start-time chip only renders when a
                start_time is set (most posts leave it blank); the duration
                chip fills that slot from estimated_hours, which every post
                collects, so the row always answers "how much of my day?". */}
            <span className="inline-flex items-center gap-x-2">
              {!job.date_needed && !job.start_time ? (
                <span className="flex items-center gap-1">
                  <Calendar className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-sans">Flexible</span>
                </span>
              ) : (
                <>
                  {job.date_needed && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-2.5 h-2.5 shrink-0" />
                      <span className="font-sans whitespace-nowrap">
                        {formatJobDate(job.date_needed)}
                      </span>
                    </span>
                  )}
                  {job.date_needed && job.start_time && <span className="opacity-30">·</span>}
                  {job.start_time && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span className="font-sans whitespace-nowrap">{formatTime12(job.start_time)}</span>
                    </span>
                  )}
                </>
              )}
            </span>
            {/* No poster "Verified" cue here (owner, 2026-08-25: "Verified
                should not be here"). It competed with the meta a browsing
                Helpr actually decides on — place, date, time, rating — and
                verification is a POSTER attribute, surfaced on the poster's
                profile and in the job detail, not a property of the job in a
                scanning list. `posterIdVerified` stays on the type and in
                useDashboardData for those surfaces. */}
            {/* "Posted X ago" was dropped from the row — it was the same on
                every card (no decision value) and added a third wrapped line
                on small phones. Freshness is still signalled by the "New"
                chip (<30m) at the head of the row. */}
            {job.is_group_job && (
              // No leading "·" and a tighter gap than its siblings. Every chip
              // on this nowrap row is width the city does not get, and the city
              // is the only item that shrinks — so a multi-person job used to
              // render "Abbev." while single-helper cards next to it showed
              // "Abbeville" in full. Dropping the separator and halving the gap
              // returns ~14px to the parish for the cost of nothing legible:
              // the person icon already separates this from the time beside it.
              <span
                className="flex items-center gap-0.5 shrink-0 ml-0.5"
                style={{ color: "hsl(var(--primary))" }}
              >
                <Users className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} aria-label="Helprs needed" />
                <span className="font-sans font-medium">
                  {job.helpers_needed ?? 2}
                </span>
              </span>
            )}
            {job.is_recurring && (
              // Same sub-360px guard as the age chip: hide the
              // recurring chip on the smallest phones so the meta
              // row stays on two lines max.
              <>
                <span className="opacity-30 hidden [@media(min-width:360px)]:inline">·</span>
                <span className="hidden [@media(min-width:360px)]:flex items-center gap-1">
                  <Repeat className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
                  <span className="font-sans">
                    {job.recurrence_interval || "Recurring"}
                  </span>
                </span>
              </>
            )}
            {/* Urgency rides the SAME line as the rest of the meta (owner,
                2026-08-25: "1 day left should be in the same line as the stuff
                above"). It used to own row 2 because an unconditional
                "14 days left" printed on every card and made heights ragged —
                but the countdown is now gated to a 48h horizon, so it appears
                on a handful of cards rather than all of them, and the reason
                for the separate row went with it. whitespace-nowrap still
                keeps "1 day left" from breaking across two lines. */}
            {expiryText && (
              <>
                <span className="opacity-30">·</span>
                <span
                  className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}
                >
                  <Timer className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-sans whitespace-nowrap">{expiryText}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Save lives in the job-detail view (open the card to save), so the
          feed card stays clean — no floating bookmark colliding with the
          price tile. Double-tap-to-save still works on the card body. */}

      {/* No per-card "Sign up to apply" CTA — it was repetitive on every card
          and added banner-blindness. For guests the whole card is tappable and
          routes to /signup (see interactiveProps), which conveys the same
          "tap a job → sign up" intent without the noise. */}
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
