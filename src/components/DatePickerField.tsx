import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/dateUtils";

interface DatePickerFieldProps {
  /** ISO date string `YYYY-MM-DD` (matches existing form state) */
  value: string;
  onChange: (value: string) => void;
  /** ISO date string `YYYY-MM-DD` — earliest selectable day. Defaults to today. */
  min?: string;
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
  placeholder = "Select a date",
  id,
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDate(value) : undefined;
  const minDate = min ? parseLocalDate(min) : new Date();
  // Strip time so today is selectable
  minDate.setHours(0, 0, 0, 0);

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
            "flex h-12 w-full items-center justify-between rounded-2xl border border-input bg-background/70 backdrop-blur-sm px-4 text-[15px] text-left ring-offset-background transition-colors",
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
          disabled={(d) => d < minDate}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

export default DatePickerField;
