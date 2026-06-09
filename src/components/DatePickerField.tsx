import { lazy, Suspense, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/dateUtils";

// react-day-picker (the Calendar's dependency) is sizeable and only ever
// renders inside the tap-to-open Popover below — defer its chunk until a
// date picker is actually opened.
const Calendar = lazy(() =>
  import("@/components/ui/calendar").then((m) => ({ default: m.Calendar })),
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
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDate(value) : undefined;
  const minDate = min ? parseLocalDate(min) : new Date();
  // Strip time so today is selectable
  minDate.setHours(0, 0, 0, 0);
  const maxDate = max ? parseLocalDate(max) : undefined;
  maxDate?.setHours(0, 0, 0, 0);

  const formatted = selected
    ? selected.toLocaleDateString(undefined, {
        weekday: "short",
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
          className={cn(
            "flex h-12 w-full items-center justify-between rounded-2xl border border-input glass-field px-4 text-[15px] text-left ring-offset-background transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:border-ring",
            !selected && "text-muted-foreground/70",
            className,
          )}
        >
          <span className="truncate">{formatted}</span>
          <CalendarIcon className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 rounded-2xl" align="start" sideOffset={8}>
        <Suspense
          fallback={<div className="h-[19rem] w-[17rem] animate-pulse rounded-2xl bg-muted/40" aria-hidden />}
        >
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
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

export default DatePickerField;
