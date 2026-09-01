import { Repeat, Minus, Plus } from "lucide-react";

import { Label } from "@/components/ui/label";
import { formatPriceExact } from "@/lib/format";
import {
  MAX_RECURRENCE_WEEKS,
  WEEKDAY_LABELS,
  recurringVisitDates,
  seriesTotalDollars,
} from "@/lib/recurringSchedule";

interface RecurringSchedulePickerProps {
  /** Weekdays selected, 0=Sun..6=Sat. */
  days: number[];
  setDays: (next: number[]) => void;
  weeks: number;
  setWeeks: (next: number) => void;
  /** The job's `date_needed` — the series starts here. */
  startDate: string;
  /** Per-visit budget, in dollars. */
  budget: number;
}

/**
 * Pick the weekdays a job repeats on, and for how many weeks.
 *
 * This replaces a single Daily/Weekly/Biweekly/Monthly dropdown that could not
 * express the most ordinary request there is — "Monday, Wednesday and Friday
 * for the next three weeks". The closest a poster could get was Daily, which
 * also booked them Saturday and Sunday.
 *
 * The preview underneath is not decoration. `budget` is PER VISIT, so a series
 * commits the poster to considerably more than the number in the budget field,
 * and they have to see that figure BEFORE they pay for the first one. The old
 * screen showed a total built from a guessed occurrence count while charging
 * for a single visit, which is how "roughly $600 total" came to sit above a $50
 * charge.
 */
export function RecurringSchedulePicker({
  days, setDays, weeks, setWeeks, startDate, budget,
}: RecurringSchedulePickerProps) {
  const toggle = (d: number) =>
    setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b));

  const dates = recurringVisitDates(startDate, days, weeks);
  const total = seriesTotalDollars(budget, startDate, days, weeks);
  const clampWeeks = (n: number) => Math.max(1, Math.min(MAX_RECURRENCE_WEEKS, n));

  return (
    <div className="rounded-ds-md border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Repeat className="w-4 h-4 text-primary" />
        <span className="text-ds-13 font-semibold text-foreground">Repeats</span>
      </div>

      <div className="space-y-2.5">
        <Label>Which days?</Label>
        {/* Seven fixed columns, Sunday first — a calendar week, in the order
            people read one. A wrapping chip row would reflow Sun–Sat into
            ragged lines at narrow widths and stop reading as a week.

            THE TWO CLASSES BELOW ARE LOAD-BEARING ON A PHONE, and their absence
            was a defect no overflow assertion could see. A grid item defaults
            to `min-width: auto`, i.e. min-CONTENT — so each cell refused to go
            below the intrinsic width of its three-letter label (44px) while the
            seven tracks at 375 are only 34px wide, and at 320 only 26px.
            Measured before the fix: ALL SIX adjacent pairs overlapped at both
            widths, "Mon" sat on top of "Sun", and the row escaped its own card
            by 14px (375) / 22px (320). `document.documentElement.scrollWidth`
            never moved, because the card clips it — which is exactly why this
            shipped: the page reports zero horizontal overflow and the row is
            still visibly broken. Only a screenshot showed it.
            `min-w-0` does NOT fix it, and that is the interesting part: the
            44px floor is the GLOBAL tap-target rule at index.css:1543
            (`button:not([role=checkbox])…{min-width:44px}`), whose selector is
            (0,3,1) — a Tailwind `min-w-0` at (0,1,0) loses. That rule is right
            and stays; overriding it inline would buy a fitting row by dropping
            the cells under the WCAG 2.5.5 target size, which is a worse defect
            than the one being fixed.

            So the row COUNT adapts instead of the cell size. Seven 44px cells
            plus six 4px gaps need 332px, and this column is `viewport − 140`
            (measured), so the week only fits across from ~480px up. Below that
            it wraps to four (then three at ≤329px) — every cell still ≥44×44,
            nothing overlapping, and it still reads Sunday-first in calendar
            order.

            The label also shortens to two letters — unambiguous across Su/Sa
            and Tu/Th where one letter is not, and DERIVED from WEEKDAY_LABELS
            rather than being a second hand-typed list — with the full day name
            moved to `aria-label`, so the accessible name gets better, not
            worse. */}
        <div role="group" aria-label="Days of the week" className="grid grid-cols-3 min-[330px]:grid-cols-4 min-[480px]:grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label, d) => {
            const active = days.includes(d);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                aria-label={label}
                onClick={() => toggle(d)}
                // A chosen day has to be unmistakable at a glance across a row
                // of seven, from the far side of a phone. The translucent
                // bark/0.10 tint that reads fine on a two-or-three-chip row
                // (filters, decline reasons) does not survive being repeated
                // seven times: the eye cannot pick three tinted cells out of
                // seven at a glance. Full fill and inverted ink it is.
                //
                // GLOSSY, VIA THE SHARED CLASS — measured, not asserted. A flat
                // `background: hsl(var(--bark))` is what shipped, and Chrome
                // reported `background-image: none` on the pressed cell at all
                // four breakpoints: a selected control painting itself bark
                // while every other selected surface in the app wears the
                // radial `.btn-grad-primary`. Two things this has to get right,
                // both of which have silently defeated the gloss before:
                //   1. NOT a Tailwind variant (`data-[…]:btn-grad-primary`
                //      compiles to nothing — variants only compose over
                //      utilities Tailwind generates, and this class lives in
                //      index.css). Toggled in JS instead.
                //   2. NO inline `background` SHORTHAND on the active cell — the
                //      shorthand resets `background-image` and the gradient
                //      disappears with the class still sitting on the element.
                //      Only the inactive cell keeps an inline background.
                className={`h-11 min-w-0 rounded-ds-md text-ds-11 font-semibold transition-all active:scale-[0.97] ${
                  active ? "btn-grad-primary" : ""
                }`}
                style={{
                  ...(active ? {} : { background: "hsl(var(--ivory-sand) / 0.55)" }),
                  color: active ? "hsl(var(--parchment))" : "hsl(var(--olivewood) / 0.85)",
                  border: active
                    ? "0.5px solid hsl(var(--bark-deep))"
                    : "0.5px solid hsl(var(--olivewood) / 0.2)",
                }}
              >
                {label.slice(0, 2)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        <Label htmlFor="recurrence-weeks">For how many weeks?</Label>
        {/* A stepper, not a free-text number field: the value is bounded 1–52
            (the DB enforces the same range) and a poster typing 200 should be
            told by the control's shape, not by a rejected submit. */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="One week fewer"
            disabled={weeks <= 1}
            onClick={() => setWeeks(clampWeeks(weeks - 1))}
            className="h-11 w-11 rounded-ds-md border border-border inline-flex items-center justify-center disabled:opacity-40"
          >
            <Minus className="w-4 h-4" />
          </button>
          <output
            id="recurrence-weeks"
            className="text-ds-15 font-semibold text-foreground tabular-nums min-w-[5.5rem] text-center"
          >
            {weeks} week{weeks === 1 ? "" : "s"}
          </output>
          <button
            type="button"
            aria-label="One week more"
            disabled={weeks >= MAX_RECURRENCE_WEEKS}
            onClick={() => setWeeks(clampWeeks(weeks + 1))}
            className="h-11 w-11 rounded-ds-md border border-border inline-flex items-center justify-center disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Three states, because "0 visits" is a nonsense answer to every one of
          them. The series starts on the job's own date, so with no date chosen
          there is nothing to count — and telling the poster "0 visits" reads as
          "your schedule is broken" when the real answer is "we need the date
          first, and it's the field above this one". */}
      {days.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground">
          Pick at least one day to see the schedule.
        </p>
      ) : dates.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground">
          Choose the date this starts (up in Schedule) and we&apos;ll show every visit.
        </p>
      ) : (
        <div className="rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2.5 space-y-1">
          <p className="text-ds-12 font-semibold text-foreground">
            {dates.length} visit{dates.length === 1 ? "" : "s"}
            {budget > 0 && (
              <> · <span className="text-primary">${formatPriceExact(total)}</span> in labor</>
            )}
          </p>
          {budget > 0 && (
            // Spelled out because the budget field says "$50" and the commitment
            // is the other number. Never let the smaller figure be the only one
            // on screen at the moment they decide.
            //
            // "before fees" is not hedging. `seriesTotalDollars` is
            // `budget x visits` and nothing else, but `charge-recurring-visits`
            // bills each later visit `budget + poster service fee + sales tax`
            // — the same line items the checkout screen itemises for visit one.
            // On a free-tier poster that is 12% the picker was not naming, so a
            // "$450 total" series actually settles above $500. Quoting a total
            // that is structurally lower than what gets charged is the exact
            // failure this preview was built to end; label it rather than
            // restate a fee rate here, which would be a second source of truth
            // for a number that lives in subscriptionTiers.
            <p className="text-ds-11 text-muted-foreground leading-snug">
              ${formatPriceExact(budget)} per visit before fees, charged a few days
              before each one — not all at once.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
