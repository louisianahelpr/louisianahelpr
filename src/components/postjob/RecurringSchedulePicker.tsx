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
            ragged lines at narrow widths and stop reading as a week. */}
        <div role="group" aria-label="Days of the week" className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label, d) => {
            const active = days.includes(d);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(d)}
                // A chosen day has to be unmistakable at a glance across a row
                // of seven, from the far side of a phone. The translucent
                // bark/0.10 tint that reads fine on a two-or-three-chip row
                // (filters, decline reasons) does not survive being repeated
                // seven times: the eye cannot pick three tinted cells out of
                // seven at a glance. Solid fill and inverted ink is the same
                // treatment the job-type control above uses for exactly this
                // reason, so the two rows also stop disagreeing.
                className="h-11 rounded-ds-md text-ds-11 font-semibold transition-all active:scale-[0.97]"
                style={{
                  background: active ? "hsl(var(--bark))" : "hsl(var(--ivory-sand) / 0.55)",
                  color: active ? "hsl(var(--parchment))" : "hsl(var(--olivewood) / 0.85)",
                  border: active
                    ? "0.5px solid hsl(var(--bark))"
                    : "0.5px solid hsl(var(--olivewood) / 0.2)",
                }}
              >
                {label}
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
              <> · <span className="text-primary">${formatPriceExact(total)}</span> total</>
            )}
          </p>
          {budget > 0 && (
            // Spelled out because the budget field says "$50" and the commitment
            // is the other number. Never let the smaller figure be the only one
            // on screen at the moment they decide.
            <p className="text-ds-11 text-muted-foreground leading-snug">
              ${formatPriceExact(budget)} per visit, charged a few days before each
              one — not all at once.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default RecurringSchedulePicker;
