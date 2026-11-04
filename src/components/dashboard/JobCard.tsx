import { memo, useCallback } from "react";
import "@/lib/i18n/enJobCard";
import { MapPin, Calendar, Clock, Timer, Repeat } from "lucide-react";
import { hapticLight } from "@/lib/haptics";

import { JobHelprsChip } from "@/components/job-card/JobHelprsChip";
import { JobCategoryTab } from "@/components/job/JobCategoryTab";
import { listingChip, listingDeadline } from "@/lib/listingDeadline";
import { useExpiryClock } from "@/lib/useExpiryClock";
import { formatPrice, formatPriceFloor, formatRecurrenceInterval, seriesSummary } from "@/lib/format";
import { earlyAccessDelayMs } from "@/lib/earlyAccess";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { getCity } from "@/lib/locationUtils";
import { haversineMiles, isCommutableDistance, tripMiles } from "@/lib/geo";
import { getParishCentroid, getCentroidFromLocation } from "@/lib/parishCentroids";
import { usePrefetchOnTouch } from "@/lib/usePrefetchOnTouch";
import { useDrivingTime } from "@/hooks/useDrivingTime";
import { prefetchJobDialog } from "./prefetchJobDialog";
import { formatDistanceLabel, formatDrivingLabel } from "./jobCardDistance";
import { JobPrice, computeNet } from "./JobPrice";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { JobCardHeroBand } from "./JobCardHeroBand";
import { JobCardSecondaryChip, JobCardStatusCorner } from "./JobCardBadges";
import { jobCardInteractiveProps } from "./jobCardInteractiveProps";
import { JOB_CARD_MEDIA_PAD, JOB_CARD_MEDIA_ROW, JOB_CARD_TEXT_COL, JobCardMedia, JobCardPosterFace } from "./JobCardMedia";
import {
  JOB_CARD_BADGE_ROW,
  JOB_CARD_BODY,
  JOB_CARD_CLIP,
  JOB_CARD_META,
  JOB_CARD_TITLE_ROW,
} from "@/components/job/cardGeometry";
import type { JobCardProps } from "./jobCardProps";
import { jobDayLabel } from "@/lib/jobDateWindow";

// Category colors apply ONLY to the category badge pill at the top of
// the card. The job title itself stays in `text-foreground` (deep
// charcoal) across all categories so the brand reads consistently and
// the colored badge stays the single accent in the row. The `accent`
// gradient tints are kept for the boosted/recommended highlight strip.
const JobCard = ({ job, effectiveFee, currentUserId: _currentUserId, showApply: _showApply = true, onSelect, index: _index = 0, isExpanded: _isExpanded = false, onToggleExpand: _onToggleExpand, isSaved: _isSaved = false, onToggleSave: _onToggleSave, variant = "default", guestPricing = false, userLat = null, userLng = null, recommended = false, bare = false, hero = false }: JobCardProps) => {
  const isGuest = variant === "guest";
  // Jobs in Spanish (A3-3): the card's chips follow the member's language.

  // A tap always opens the job detail view. Saving lives behind the
  // bookmark control in the detail dialog — the card tap is reserved for
  // "show me more" so it never feels like the heart is hijacking the tap.
  const handleTap = useCallback(() => {
    hapticLight();
    onSelect(job);
  }, [job, onSelect]);

  // Show the gross posted budget (vs the helper's net take-home) for guestPricing or the poster's own job.
  // Net "You earn" take-home is the default for guests too (they're shown an
  // assumed fee tier via effectiveFee). Only the explicit `guestPricing` flag
  // forces the gross "Budget" figure — `variant="guest"` no longer does, so a
  // guest card can show take-home AND the "Sign up to apply" CTA together.
  const isOwnJob = !!_currentUserId && job.customer_id === _currentUserId; // J1: own job = the price set, as on Posted
  const showBudget = guestPricing || isOwnJob;
  // Per-helpr split count for JobPrice, the single money component (card and detail never disagree).
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const firstPayoutFee = useFirstPayoutFeeDollars();
  // Announce the SAME figure the visible JobPrice chip shows: net take-home by
  // default, gross budget only on guest/poster surfaces. Reusing computeNet
  // keeps the label from drifting to the gross budget (and, Q753, takes off
  // the same one-time setup fee the chip does).
  // formatPriceFloor on the net branch, matching the chip: this said
  // formatPriceExact while the visible chip floored, so a screen-reader user
  // heard "$57.66" where a sighted one read "$57". The chip is the authority.
  const netAria = formatPriceFloor(computeNet(job.budget, effectiveFee, job.urgent_fee ?? 0, helpersCount, firstPayoutFee, job).netEarnings);
  const priceAria = showBudget ? `$${formatPrice(job.budget)}` : `$${netAria}`;

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

  // No address on a job whose poster deleted their account — deletion
  // anonymises the job rather than removing it (20260901033011). getCity
  // answers "" for an absent location, which every reader here already guards.
  const cityState = getCity(job.location ?? "");

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
  // THE PILL IS A COMMUTE PILL, SO IT ONLY RENDERS FOR A COMMUTE.
  //
  // Owner, 2026-09-19: this read "27h 6m · 1634 mi" on a Shreveport job —
  // "why is this showing here". The first fix treated that as a wrong number
  // and blamed the origin. The number was RIGHT: the owner was in Menlo Park
  // (geo.ts carries the corrected account). What was wrong was printing it
  // here. This row is the one-line scan a helpr uses to decide whether a job
  // is worth the drive; "1634 mi" answers a question nobody on this screen is
  // asking, and repeats itself on all forty cards.
  //
  // So beyond commuting range the pill is simply absent — the row reads
  // exactly as it does for a viewer whose location we never had. That is a
  // deliberate choice between two honest options ("say something useful" or
  // "say nothing"): the alternative, a "far from you" chip on every card, is
  // the same global fact stamped forty times, which is the noise the owner
  // reported in a different costume. The fact itself is not lost — the job
  // detail sheet states the real distance, because there the user has asked
  // about THIS job. A feed-level banner is the right home for the global
  // version of it; that surface is not this file's to change.
  //
  // NOTE what this is NOT: it is not a claim that the viewer is somewhere
  // illegitimate, and nothing here discards a coordinate. `userLat/userLng`
  // stay exactly as they arrived and the radius filter still runs on them.
  const rawTripMiles = tripMiles(
    destCentroid && userLat != null && userLng != null
      ? haversineMiles(userLat, userLng, destCentroid.lat, destCentroid.lng)
      : null,
  );
  const distanceMiles = isCommutableDistance(rawTripMiles) ? rawTripMiles : null;
  // EVERY value here is approximate and the visible text says so; the rule and
  // its rationale live with the formatter (see ./jobCardDistance).
  const distanceLabel = formatDistanceLabel(distanceMiles);
  // The same figure without the typographic "~" — see the aria-label below.
  const spokenDistance = distanceLabel?.replace(/^~/, "") ?? null;

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
  const drivingLabel = formatDrivingLabel(drivingMinutes);

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
  // Expiry: an urgency chip inside 48 h, counting to the start when that comes first (listingChip, A3-94).
  const expiryNow = useExpiryClock([job.expires_at, listingDeadline(job)?.at.toISOString()]);
  const chip = listingChip(job, expiryNow);
  const expiryText = chip?.text ?? null;
  const isExpiringSoon = !!chip?.soon;

  // WHEN the job starts, resolved ONCE by the one rule every surface shares:
  // a clock time, the word "Flexible" if the poster ticked the flag, or null
  // meaning the chip is not rendered. See src/lib/jobDate.ts.
  const timeLabel = jobStartTimeLabel(job.start_time, job.is_flexible_schedule);
  // The hero card already leads with the job's own photo band; every other card gets the tile.
  const showMedia = !bare && !(hero && job.photos?.[0]);

  // NO ENTRY ANIMATION (Q169, owner 2026-09-23: "more cards appear ... they
  // don't all load together"). Each card used to fade and rise in on its own
  // `animation-delay` of index x 70ms (to 500ms), so a feed that arrived in ONE
  // commit still reached the eye as cards popping in one after another — and a
  // re-sort re-inserts moved nodes, which restarts a CSS animation, so the
  // cards that moved faded out and in again. A list's cards arrive together,
  // in place of the skeleton that reserved their space.
  // Guard: src/test/listArrivesInOneWave.test.ts.
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
  // An ownerless job (deleted poster — see the `cityState` note) has no
  // customer to warm the repeat-customer query for, and prefetchJobDialog
  // bails on a falsy id anyway; skipping keeps null out of its string param.
  const prefetchHandlers = usePrefetchOnTouch(() =>
    job.customer_id ? prefetchJobDialog(job.id, job.customer_id) : undefined,
  );

  // Guest vs signed-in tap/keyboard props (jobCardInteractiveProps.ts, with the guest branch's a11y note).
  const interactiveProps = jobCardInteractiveProps({ isGuest, job, onSelect, handleTap, priceAria, prefetchHandlers });

  return (
    <div data-feed-card=""
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
          : "group relative h-full rounded-2xl border border-border/60 bg-card cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      }
      {...interactiveProps}
    >
      {/* Clipped inner surface — rounds the rail, body, and guest CTA to
          the card shape. The category tab + rail both live inside this clip
          so they share the card's rounded top-left corner and read as one
          continuous shape. `bare` still clips (the callout bubble itself is
          rounded, and the category rail/tab need SOME edge to align to) but
          carries no paint of its own. */}
      <div className={bare ? "relative h-full overflow-hidden rounded-lg" : JOB_CARD_CLIP}>
        {/* No category rail: owner 2026-10-18; the category reads from the icon + label. */}
        {hero && !bare && <JobCardHeroBand photo={job.photos?.[0]} />}
        {/* Photo-first (owner 2026-10-17, Q2043 + Q2036): the picture leads, the text sits beside it. */}
        <div className={showMedia ? JOB_CARD_MEDIA_ROW : "contents"}>
        {showMedia && (
          <div className={JOB_CARD_MEDIA_PAD}>
            <JobCardMedia photo={job.photos?.[0]} category={job.category} />
          </div>
        )}
        <div className={showMedia ? JOB_CARD_TEXT_COL : "contents"}>
        {/* ── BADGE RAIL ── ONE in-flow row holding every badge, so they share
            one top edge, bottom edge and baseline by construction (owner
            2026-08-31, "JUST IN needs to be better aligned"); in flow, so the
            body starts after it in every font-size mode (senior mode grows
            chips ~9px). Priority when width runs out (320px): 1. status corner
            (never shrinks), 2. at most ONE secondary chip, "Just in" before
            "Recommended" (never shrinks), 3. the category label, the only item
            that truncates. Nothing wraps, so the rail is always one chip tall.
            Full history: git log -S "BADGE RAIL" on this file. */}
        <div className={JOB_CARD_BADGE_ROW}>
          {/* 1. Category tab — flat left edge (squared) continuing the
                 vertical rail, rounded nose on the right. The poster avatar
                 moved to the job-detail view (JobPosterCard) so the feed
                 card stays uncluttered. `min-w-0` + `truncate` make this the
                 item that yields width; `max-w-[52%]` keeps a long or
                 unmapped raw category value from eating the rail even when
                 it is the only chip present. */}
          {/* ONE component, shared with the activity cards' JobCardShell —
              see JobCategoryTab. Both files drew this tab by hand and had
              already drifted (only this copy carried the truncation cap). */}
          <JobCategoryTab category={job.category} flexible />
          {/* 2. Secondary slot (JobCardBadges.tsx). */}
          <JobCardSecondaryChip justIn={isJustIn} recommended={recommended} />
          {/* 3. Elastic gap — the ONLY thing on the rail allowed to grow or
                 shrink freely. It is what pins the status chip to the right
                 edge, so the top-right corner no longer needs its own
                 absolute position (and so can no longer be overlapped by a
                 left-hand chip that outgrew its hardcoded slot). */}
          <span aria-hidden className="flex-1 min-w-[8px]" />
          {/* 4. Status corner (JobCardBadges.tsx). */}
          <JobCardStatusCorner job={job} />
        </div>
        {/* Body. `pt-2` is a real gap under the rail, NOT a reservation for
            it — the rail is in flow above, so this padding no longer has to
            guess how tall a badge chip is (the guess it replaces, `pt-6`,
            was already wrong in senior mode). */}
        <div className={JOB_CARD_BODY}>
        {/* Title + price share the top row — price chip is vertically
            centered against the title. The location/date/time meta spans
            the full card width below.
            Board 173 (spec v2 §9.33, owner-adopted 2026-10-20, replacing the
            2026-08-30 one-line rule): a title wraps to two lines, then ends
            in "…"; the text never shrinks. The virtualized feed measures each
            row (measureElement), so a two-line card takes its real height.
            `min-w-0` lets it shrink inside the flex row at all.
            */}
        <div className={JOB_CARD_TITLE_ROW}>
          {/* h2, not h3: these cards sit DIRECTLY under the page <h1>
              ("Browse Jobs", "My Posts"), with no intervening section
              heading, so an h3 skipped a level and failed axe's
              heading-order on 18 pages. The visual size is carried by
              `text-headline-card`, not by the tag, so nothing moves. */}
          <h2
            className="job-card-title senior-clamp-2 text-headline-card flex-1 font-display font-bold text-foreground leading-tight line-clamp-2 break-words min-w-0"
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
            helpersNeeded={helpersCount} jobStatus={job.status}
            feeStamp={job}
            showBudget={showBudget}
            variant="chip"
            className="shrink-0"
          />
        </div>

        {/* Meta row — category lives in the badge above, so this leads
            with location. */}
        <div className={`${JOB_CARD_META} text-muted-foreground`}>
          {/* Row 1 — where + when. The expiry countdown deliberately does NOT
              live here: this row is flex-nowrap, so every extra chip steals
              width from the city, which has min-w-0 and collapses first. With
              the countdown competing, cities rendered as "Hou…", "Gonz…",
              "Brouss…" on a 402pt phone while cards without a countdown showed
              "Shreveport" and "New Orleans" in full — i.e. the single most
              important local-marketplace signal was the first thing dropped.
              Urgency now gets its own row below, which is also what the
              My Posts / My Jobs cards already do. */}
          {/* Below 360px EVERY card takes two lines (Q2222): place on the
              first, date · time on the second, so the start time is whole at
              320 and all cards stay one height. From 360px up it is one line. */}
          {/* STAYS ON ONE LINE — never wraps (owner: "should never go to a
              second line. all job cards should remain same size always").
              A wrapping row was tried and rejected: it fixed the truncation but
              made a group-job card one line taller than every card around it,
              and equal card height is the stronger rule. Feed cards are scanned
              as a column, so a single tall card reads as a layout break.
              The width the group-job chip needs is bought back below instead —
              see the `is_group_job` chip, which drops its separator and rides
              tighter than the rest of the row. */}
          <div className="job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden">
            {/* Never hidden (owner, 2026-10-08); floor = pin + ~5 letters, not a city's width (owner, 2026-10-19: even "·" spacing). */}
            <span className="flex items-center gap-1 min-w-[3.625rem] overflow-hidden">
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
              <span className="truncate font-sans min-w-[2.75rem]">{cityState}</span>
            </span>
            {distanceLabel && (
              <span role="img"
                // Spoken from the UNTILDED label: the visible "~" is a
                // typographic mark for "approximately", and the word itself
                // is already in this sentence. Screen readers variously
                // announce "tilde" or swallow it, and neither is what the
                // sighted reader gets.
                aria-label={
                  drivingLabel
                    ? `Approximately ${drivingLabel} drive, ${spokenDistance} away`
                    : `Approximately ${spokenDistance} away`
                }
                className="inline-flex shrink-0 items-center gap-0.5 px-1.5 py-px rounded-full font-sans font-semibold whitespace-nowrap text-ds-9"
                style={{
                  letterSpacing: "0.02em",
                  background: "hsl(var(--burnt-sienna) / 0.10)",
                  color: "hsl(var(--burnt-sienna))",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                }}
              >
                {/* The drive-time half is hidden below 430px. Measured at 375
                    with a radius on: this pill is ~80px wide with "32 min · ",
                    and together with the date and either the clock or the
                    countdown it left the city group 8px — "Denham Springs"
                    rendered as a pin icon and nothing, "Gonzales" as "(".
                    The miles alone are ~40px, and the miles are the number the
                    radius filter is about; the minutes are on the sheet. */}
                {drivingLabel && (
                  <span className="hidden [@media(min-width:430px)]:inline">{drivingLabel} · </span>
                )}
                {distanceLabel}
              </span>
            )}
            {/* The line break below 360px: a full-width, 2px-tall item, so the
                "when" group starts line two on every card (Q2222). */}
            <span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" />
            <span className="shrink-0 opacity-30 max-[359px]:hidden">·</span>
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
                        {jobDayLabel(job)}
                      </span>
                    </span>
                  )}
                  {/* The start time is never hidden by a width rule (owner,
                      2026-10-08: "location, date and time never be hidden").
                      Below 360px the row breaks before this group instead
                      (Q2222), so date · time have the whole second line. */}
                  {/* `timeLabel` is `jobStartTimeLabel` (src/lib/jobDate.ts) —
                      the ONE rule: a clock time, else the word "Flexible" when
                      the poster ticked `is_flexible_schedule`, else null and
                      the chip (and its separator) are not rendered at all.
                      Gating on `job.start_time` directly is what used to make
                      a flexible-but-timeless job silently lose its "when". */}
                  {job.date_needed && timeLabel && <span className="shrink-0 opacity-30">·</span>}
                  {timeLabel && (
                    <span data-meta-time className="shrink-0 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span className="font-sans whitespace-nowrap">{timeLabel}</span>
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
            {/* No Materials on the browse card (owner, 2026-10-08); the detail sheet says it. */}
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
                helpersNeeded={job.helpers_needed} spotsOpen={job.crew_spots_open}
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
                    {seriesSummary(job) ?? formatRecurrenceInterval(job.recurrence_interval)}
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
            {/* THE COUNTDOWN YIELDS BEFORE THE CITY DOES, at every width —
                not only on cards that also carry a distance pill (owner,
                2026-09-11: "location must outrank the expiry countdown").
                Where a job is, is the first filter a helper applies; how long
                is left is secondary, and it is the half that is already said
                twice — an expiring card wears its URGENT badge on the rail
                above this row.

                The old gate was `distanceLabel ? hidden…430px : flex`, i.e.
                the countdown only gave way when a pill was also competing. On
                a pill-less card at 375 the countdown therefore held its full
                width ("16 hours left", ~78px) while the city, the only item on
                this nowrap row that shrinks, clipped to its 4.5rem floor
                mid-word. That is the reported defect: the row dropped the
                place name and kept the countdown. Below 430px the hours are
                now simply not drawn, and the city keeps the width. */}
            {/* Countdown only with spare room (owner, 2026-10-08): a too-wide one wraps out of sight. */}
            {expiryText && (
              <span data-testid="job-card-countdown-slot" className="flex-1 basis-0 min-w-0 h-[1.5em] overflow-hidden flex flex-wrap items-center gap-x-2">
                <span aria-hidden className="w-0 h-[1.5em]" />
                <span className={`shrink-0 flex items-center gap-x-2 whitespace-nowrap ${isExpiringSoon ? "text-destructive-ink font-medium" : ""}`}>
                  <span className="opacity-30">·</span>
                  <span className="flex items-center gap-1">
                    <Timer className="w-2.5 h-2.5 shrink-0" />
                    <span className="font-sans">{expiryText}</span>
                  </span>
                </span>
              </span>
            )}
          </div>
          <JobCardPosterFace
            posterId={job.customer_id}
            name={job.posterName}
            avatarUrl={job.posterAvatarUrl}
            avgRating={job.posterAvgRating}
            reviewCount={job.posterReviewCount}
          />
        </div>
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
