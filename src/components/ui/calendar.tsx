import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// classNames + components keys follow the react-day-picker v9/v10 schema
// (v8's `caption`/`cell`/`head_cell`/`nav_button_*` and the IconLeft/
// IconRight components were renamed in the v9 overhaul).
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  // In dropdown caption mode the month/year selects render a taller row than
  // the single-line label, so the absolute-positioned arrows (which pin to the
  // top) need to drop down to sit level with the "June 2008" row.
  const isDropdown = props.captionLayout === "dropdown";
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "flex items-center gap-1 font-display italic font-bold text-[0.95rem] tracking-tight text-[hsl(var(--ink-deep))]",
        // captionLayout="dropdown": the native <select> sits transparently on
        // top of the styled label (which shows the value + a caret), so taps
        // open the OS picker while the calendar keeps its own typography.
        dropdowns: "flex items-center justify-center gap-1.5",
        dropdown_root: "relative inline-flex items-center",
        dropdown: "absolute inset-0 w-full h-full opacity-0 cursor-pointer",
        nav: "space-x-1 flex items-center",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-9 w-9 bg-transparent p-0 opacity-60 hover:opacity-100 border-[hsl(var(--olivewood)/0.18)] absolute left-1",
          isDropdown && "top-[1.25rem]",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-9 w-9 bg-transparent p-0 opacity-60 hover:opacity-100 border-[hsl(var(--olivewood)/0.18)] absolute right-1",
          isDropdown && "top-[1.25rem]",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "rounded-md w-9 font-serif italic uppercase text-[0.6rem] tracking-[0.18em] text-[hsl(var(--burnt-sienna)/0.78)]",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-sans font-medium text-[hsl(var(--ink-deep))] hover:bg-[hsl(var(--bark)/0.10)] aria-selected:opacity-100 rounded-full"),
        range_end: "day-range-end",
        selected:
          "!bg-[hsl(var(--bark))] !text-[hsl(var(--parchment))] hover:!bg-[hsl(var(--bark))] focus:!bg-[hsl(var(--bark))] shadow-[0_1px_2px_hsl(var(--bark)/0.18)] font-display italic font-bold",
        today:
          "!bg-[hsl(var(--burnt-sienna)/0.10)] !text-[hsl(var(--burnt-sienna))] !font-display !italic !font-bold ring-1 ring-[hsl(var(--burnt-sienna)/0.28)]",
        outside: "day-outside text-[hsl(var(--olivewood)/0.8)] opacity-60 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-[hsl(var(--olivewood)/0.35)] opacity-50",
        range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === "left") return <ChevronLeft className="h-4 w-4" />;
          if (orientation === "right") return <ChevronRight className="h-4 w-4" />;
          // up / down — the caret next to a dropdown caption
          return <ChevronDown className="h-3.5 w-3.5 opacity-60" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
