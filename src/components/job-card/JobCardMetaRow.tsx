import { useCallback, useRef, type ReactNode } from "react";
import { Calendar, Clock, MapPin, Timer, Users } from "lucide-react";
import { differenceInHours } from "date-fns";
import { formatJobDate, formatTimeLeft } from "@/lib/dateUtils";
import { useExpiryClock } from "@/lib/useExpiryClock";
import { jobStartTimeLabel, FLEXIBLE_TIME_LABEL } from "@/lib/jobDate";
import { getCity } from "@/lib/locationUtils";
import { hasStreetAddress } from "../../pages/jobs/appliedJobCard/JobAddressLine";
import { mapsSearchUrl } from "@/lib/mapsLink";
import { useLongPress } from "@/hooks/useLongPress";
import { hapticImpactForce } from "@/lib/haptics";

/**
 * How long the location must be held before it launches the map.
 *
 * 500ms, which is the platform norm on both targets this app ships to —
 * Android's `ViewConfiguration.getLongPressTimeout()` is 500ms and iOS's
 * `UILongPressGestureRecognizer.minimumPressDuration` defaults to 0.5s. Picking
 * the number the OS already trained the user on is the whole point: a shorter
 * threshold re-creates the misfire this exists to stop, and a longer one feels
 * broken because the user's thumb lifts before the app agrees a press happened.
 */
const LOCATION_MAP_PRESS_MS = 500;

/**
 * Pixels the finger may drift before the press is abandoned.
 *
 * A LIST is the thing this control lives in, so the single most likely gesture
 * that starts on the location chip is a SCROLL. 8px (useLongPress's default) is
 * below the browser's own ~10px pan slop, so the press dies before the page has
 * visibly moved — a scroll that begins on the location can never open the map.
 */
const LOCATION_MAP_MOVE_TOLERANCE = 8;

/**
 * "👥 3" — how many Helprs the job needs, as ONE component for every surface
 * that states it.
 *
 * Owner, 2026-08-30: "3 helprs needed goes to the right of time." On the
 * applied card the count used to render as its own line at the very BOTTOM of
 * the card, under the Edit/Withdraw row, detached from the facts it belongs
 * with and reading like a footer — while the browse feed already had it inline
 * in the meta row right after the time. Two surfaces, two answers, for one
 * fact. It is the same chip in both places now.
 *
 * Only the two metrics the HOST ROW already sets for every other chip in it are
 * parameterised — the feed's meta row runs 10px icons and a tighter gap, the
 * activity cards' runs 12px and `gap-1.5` — so the chip matches its neighbours
 * without inventing a second visual language. Markup, colour, weight and
 * accessible name are fixed here and cannot drift between the two.
 *
 * The count is the only VISIBLE text: "3 Helprs needed" spelled out is ~90px of
 * a `flex-nowrap` row that has none to give at 320, and the person icon carries
 * the noun. The words survive for assistive tech in the `sr-only` span — an
 * `aria-label` on the wrapper would be ignored, since a bare <span> has no
 * role for one to name.
 */
export function JobHelprsChip({
  helpersNeeded,
  className = "gap-1.5",
  iconClassName = "w-3 h-3",
}: {
  helpersNeeded?: number | null;
  /** Gap + any outer margin. Supplied by the row so it matches its siblings. */
  className?: string;
  iconClassName?: string;
}) {
  /* 2 is the floor a group job can have — `is_group_job` with a null
     `helpers_needed` is an older row, and "1 Helpr" is not a group. */
  const count = helpersNeeded && helpersNeeded > 0 ? helpersNeeded : 2;
  return (
    <span
      className={`inline-flex items-center shrink-0 whitespace-nowrap ${className}`}
      style={{ color: "hsl(var(--primary))" }}
    >
      <Users className={`${iconClassName} shrink-0`} strokeWidth={2.25} aria-hidden="true" />
      <span className="font-sans font-medium">{count}</span>
      <span className="sr-only"> Helprs needed</span>
    </span>
  );
}

interface JobCardMetaRowProps {
  dateNeeded: string;
  startTime: string | null;
  /**
   * `jobs.is_flexible_schedule` — the poster's own "start earlier or later on
   * the day" tick. It is the ONLY thing that licenses the word Flexible here.
   *
   * This row used to print `flexibleLabel` whenever `startTime` was empty,
   * which is not the same question: verified live on prod 2026-09-19, 184 of
   * 260 jobs have a null `start_time` and ZERO have this flag set, so every
   * one of those cards was making a scheduling promise on a poster's behalf
   * that the poster never made. With no time and no flag the chip now drops
   * out entirely — an unknown start hour is not a fact worth a chip.
   */
  isFlexibleSchedule?: boolean | null;
  /** Wording used for the flexible case — Posted uses "Flexible time",
      Applied uses "Flexible". */
  flexibleLabel?: string;
  location: string;
  /* Accepted but no longer read — the maps link uses the ADDRESS now (see the
     href below). Kept in the interface because both cards pass them and both
     may want them again for a distance chip; removing them would be an edit
     across the call sites for no gain. */
  latitude?: number | null;
  longitude?: number | null;
  /** ISO timestamp of the application/post expiry. Pass `null`/`undefined`
      to hide the expiry chip; the caller is responsible for any extra
      gating (e.g. only show while pending, only show with no helper). */
  expiresAt?: string | null;
  /**
   * How many Helprs a GROUP job needs. Pass `null`/`undefined` on a
   * single-helper job and no chip renders.
   *
   * A first-class prop rather than another `children` chip (which is where the
   * posted card used to put it) because its POSITION is the whole point of the
   * owner's ask: immediately right of the time, before the expiry countdown and
   * before anything a caller appends. `children` cannot guarantee that — it is
   * appended last by definition — and the applied card had no chip here at all.
   */
  helpersNeeded?: number | null;
  /** Optional extra chips appended to the row (e.g. applicant counts,
      recurring, group-task) — Posted uses this. */
  children?: ReactNode;
  /** A single control pinned to the far right of the row (`ml-auto`), after
   *  every chip. The posted card's "View details" toggle lives here so it
   *  stops costing a full 44px row of its own — see the note at the call
   *  site. Kept separate from `children` so it is always LAST and always
   *  right-aligned no matter how many chips wrapped above it. */
  trailing?: ReactNode;
  /**
   * Make the location a PRESS-to-open-map control instead of a tap-to-open link.
   *
   * OPT-IN, and deliberately so — this component is shared (PostedJobCard,
   * AppliedJobCard, and DirectionsButton reads the same `mapsSearchUrl`), and
   * flipping the interaction under every consumer at once would change My Jobs
   * without anyone having asked. Off, the chip is exactly the anchor it always
   * was.
   *
   * On (My Posts), the owner's complaint is fixed: "tapping the location here
   * shouldn't open the map… I keep tapping it on accident." The location sits
   * in the middle of the card body, so a thumb aiming to EXPAND the card lands
   * on it and gets thrown out to a map instead. So a tap now does what a tap
   * anywhere else on the card does — it expands — and the map moves behind a
   * deliberate 500ms hold.
   *
   * The card must also be the thing that expands, so the caller passes nothing:
   * the chip simply does not stop the click, and JobCardShell's own wrapper
   * onClick toggles it. One expand path, not two.
   */
  locationPressToMap?: boolean;
  /**
   * Print the FULL street address in the location slot instead of the city.
   *
   * Owner, 2026-09-19, with a screenshot of /my-jobs: "this shouldnt show 2
   * addresses. once they are at the correct state, the full address should
   * replace the city in the job card. not be on a whole nother line. the full
   * address needs to go where the city place is."
   *
   * The Helpr's card used to print the city HERE and the whole address again on
   * a row of its own below (`JobAddressLine`, VN-55). That row is gone and this
   * is where it went.
   *
   * OPT-IN, because "may this reader see the street?" is the CALLER's question,
   * not this row's. The poster always may (it is their job); the Helpr may only
   * in the four states the deleted address row was gated on, and that gate moved
   * to the call site verbatim. The server is the real gate —
   * `user_may_see_job_address` hands a pending applicant a masked "City, ST" —
   * and this flag is the second lock, which is not redundant now that the row
   * prints `location` whole rather than `getCity(location)`.
   *
   * OFF, or on a location with no street part (`hasStreetAddress` — a digit in
   * the first comma-segment, the one test that works because masking is
   * undetectable by comparison: mask("New Iberia, LA") is "New Iberia, LA"),
   * this row behaves EXACTLY as it always has and prints the city.
   */
  showFullAddress?: boolean;
}

/**
 * Date / location / expiry chip row shared by both
 * activity cards. Posted adds a few role-specific chips via `children`.
 */
export function JobCardMetaRow({
  dateNeeded,
  startTime,
  isFlexibleSchedule,
  flexibleLabel = FLEXIBLE_TIME_LABEL,
  location,
  expiresAt,
  helpersNeeded,
  children,
  trailing,
  locationPressToMap = false,
  showFullAddress = false,
}: JobCardMetaRowProps) {
  const mapHref = mapsSearchUrl(location);
  // Re-renders the countdown the moment its text changes (incl. at expiry).
  const expiryNow = useExpiryClock([expiresAt]);

  // ONE rule for "when" (src/lib/jobDate.ts). The shared helper answers with
  // the canonical word "Flexible"; this row is allowed its own wording for
  // that one case ("Flexible time" on My Posts), so it swaps the label and
  // nothing else. `null` stays null and the chip does not render.
  const resolvedTime = jobStartTimeLabel(startTime, isFlexibleSchedule);
  const timeLabel = resolvedTime === FLEXIBLE_TIME_LABEL ? flexibleLabel : resolvedTime;

  /**
   * The map is opened by CLICKING A REAL ANCHOR, never `window.open`.
   *
   * `mapsSearchUrl` returns `maps://` on iOS and `geo:` on Android, and
   * DirectionsButton already carries the note this follows: "an anchor hands
   * the scheme straight to the OS, where `window.open` on a `maps://` URL
   * inside a WebView is the shape that gets swallowed." A programmatic
   * `.click()` on a real anchor is the same navigation a user's own click
   * performs, so the scheme handoff, `rel="noopener"` and the popup blocker all
   * behave identically to before.
   *
   * It is also the ACCESSIBLE action — see the anchor's own comment. One
   * element serves the gesture and assistive tech, so they cannot drift.
   */
  const mapLinkRef = useRef<HTMLAnchorElement | null>(null);

  /**
   * Set the instant the hold fires, cleared by the click that follows it.
   *
   * A long press still ends in a `click` on the button. Without this the same
   * gesture would open the map AND bubble up to expand the card — the user
   * comes back from the map to a card in a different state than they left it.
   */
  const pressOpenedMapRef = useRef(false);

  const openMapOnHold = useCallback(() => {
    pressOpenedMapRef.current = true;
    /* Haptic BEFORE the handoff, and `hapticImpactForce` rather than
       `hapticMedium`, so it fires even under Reduce Motion. This is the only
       confirmation that a HIDDEN gesture registered; suppressing it for a
       reduce-motion user would leave them holding a chip with no idea whether
       the app agreed. Same reasoning usePullToRefresh uses for its
       release-past-threshold tick — it is status, not decoration. */
    hapticImpactForce();
    mapLinkRef.current?.click();
  }, []);

  const longPress = useLongPress({
    threshold: LOCATION_MAP_PRESS_MS,
    moveTolerance: LOCATION_MAP_MOVE_TOLERANCE,
    onLongPress: openMapOnHold,
  });

  /**
   * THE PLACE, and how much of it. A street address when the caller says this
   * reader may have one and the row actually holds one; the city otherwise.
   */
  const fullAddress = showFullAddress && hasStreetAddress(location);
  const city = fullAddress ? location.trim() : getCity(location);

  /* ── WHY A STREET ADDRESS TAKES A WHOLE LINE, WITH THE ARITHMETIC ─────────
   *
   * The row is 212px at a 320 viewport and 262px at 375 (measured on prod,
   * both engines — src/test/jobStepRowWidthFloor.test.tsx). At 320 the date
   * chip ("Thu, Sep 17") needs ~77px and the time chip ("12:00 PM") ~62px,
   * plus two 8px gaps: 155px of the 212. That leaves 57px for the location,
   * of which the pin and its gap take 16 — 41px of text, about seven
   * characters. "1103 Center St, New Iberia, LA 70560" would render as
   * "1103 C…".
   *
   * An address clipped to seven characters is not a shorter address, it is a
   * different one. So the address does not compete for the line: `basis-full`
   * puts it on its OWN row inside the same wrapping flex container, with the
   * whole 212px (196px of text after the pin — enough for ~35 characters, and
   * it wraps rather than clips beyond that), and the date/time/countdown flow
   * underneath exactly as they always have MINUS the city they used to share
   * with. The card is no taller than it was: the separate `JobAddressLine`
   * row this replaces cost a line of its own, at a LARGER size (ds-13).
   *
   * Truncation direction matters even so and is unchanged — `truncate`
   * ellipsizes at the END, so the street NUMBER, the part that identifies the
   * house, is the last thing that could ever be lost. And the map link is
   * built from `location` whole, never from what is painted, so no amount of
   * visual shortening can send anyone to the wrong door.
   */

  // LOCATION OUTRANKS THE EXPIRY COUNTDOWN (owner, 2026-09-11 / 2026-09-13).
  // With a countdown on the row the city does not shrink at all — the
  // countdown (shrink-[100], min-w-0, truncate) gives instead. Weighting alone
  // was not enough: measured on prod at 375 the city still lost ~4px and
  // ellipsized "New Iber…", and any loss on a short city name is an ellipsis.
  // The 50% cap keeps a very long place name from pushing the date out. With
  // no countdown the city is still the row's only shrinker, exactly as before.
  //
  // A FULL ADDRESS OPTS OUT OF THE CONTEST ENTIRELY (`basis-full`): it is on
  // its own line, so there is nothing to out-rank and no shrink weight worth
  // setting. The rule above is untouched for every card that shows a city,
  // which is every card on which it was ever measured.
  const cityFlex = fullAddress
    ? "basis-full shrink-0 max-w-full"
    : expiresAt
      ? "shrink-0 max-w-[50%]"
      : "shrink";

  return (
    /* `gap-x-5`, not `gap-2.5` (owner: "space location day and time out
       better"). Three icon+label pairs 10px apart read as one run-on string —
       the eye can't tell where the place ends and the date begins, because the
       gap between "Lafayette" and the calendar icon was the same as the gap
       between the calendar icon and its own text. Twenty pixels between the
       GROUPS against six inside them makes the grouping do the separating, so
       no middot or rule is needed. `gap-y-1.5` keeps the wrapped rows apart on
       a narrow card. */
    // ONE line, globally (owner). The row never wraps: date and time hold
    // their natural width, the LOCATION is the element that gives — it
    // shrinks and ellipsizes ("Delcambre" → "Delc…") because it is the only
    // chip whose tail carries no information the map link doesn't. The
    // trailing expand chevron stays pinned at the right of the same line.
    // gap tightens on narrow cards (gap-x-3 → sm:gap-x-5) so the three chips
    // fit a 375 card before the location has to give anything up.
    <div className="flex items-center text-ds-11 text-muted-foreground">
      {/* Gap tightens once more below 360px. The location chip is a bordered
          CONTROL now, not bare text, so it costs ~8px more than the plain
          anchor did — at 320 that came straight off the city, which
          ellipsized to a useless "L..". Buying those pixels back from the
          inter-chip gap keeps the place name readable on the narrowest phone
          without changing anything from 360 up. */}
      {/* `job-meta-row` is the hook for ONE rule in index.css: this row wraps
          in Senior Mode. It stays `flex-nowrap` at the default scale, which is
          the owner's call above and is unaffected.

          The reason it cannot stay nowrap at the larger rung: date and time are
          `shrink-0 whitespace-nowrap` and grow ~27%, so the whole increase
          comes out of the location, which is the only chip that gives.
          Measured at 320, the city's content box went 22px → 18px and
          "Metairie" rendered as a single visible character beside its pin. The
          rule that says the location ellipsizes assumes an ellipsis a reader
          can act on; one character is not that. */}
      <div
        className={`job-meta-row flex items-center gap-x-2 min-[360px]:gap-x-3 sm:gap-x-5 min-w-0 flex-1 overflow-hidden ${
          fullAddress ? "flex-wrap gap-y-1" : "flex-nowrap"
        }`}
      >
      {/* Location → date → time, matching the home feed ("Browse Tasks")
          card order so the two surfaces read consistently. */}
      {/* NO ADDRESS → NO CHIP. `location` is "" for a job whose poster deleted
          their account (20260901033011 nulls it, and the callers coalesce).
          Neither branch below tolerated that: `getCity("")` is "", so the chip
          rendered as a bare pin with no text, its `aria-label` read
          " — tap to expand this job", and — worse — `mapsSearchUrl("")` is "",
          so the link branch shipped `href="" target="_blank"`, which opens a
          NEW WINDOW AT THE CURRENT URL. In the native shell that is a second
          WKWebView reloading the whole app. Two sibling surfaces
          (ScheduleTab, CompactJobCard) already drop the chip in this state;
          this makes the third agree. */}
      {city && (locationPressToMap ? (
        /* PRESS-TO-MAP. See `locationPressToMap` on the props for why.

           A <button>, not an <a>: the primary action of this control is now
           "expand the card", and an anchor whose activation does not follow its
           own href is a lie to every user agent that reads it. The href moved
           to the real anchor below, which is where the map action actually
           lives for both the gesture and assistive tech. */
        <span className={`flex items-center min-w-0 ${cityFlex}`}>
          <button
            type="button"
            {...longPress}
            onClick={(e) => {
              if (pressOpenedMapRef.current) {
                /* The hold already opened the map — swallow its trailing click
                   so the card does not ALSO toggle underneath it. */
                pressOpenedMapRef.current = false;
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              /* Deliberately NOT stopping propagation: a plain tap must reach
                 JobCardShell's wrapper onClick and expand the card, exactly
                 like a tap on any other part of it. This is the fix. */
            }}
            /* The iOS callout / desktop context menu fires on the same hold and
               would race the gesture (and, in WKWebView, put a text-selection
               loupe over the chip). The map IS this element's context action. */
            onContextMenu={(e) => e.preventDefault()}
            /* DISCOVERABILITY, part 1 — REVERSED (owner, 2026-09-14, VN-27:
               "remove the grey background from the location"). The resting
               tinted fill and border are gone, so at rest the location reads
               exactly like the date and time beside it. What stays: the hover
               and active-press feedback (a fill appears only while pointed at
               or pressed), the press-and-hold map gesture, and part 2's words
               (aria-label / title / the hold hint).

               `py-2 -my-2` is kept verbatim from the anchor it replaces: it
               grows the HIT AREA to 44px without growing the layout box (the
               chip measured 77x16, a third of the app's 44px floor). The
               overhang lands on the card's own padding, never on another
               control — the row's only other interactive element is pinned to
               the opposite end. */
            className="flex items-center gap-1 min-[360px]:gap-1.5 py-2 -my-2 px-1 -mx-1 rounded-ds-sm hover:bg-[hsl(var(--olivewood)/0.12)] hover:text-primary active:bg-[hsl(var(--olivewood)/0.20)] active:scale-[0.97] transition-all duration-150 min-w-0 shrink"
            /* DISCOVERABILITY, part 2 — say it in words, for everyone.
               `aria-label` states BOTH actions so a screen-reader user is told
               the tap expands (which is not guessable) and `aria-describedby`
               points at the visible "Hold for map" hint, so the sighted and the
               non-sighted affordance are the same sentence. `title` gives the
               desktop pointer user the same line on hover. */
            aria-label={`${fullAddress ? "Job address: " : ""}${city} — tap to expand this job`}
            title={`${city} — tap to expand, hold for the map`}
          >
            <MapPin className="w-3 h-3 shrink-0" />
            {/* The noun the deleted `JobAddressLine` used to carry. A street
                address read aloud with no label is a string of digits. */}
            {fullAddress && <span className="sr-only">Job address: </span>}
            <span className={fullAddress ? "whitespace-normal break-words" : "truncate"}>{city}</span>
          </button>
          {/* THE ACCESSIBLE MAP ACTION, and the thing the hold actually clicks.

              A gesture is invisible to assistive tech and unreachable from a
              keyboard, so the map cannot exist only as a timer — it has to be a
              real, focusable, named control. This anchor is exactly that: it is
              in the tab order, VoiceOver announces and activates it like any
              link, and `focus:not-sr-only` paints it as a visible chip the
              moment a keyboard reaches it, so it is discoverable by sighted
              keyboard users too rather than being a trap of invisible focus.

              `openMapOnHold` clicks THIS element, so the gesture and the
              assistive action are the same code path and can never disagree
              about where the map points. */}
          <a
            ref={mapLinkRef}
            /* THE ADDRESS, not the coordinates. This linked to
               `google.com/maps?q=<lat>,<lng>` at four decimal places — about
               eleven metres, which on a residential job is the house — so the
               precise location of a private home travelled to a third party in
               a query string on every tap, for a convenience the address serves
               just as well. See mapsLink.ts; it also picks the platform's own
               maps app in the native shell instead of always sending people to
               the web. */
            href={mapHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="sr-only focus:not-sr-only focus:relative focus:z-20 focus:ml-1.5 focus:inline-flex focus:items-center focus:gap-1 focus:rounded-ds-sm focus:border focus:border-primary/40 focus:bg-background focus:px-1.5 focus:py-1 focus:text-ds-10 focus:whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Open {city} in Maps
          </a>
        </span>
      ) : (
        <a
          onClick={(e) => e.stopPropagation()}
          /* THE ADDRESS, not the coordinates. This linked to
             `google.com/maps?q=<lat>,<lng>` at four decimal places — about eleven
             metres, which on a residential job is the house — so the precise
             location of a private home travelled to a third party in a query
             string on every tap, for a convenience the address serves just as
             well. See mapsLink.ts; it also picks the platform's own maps app in
             the native shell instead of always sending people to the web. */
          href={mapHref}
          target="_blank"
          rel="noopener noreferrer"
          /* `py-2 -my-2` grows the HIT AREA without moving anything. The link
             measured 77x16 on a 375px screen — a thumb target a third of the
             44px floor index.css puts on every button in the app, and short even
             of WCAG 2.5.8's 24px minimum. The row's only other content is plain
             text, so the extra 8px above and below overlaps nothing that could
             steal the tap. */
          className={`flex items-center gap-1.5 py-2 -my-2 hover:text-primary transition-colors min-w-0 ${cityFlex}`}
        >
          <MapPin className="w-3 h-3 shrink-0" />
          {fullAddress && <span className="sr-only">Job address: </span>}
          <span className={fullAddress ? "whitespace-normal break-words" : "truncate"}>{city}</span>
        </a>
      ))}
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Calendar className="w-3 h-3 shrink-0" />
        {formatJobDate(dateNeeded)}
      </span>
      {/* THE START TIME IS THE FIRST THING THIS ROW DROPS WHEN IT IS FULL, and
          only then — the same rule, at the same 400px, that the browse feed's
          own meta row already applies, for the same measured reason.

          "Full" here means the expiry countdown is rendering, which happens on
          exactly one state (a pending application still open to other Helprs)
          and adds a fifth chip to a `flex-nowrap` row. Measured at 375 on that
          card before this guard: the five chips wanted 373px of a 267px row, so
          the city — the only item that shrinks — was squeezed to 10.7px, i.e.
          the map pin and NOTHING ELSE, while "4 days left" wrapped to three
          lines and made that one card 32px taller than every card around it.
          Both halves of that are worse than not printing the o'clock.

          With the time out at ≤399px the row is city + date + helprs + expiry,
          which fits, and the city gets ~60px back. Above 400 — and on every
          card without an expiry, which is most of them — nothing changes and
          the time is exactly where it was. */}
      {/* `jobStartTimeLabel` (src/lib/jobDate.ts) is the ONE rule: a clock
          time, else the flexible wording when the poster actually ticked the
          flag, else NULL — and null drops the whole chip, icon included,
          rather than leaving a clock face with nothing beside it. */}
      {timeLabel && (
        <span
          className={`flex items-center gap-1.5 shrink-0 whitespace-nowrap${
            expiresAt ? " [@media(max-width:399px)]:hidden" : ""
          }`}
        >
          <Clock className="w-3 h-3 shrink-0" />
          {timeLabel}
        </span>
      )}
      {/* DIRECTLY RIGHT OF THE TIME (owner, 2026-08-30: "3 helprs needed goes
          to the right of time"), and before the expiry countdown, so the row
          reads place → day → hour → how many of us, which is the order the
          facts are needed in.

          Hidden below 360px, the same guard the feed's own start-time chip
          already carries and for the same measured reason: this row is
          `flex-nowrap` and clipped, so a chip that does not fit is not tight,
          it is silently GONE — and what it takes on the way out is the city,
          the only item here that shrinks. Group jobs are the minority and the
          count is repeated in the expanded card, so at 320 the chip is the
          right thing to drop rather than letting it ellipsise a parish. */}
      {helpersNeeded ? (
        <JobHelprsChip
          helpersNeeded={helpersNeeded}
          className="gap-1.5 [@media(max-width:359px)]:hidden"
        />
      ) : null}
      {/* No "3h" estimate chip. Post a Job has no estimated-hours field any
          more (owner), so on every job posted since it was dropped this
          rendered nothing, and on the older ones it showed a second clock icon
          beside the start time for a number the poster can no longer set or
          correct. The column and its edit field are untouched — this is the
          card display only. */}
      {expiresAt
        ? (() => {
            const expiry = new Date(expiresAt);
            const expiringSoon = differenceInHours(expiry, expiryNow) < 24;
            const text = formatTimeLeft(expiry, expiryNow);
            return (
              /* `whitespace-nowrap`: without it "4 days left" broke across three
                 lines on a squeezed 320/375 card and made that one card 32px
                 taller than its neighbours.

                 LOCATION OUTRANKS THIS COUNTDOWN (owner, 2026-09-11, again
                 2026-09-13). It used to be `shrink-0`, which left the city as
                 the only item that could give: measured on prod at 375,
                 "Under a minute left" kept its full 125px while "New Iberia"
                 rendered as "N…". Now it ellipsizes FIRST — `min-w-0` lets it
                 go below its text, and `shrink-[100]` gives it a hundred times
                 the city's share of any shortfall, so the city only starts to
                 give once this is down to its timer icon. Where a job is, is
                 the first thing read; the countdown is also said by the
                 expired/urgent treatment. Guarded by
                 JobCardMetaRow.locationPriority.test.tsx. */
              <span
                className={`flex items-center gap-1 min-w-0 shrink-[100] overflow-hidden whitespace-nowrap ${expiringSoon ? "text-destructive font-medium" : ""}`}
              >
                <Timer className="w-3 h-3 shrink-0" /> <span className="truncate">{text}</span>
              </span>
            );
          })()
        : null}
      {children}
      </div>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  );
}
