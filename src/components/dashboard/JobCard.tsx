import { memo, useCallback, type KeyboardEvent } from "react";
import {
  MapPin, Calendar, Clock, Star, Zap, Rocket, Timer, Repeat, CheckCheck,
} from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import { differenceInHours } from "date-fns";

import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { JobHelprsChip } from "@/components/activity/JobCardMetaRow";
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
  /**
   * Drops the card's own outer chrome (rounded corners, border, shadow,
   * background, hover lift) so it can sit directly inside another
   * container that already provides that shape — the map pin's callout
   * bubble, e.g. (owner, 2026-08-30: "should be 1 component not
   * multiple" — MapKit's `.mk-bubble` and this card were each drawing
   * their own rounded rect, so the popup read as a card nested inside a
   * second card). Everything below the outer wrapper — rail, badges,
   * title, meta — is unchanged; only the wrapper's own paint is dropped.
   */
  bare?: boolean;
}

// Category colors apply ONLY to the category badge pill at the top of
// the card. The job title itself stays in `text-foreground` (deep
// charcoal) across all categories so the brand reads consistently and
// the colored badge stays the single accent in the row. The `accent`
// gradient tints are kept for the boosted/recommended highlight strip.
const JobCard = ({ job, effectiveFee, currentUserId: _currentUserId, showApply: _showApply = true, onSelect, index = 0, isExpanded: _isExpanded = false, onToggleExpand: _onToggleExpand, isSaved: _isSaved = false, onToggleSave: _onToggleSave, variant = "default", guestPricing = false, userLat = null, userLng = null, recommended = false, bare = false }: JobCardProps) => {
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

  // Freshness signal — ONE chip, "Just in", living on the badge rail below.
  //
  // There used to be TWO freshness badges on the same card, computed
  // differently, rendered by different components: this "New" dot inside the
  // category tab (gated on the early-access window) and a floating "JUST IN"
  // pill that SwipeableJobCard painted over the card (hardcoded 30 min). A
  // job under 20 minutes old therefore showed BOTH, saying the same thing
  // twice in two visual languages. They are now one chip.
  //
  // DERIVED from the shared perk value (the free-tier delay — 20 min) rather
  // than restated: the 30-minute literal is the exact bug this file already
  // fixed once, where the badge outlived the exclusivity it advertised. The
  // chip drops exactly when every helper can see the job.
  const isJustIn = Date.now() - new Date(job.created_at).getTime() < earlyAccessDelayMs(null);

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
      className={
        bare
          ? "group relative h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          : "motion-safe:animate-fade-in group relative h-full rounded-2xl border border-border/60 bg-card cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      }
      {...interactiveProps}
    >
      {/* Clipped inner surface — rounds the rail, body, and guest CTA to
          the card shape. The category tab + rail both live inside this clip
          so they share the card's rounded top-left corner and read as one
          continuous shape. `bare` still clips (the callout bubble itself is
          rounded, and the category rail/tab need SOME edge to align to) but
          carries no paint of its own. */}
      <div className={`relative h-full overflow-hidden ${bare ? "rounded-lg" : "rounded-2xl"}`}>
        {/* Category rail — vertical color stripe down the left edge. The
            tab below sits flush on top of it (same left edge) so the tab's
            flat left side flows straight into the rail with no gap. */}
        <span
          aria-hidden
          className={`absolute left-0 top-0 bottom-0 w-1.5 ${catStyle.dot}`}
        />
        {/* ── BADGE RAIL ───────────────────────────────────────────────
            ONE row holding EVERY badge this card can render, sharing one
            top edge, one bottom edge and one baseline BY CONSTRUCTION —
            they are siblings in a single flex row, not three separately
            positioned blocks that happen to be tuned to the same offset.

            This is the fix for "JUST IN needs to be better aligned"
            (owner, 2026-08-31). The freshness pill was not on this rail at
            all: it lived in SwipeableJobCard, a DIFFERENT component,
            absolutely positioned over the finished card at `top-2 left-20`
            — 8px below the rail the category tab and BOOSTED sit on, and
            80px from the left, a hardcoded guess at how wide the category
            tab would be. Measured on the real feed, that guess was wrong on
            every card at every width: "Yard Work" / "Pet Care" / "Handyman"
            tabs end at x=135–152, so the pill painted straight across the
            category label, and its bottom edge (32.8px) crossed the title's
            top edge (29px). Three badges, three baselines, one overlap.

            The rail is IN NORMAL FLOW, not absolutely positioned. The old
            arrangement reserved space for the badges with the body's
            `pt-6` — a guess about how tall a chip is, which is wrong the
            moment the chip changes size. It already was: in senior mode
            `.text-ds-*{line-height:1.45!important}` beats `leading-none`,
            every chip grows ~9px, and the rail painted over the title on
            EVERY card (measured: rail bottom 28.84 vs title top 28.00 at
            1440). In flow, the body is placed after the rail whatever the
            rail's height turns out to be, so the two can never collide in
            any font-size mode. And because the category tab always renders,
            the rail is always exactly one chip tall — so the title starts
            at the SAME y on every card, badges or no badges.

            PRIORITY, and what gives when the row runs out of width (320px):
              1. status corner (Boosted > Urgent > Instant) — never shrinks.
              2. secondary chip — at most ONE, "Just in" before
                 "Recommended" (see below) — never shrinks.
              3. the category tab — the ONLY flexible item: its LABEL
                 truncates. Category is the safest thing to abbreviate
                 because it is also carried by the colored left rail, the
                 tab's own tint and the icon; the other two are
                 closed-vocabulary signals that mean nothing ellipsised.
            Nothing wraps (the row is nowrap and every label is nowrap), so
            the rail can never become two chips tall and shove the title
            down — which is exactly what it did at 320px with Recommended
            present before this change. */}
        <div className="relative z-20 flex items-stretch gap-1">
          {/* 1. Category tab — flat left edge (squared) continuing the
                 vertical rail, rounded nose on the right. The poster avatar
                 moved to the job-detail view (JobPosterCard) so the feed
                 card stays uncluttered. `min-w-0` + `truncate` make this the
                 item that yields width; `max-w-[52%]` keeps a long or
                 unmapped raw category value from eating the rail even when
                 it is the only chip present. */}
          <span
            className={`inline-flex items-center gap-1 min-w-0 max-w-[52%] pl-3 pr-2.5 py-1 rounded-l-none rounded-br-lg rounded-tr-none border-b border-r text-ds-10 font-semibold leading-none shadow-sm ${catStyle.badge}`}
          >
            <CategoryIcon
              category={job.category}
              aria-hidden
              className="w-2.5 h-2.5 shrink-0"
              strokeWidth={2.25}
            />
            <span className="font-serif italic truncate">{categoryLabels[job.category] || job.category}</span>
          </span>
          {/* 2. Secondary slot — EXACTLY ONE chip, never both.
                 "Just in" outranks "Recommended" because freshness is
                 perishable (true for one early-access window, then gone
                 forever and unknowable from anywhere else on the card),
                 while a recommended pick is already signalled by its
                 position — the feed puts it at the top. It is also the
                 narrower of the two, so the rail degrades less on a 320px
                 phone. Both are `shrink-0`: an ellipsised "Recommen…" or
                 "Just i…" carries no information, so they hold their width
                 and the category label gives instead. */}
          {isJustIn ? (
            <span
              aria-label="Just posted"
              className="inline-flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-b-lg border-b border-r text-ds-10 font-semibold leading-none shadow-sm pointer-events-none"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                // --sienna-ink for the same reason the Recommended chip uses
                // it (see below) — this is small label text on the sienna
                // family's own tint. The floating pill this replaces painted
                // raw --burnt-sienna on a 0.10 tint, i.e. the exact dark-mode
                // contrast failure --sienna-ink was minted to fix.
                color: "hsl(var(--sienna-ink))",
                borderColor: "hsl(var(--burnt-sienna) / 0.20)",
              }}
            >
              <span
                aria-hidden
                className="w-1.5 h-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
                style={{
                  background: "hsl(var(--burnt-sienna))",
                  boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.55)",
                }}
              />
              <span className="font-serif italic uppercase tracking-[0.14em] whitespace-nowrap">Just in</span>
            </span>
          ) : recommended ? (
            <span
              className="inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-b-lg border-b border-r text-ds-10 font-semibold leading-none shadow-sm pointer-events-none"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                // --sienna-ink, not --burnt-sienna: this is 10px label text on
                // the sienna family's own 12% tint, which is the exact case
                // --sienna-ink was minted for. Raw --burnt-sienna measured
                // 3.89:1 here in dark mode (#d46735 on #332927), under the 4.5
                // AA bar. Light mode is unchanged — the two tokens are
                // byte-identical there.
                color: "hsl(var(--sienna-ink))",
                borderColor: "hsl(var(--burnt-sienna) / 0.20)",
              }}
            >
              <Star
                className="w-2.5 h-2.5 shrink-0"
                strokeWidth={2}
                style={{ fill: "hsl(var(--burnt-sienna) / 0.3)" }}
              />
              <span className="font-sans font-semibold whitespace-nowrap">Recommended</span>
            </span>
          ) : null}
          {/* 3. Elastic gap — the ONLY thing on the rail allowed to grow or
                 shrink freely. It is what pins the status chip to the right
                 edge, so the top-right corner no longer needs its own
                 absolute position (and so can no longer be overlapped by a
                 left-hand chip that outgrew its hardcoded slot). */}
          <span aria-hidden className="flex-1 min-w-[8px]" />
          {/* 4. Status corner — the single highest-priority signal, mirroring
                 the category tab on the opposite corner. */}
          {(() => {
          const corner =
            "inline-flex items-center gap-1 shrink-0 pl-2.5 pr-3 py-1 rounded-bl-lg border-b border-l text-ds-9 font-bold uppercase leading-none shadow-sm";
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
        </div>
        {/* Body. `pt-2` is a real gap under the rail, NOT a reservation for
            it — the rail is in flow above, so this padding no longer has to
            guess how tall a badge chip is (the guess it replaces, `pt-6`,
            was already wrong in senior mode). */}
        <div className="w-full px-3.5 pt-2 pb-2.5">
        {/* Title + price share the top row — price chip is vertically
            centered against the title. The location/date/time meta spans
            the full card width below.
            Truncates to ONE line (owner, 2026-08-30: match the My Posts
            card's density — see PostedJobCard's JobCardTitleBar). This also
            fixes the row-height-variance bug the previous 2-line reservation
            was working around: every card now has exactly one title line, so
            the virtualized feed's measureElement never has to reconcile a
            short-vs-tall run of cards. `min-w-0` lets it shrink/truncate
            inside the flex row at all. */}
        <div className="flex items-center justify-between gap-3">
          {/* h2, not h3: these cards sit DIRECTLY under the page <h1>
              ("Browse Jobs", "My Posts"), with no intervening section
              heading, so an h3 skipped a level and failed axe's
              heading-order on 18 pages. The visual size is carried by
              `text-headline-card`, not by the tag, so nothing moves. */}
          <h2
            className="text-headline-card flex-1 font-display italic font-bold text-foreground leading-tight truncate min-w-0"
            style={{
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {job.title}
          </h2>
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
        <div className="mt-1.5 flex flex-col gap-0.5 text-ds-11 text-muted-foreground leading-tight">
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
            <span className="flex items-center gap-1 min-w-0 overflow-hidden">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {/* `min-w-0` + `overflow-hidden` + `truncate`, and NOTHING that
                  sets a width. Two wrong answers were tried here first, and the
                  comment records both so neither comes back:

                  1. A MIN-WIDTH FLOOR (`min-w-[6ch] max-w-[150px]`). The floor
                     was larger than the space this group actually got on a
                     narrow card, so the city overflowed its own parent box and
                     PAINTED ON TOP of the date beside it — measured on the real
                     feed at 320px on every card ("Lafayette" over "Fri, Sep 4",
                     "Scott" over "Fri, Sep 4") and at 375px on any long parish
                     ("St. Martinville" over "Mon, Aug 31"). A floor cannot make
                     space that isn't there; it can only make the overflow
                     invisible to the layout.

                  2. `flex-1`, which replaced it. That fixed the overlap, but it
                     fixed it by making the city GROW into every pixel the
                     fixed-width "when" group did not need — so on the common
                     card with a short city ("Scott", "Crowley") the group
                     stretched the whole width of the card and shoved the date
                     and time out to the far right edge. Owner, 2026-08-30:
                     "why did you add so much space between location and date?"

                  The city only ever needed to SHRINK, not to grow. A flex item
                  shrinks by default, so with the floor gone and no `flex-1`,
                  the city takes exactly its own text width when there is room
                  and ellipsises when there isn't — and the date sits one
                  `gap-x-2` away from the end of the city name on every card,
                  whatever its length. The "when" group beside it stays
                  `shrink-0`, so it is still the city that gives. */}
              <span className="truncate font-sans">{cityState}</span>
            </span>
            {distanceLabel && (
              <span
                aria-label={
                  drivingLabel
                    ? `Approximately ${drivingLabel} drive, ${distanceLabel} away`
                    : `Approximately ${distanceLabel} away`
                }
                className="inline-flex shrink-0 items-center gap-0.5 px-1.5 py-px rounded-full font-sans font-semibold whitespace-nowrap text-ds-9"
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
            <span className="shrink-0 opacity-30">·</span>
            {/* Date + time + duration live in ONE no-wrap group so the "when"
                of a job can never be split across lines — the trio moves
                together. "Due" is dropped — the date is self-evidently the day
                the work must be done. The start-time chip only renders when a
                start_time is set (most posts leave it blank); the duration
                chip fills that slot from estimated_hours, which every post
                collects, so the row always answers "how much of my day?". */}
            <span className="inline-flex shrink-0 items-center gap-x-2">
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
                  {/* Start time is the FIRST thing dropped under 360px — the
                      same sub-360 guard the recurring chip already uses, for
                      the same measured reason. This row is nowrap and clipped,
                      so anything that does not fit is not "tight", it is
                      SILENTLY GONE: at 320px the group-size chip ("👥 4") was
                      being cut off the right edge of every multi-helpr card
                      while the clock read "11:00 AM". On a 320px phone, what
                      day the work is and how many helprs it needs both beat
                      what o'clock it starts, and the time is one tap away on
                      the detail sheet. Dropping it deliberately is the only
                      way the chips behind it survive. */}
                  {job.date_needed && job.start_time && (
                    <span className="shrink-0 opacity-30 hidden [@media(min-width:360px)]:inline">·</span>
                  )}
                  {job.start_time && (
                    <span className="shrink-0 hidden [@media(min-width:360px)]:flex items-center gap-1">
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
              // THE SAME CHIP the activity cards render (JobHelprsChip, in
              // JobCardMetaRow) — one component now states "how many Helprs"
              // everywhere, after the owner found the applied card putting it
              // in a footer line while this row had it inline. Only the two
              // metrics this row sets for every other chip in it are passed:
              // 10px icons, and no leading "·" with a tighter gap than its
              // siblings. Every chip on this nowrap row is width the city does
              // not get, and the city is the only item that shrinks — so a
              // multi-person job used to render "Abbev." while single-helper
              // cards next to it showed "Abbeville" in full. Dropping the
              // separator and halving the gap returns ~14px to the parish for
              // the cost of nothing legible: the person icon already separates
              // this from the time beside it.
              <JobHelprsChip
                helpersNeeded={job.helpers_needed}
                className="gap-0.5 ml-0.5"
                iconClassName="w-2.5 h-2.5"
              />
            )}
            {job.is_recurring && (
              // Lowest-priority chip on the row, so it carries the widest
              // guard: hidden below 400px. It was 360px, which was measured
              // to be too low — at 375px a recurring GROUP job put
              // "⟳ Weekly" past the right edge of the clipped row, so the
              // chip was rendering into nothing on the exact phone width it
              // was supposed to be safe on. "Recurring" is the least
              // decision-relevant item here (it does not change what the job
              // is, where, when, or what it pays) and it is the longest, so
              // it is the right thing to drop first.
              <>
                <span className="shrink-0 opacity-30 hidden [@media(min-width:400px)]:inline">·</span>
                <span className="shrink-0 hidden [@media(min-width:400px)]:flex items-center gap-1">
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
                <span className="shrink-0 opacity-30">·</span>
                <span
                  className={`flex shrink-0 items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}
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
