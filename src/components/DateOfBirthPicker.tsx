import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateOfBirthPickerProps {
  /** ISO date string "YYYY-MM-DD" or "" */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}

/**
 * Friendly DOB picker:
 * - Single popover with shadcn Calendar
 * - Month + Year dropdowns for fast scrolling (no 3-step iOS wheel)
 * - Defaults the calendar view to ~25 years ago for adult signups
 */
export function DateOfBirthPicker({ value, onChange, id, className }: DateOfBirthPickerProps) {
  const today = React.useMemo(() => new Date(), []);
  const fromYear = today.getFullYear() - 100;
  const toYear = today.getFullYear() - 13;

  const selected = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const defaultMonth = React.useMemo(() => {
    if (selected) return selected;
    return new Date(today.getFullYear() - 25, today.getMonth(), 1);
  }, [selected, today]);

  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal rounded-xl",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {selected ? format(selected, "MMM d, yyyy") : <span>Select your birthday</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onChange(format(date, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          defaultMonth={defaultMonth}
          captionLayout="dropdown-buttons"
          fromYear={fromYear}
          toYear={toYear}
          disabled={(date) => date > today || date < new Date(fromYear, 0, 1)}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
