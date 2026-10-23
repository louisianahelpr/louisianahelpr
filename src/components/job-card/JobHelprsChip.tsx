import { Users } from "lucide-react";

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
/**
 * Q1409/Q1464: how many of a crew's spots to call "open", or null to show the
 * crew's size. Only a count below the size is news (a booked crew a member
 * left, re-listed for that spot); a staffing crew has every spot open and an
 * unknown count is unknown. The browse chip and the detail dialog's Helprs
 * tile both read this, so a job never says two things a tap apart.
 */
export function openCrewSpots(size: number | null | undefined, spotsOpen: number | null | undefined): number | null {
  const count = size && size > 0 ? size : 2;
  return spotsOpen != null && spotsOpen > 0 && spotsOpen < count ? spotsOpen : null;
}

export function JobHelprsChip({
  helpersNeeded,
  spotsOpen,
  className = "gap-1.5",
  iconClassName = "w-3 h-3",
}: {
  helpersNeeded?: number | null;
  /**
   * Q1409: on a browse card, how many spots on the crew are open now
   * (public.crew_spots_open). When fewer than the crew's size, the chip says
   * "1 spot open" instead of the size: a booked crew a member left is
   * re-listed for that spot only. Omitted (or equal to the size): the size.
   */
  spotsOpen?: number | null;
  /** Gap + any outer margin. Supplied by the row so it matches its siblings. */
  className?: string;
  iconClassName?: string;
}) {
  /* 2 is the floor a group job can have — `is_group_job` with a null
     `helpers_needed` is an older row, and "1 Helpr" is not a group. */
  const count = helpersNeeded && helpersNeeded > 0 ? helpersNeeded : 2;
  const open = openCrewSpots(count, spotsOpen);
  return (
    <span
      className={`inline-flex items-center shrink-0 whitespace-nowrap ${className}`}
      style={{ color: "hsl(var(--primary))" }}
    >
      <Users className={`${iconClassName} shrink-0`} strokeWidth={2.25} aria-hidden="true" />
      {open != null ? (
        <>
          <span className="font-sans font-medium">{`${open} spot${open === 1 ? "" : "s"} open`}</span>
          <span className="sr-only">{` on a crew of ${count}`}</span>
        </>
      ) : (
        <>
          <span className="font-sans font-medium">{count}</span>
          <span className="sr-only"> Helprs needed</span>
        </>
      )}
    </span>
  );
}
