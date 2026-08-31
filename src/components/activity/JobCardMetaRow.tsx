import { useCallback, useRef, type ReactNode } from "react";
import { Calendar, Clock, MapPin, Timer } from "lucide-react";
import { differenceInHours } from "date-fns";
import { formatJobDate, formatTimeLeft } from "@/lib/dateUtils";
import { getCity } from "@/lib/locationUtils";
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
export const LOCATION_MAP_PRESS_MS = 500;

/**
 * Pixels the finger may drift before the press is abandoned.
 *
 * A LIST is the thing this control lives in, so the single most likely gesture
 * that starts on the location chip is a SCROLL. 8px (useLongPress's default) is
 * below the browser's own ~10px pan slop, so the press dies before the page has
 * visibly moved — a scroll that begins on the location can never open the map.
 */
const LOCATION_MAP_MOVE_TOLERANCE = 8;

interface JobCardMetaRowProps {
  dateNeeded: string;
  startTime: string | null;
  /** Text shown after the date when `startTime` is empty — Posted uses
      "Flexible time", Applied uses "Flexible". */
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
}

/**
 * Date / location / expiry chip row shared by both
 * activity cards. Posted adds a few role-specific chips via `children`.
 */
export function JobCardMetaRow({
  dateNeeded,
  startTime,
  flexibleLabel = "Flexible",
  location,
  expiresAt,
  children,
  trailing,
  locationPressToMap = false,
}: JobCardMetaRowProps) {
  const mapHref = mapsSearchUrl(location);

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

  const city = getCity(location);

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
      <div className="flex items-center gap-x-2 min-[360px]:gap-x-3 sm:gap-x-5 flex-nowrap min-w-0 flex-1 overflow-hidden">
      {/* Location → date → time, matching the home feed ("Browse Tasks")
          card order so the two surfaces read consistently. */}
      {locationPressToMap ? (
        /* PRESS-TO-MAP. See `locationPressToMap` on the props for why.

           A <button>, not an <a>: the primary action of this control is now
           "expand the card", and an anchor whose activation does not follow its
           own href is a lie to every user agent that reads it. The href moved
           to the real anchor below, which is where the map action actually
           lives for both the gesture and assistive tech. */
        <span className="flex items-center min-w-0 shrink">
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
            /* DISCOVERABILITY, part 1 — the chip has to LOOK pressable.
               A hidden gesture on text that renders like the date and time
               beside it will never be found. A tinted, bordered, rounded
               surface with an active-press state is the app's own vocabulary
               for "this is a control", and it is the only chip in the row that
               wears it, so the difference is the affordance.

               `py-2 -my-2` is kept verbatim from the anchor it replaces: it
               grows the HIT AREA to 44px without growing the layout box (the
               chip measured 77x16, a third of the app's 44px floor). The
               overhang lands on the card's own padding, never on another
               control — the row's only other interactive element is pinned to
               the opposite end. */
            className="flex items-center gap-1 min-[360px]:gap-1.5 py-2 -my-2 px-1 -mx-1 rounded-ds-sm border border-[hsl(var(--olivewood)/0.22)] bg-[hsl(var(--olivewood)/0.06)] hover:bg-[hsl(var(--olivewood)/0.12)] hover:text-primary active:bg-[hsl(var(--olivewood)/0.20)] active:scale-[0.97] transition-all duration-150 min-w-0 shrink"
            /* DISCOVERABILITY, part 2 — say it in words, for everyone.
               `aria-label` states BOTH actions so a screen-reader user is told
               the tap expands (which is not guessable) and `aria-describedby`
               points at the visible "Hold for map" hint, so the sighted and the
               non-sighted affordance are the same sentence. `title` gives the
               desktop pointer user the same line on hover. */
            aria-label={`${city} — tap to expand this job`}
            title={`${city} — tap to expand, hold for the map`}
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{city}</span>
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
          className="flex items-center gap-1.5 py-2 -my-2 hover:text-primary transition-colors min-w-0 shrink"
        >
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{city}</span>
        </a>
      )}
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Calendar className="w-3 h-3 shrink-0" />
        {formatJobDate(dateNeeded)}
      </span>
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Clock className="w-3 h-3 shrink-0" />
        {!startTime
          ? flexibleLabel
          : new Date(`2000-01-01T${startTime}`).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
      </span>
      {/* No "3h" estimate chip. Post a Job has no estimated-hours field any
          more (owner), so on every job posted since it was dropped this
          rendered nothing, and on the older ones it showed a second clock icon
          beside the start time for a number the poster can no longer set or
          correct. The column and its edit field are untouched — this is the
          card display only. */}
      {expiresAt
        ? (() => {
            const expiry = new Date(expiresAt);
            const expired = expiry <= new Date();
            const expiringSoon = differenceInHours(expiry, new Date()) < 24;
            const text = expired ? "Expired" : formatTimeLeft(expiry);
            return (
              <span
                className={`flex items-center gap-1 ${expiringSoon ? "text-destructive font-medium" : ""}`}
              >
                <Timer className="w-3 h-3 shrink-0" /> {text}
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
