import { lazy, Suspense, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/dateUtils";

// react-day-picker (the Calendar's dependency) is sizeable and only ever
// renders inside the tap-to-open Popover below — defer its chunk until a
// date picker is actually opened.
const Calendar = lazy(() =>
  import("@/components/ui/calendar").then((m) => ({ default: m.Calendar })),
);
const DateWheelPicker = lazy(() =>
  import("@/components/DateWheelPicker").then((m) => ({ default: m.DateWheelPicker })),
);

interface DatePickerFieldProps {
  /** ISO date string `YYYY-MM-DD` (matches existing form state) */
  value: string;
  onChange: (value: string) => void;
  /** ISO date string `YYYY-MM-DD` — earliest selectable day. Defaults to today. */
  min?: string;
  /**
   * ISO date string `YYYY-MM-DD` — latest selectable day. When set, the
   * caption switches to bounded month/year dropdowns (so a date that may be
   * decades from "today", like a birthday, is reachable without paging the
   * calendar one month at a time) and the popover opens at this month.
   */
  max?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  /** Forwarded to the trigger button so a field error (e.g. Signup's
   *  `dob-error`) is announced with the control, not just painted near it. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /**
   * Swap the calendar grid for month/day/year scroll wheels. Opt-in: a grid
   * is right for "which day next week", a wheel is right for a birthday,
   * where the year is the field you actually have to travel in.
   */
  wheel?: boolean;
}

/**
 * iOS-style date input. Renders a tappable pill that opens a calendar
 * popover. Keeps the form state as `YYYY-MM-DD` so existing validation,
 * Stripe payloads, and Supabase columns continue to work unchanged.
 */
export function DatePickerField({
  value,
  onChange,
  min,
  max,
  placeholder = "Select a date",
  id,
  className,
  wheel = false,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDate(value) : undefined;
  const minDate = min ? parseLocalDate(min) : new Date();
  // Strip time so today is selectable
  minDate.setHours(0, 0, 0, 0);
  const maxDate = max ? parseLocalDate(max) : undefined;
  maxDate?.setHours(0, 0, 0, 0);

  // Weekday is shown for scheduling ("Thu, June 26" tells you it's a
  // weekday) but is noise on a birthday, where nobody cares which day of
  // the week they were born on.
  const formatted = selected
    ? selected.toLocaleDateString(undefined, {
        ...(wheel ? {} : { weekday: "short" as const }),
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-describedby={ariaDescribedby}
          aria-invalid={ariaInvalid}
          className={cn(
            "flex h-12 w-full items-center justify-between rounded-2xl border border-input glass-field px-4 text-ds-15 text-left ring-offset-background transition-colors",
            // Softer, flush focus ring — the full-strength bark ring reads
            // too bright on the frosted glass fill, so use a half-opacity
            // ring with no offset gap to match the glass-field focus style.
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-0 focus-visible:border-ring/60",
            !selected && "text-muted-foreground/70",
            className,
          )}
        >
          <span className="truncate">{formatted}</span>
          <CalendarIcon className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 rounded-2xl"
        align="start"
        sideOffset={8}
        // Radix focuses the first focusable child on open. Inside the wheel
        // that is the topmost month row, and focusing it scrolls the column
        // to the top — so every wheel opened a few rows off its own value.
        onOpenAutoFocus={wheel ? (e) => e.preventDefault() : undefined}
      >
        <Suspense
          fallback={<Skeleton className="h-[19rem] w-[17rem] rounded-2xl" aria-hidden />}
        >
          {wheel && maxDate ? (
            <DateWheelPicker
              value={value}
              onChange={onChange}
              minDate={minDate}
              maxDate={maxDate}
            />
          ) : (
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (!d) return;
              // Format as local YYYY-MM-DD (NEVER toISOString → UTC drift)
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              onChange(`${yyyy}-${mm}-${dd}`);
              setOpen(false);
            }}
            disabled={(d) => d < minDate || (maxDate ? d > maxDate : false)}
            defaultMonth={selected ?? maxDate}
            startMonth={maxDate ? minDate : undefined}
            endMonth={maxDate}
            captionLayout={maxDate ? "dropdown" : undefined}
            autoFocus
            className={cn("p-3 pointer-events-auto")}
          />
          )}
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

export default DatePickerField;
