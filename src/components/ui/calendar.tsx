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
        // `relative` establishes the positioning context for `nav` below.
        // Without it the absolutely-positioned prev/next buttons resolved
        // against a far ancestor (the popover), escaped the calendar panel and
        // landed on top of the trigger above it.
        month: "space-y-4 relative",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "flex items-center gap-1 font-display italic font-bold text-ds-15 tracking-tight text-[hsl(var(--ink-deep))]",
        // captionLayout="dropdown": the native <select> sits transparently on
        // top of the styled label (which shows the value + a caret), so taps
        // open the OS picker while the calendar keeps its own typography.
        dropdowns: "flex items-center justify-center gap-1.5",
        dropdown_root: "relative inline-flex items-center",
        dropdown: "absolute inset-0 w-full h-full opacity-0 cursor-pointer",
        // Pinned across the caption row so the chevrons flank the month label
        // instead of floating at the panel's outer edges.
        nav: "absolute inset-x-0 top-1 z-10 flex items-center justify-between px-1",
        button_previous: cn(
          // `ghost`, not `outline`: the month arrows read as bare icon buttons,
          // matching ScheduleTab's own month nav (`variant="ghost" size="icon"`).
          // The 36px box stays as the hit area — only the border is gone.
          buttonVariants({ variant: "ghost" }),
          "h-11 w-11 bg-transparent p-0 opacity-60 hover:opacity-100",
          isDropdown && "top-[1.25rem]",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "h-11 w-11 bg-transparent p-0 opacity-60 hover:opacity-100",
          isDropdown && "top-[1.25rem]",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        // WEEKDAY HEADERS USE --accent-ink, NOT --burnt-sienna. At
        // `--burnt-sienna/0.78` they measured 3.26:1 on a dark card against a
        // 4.5:1 AA floor, and raw sienna cannot clear AA on dark at ANY alpha
        // below 1.0 (ladder on the dark card: 0.78 → 3.26, 0.85 → 3.63, 0.9 →
        // 3.91, 1.0 → 4.53) — the token is a brand accent, not an ink.
        // `--accent-ink` is the app's existing accent-AS-TEXT split: identical
        // to --burnt-sienna in light (19 75% 35%, so LIGHT MODE IS UNCHANGED
        // but for the alpha step) and lifted to 19 70% 66% in dark precisely so
        // small labels clear 4.5:1 there. At 0.9 it measures 4.86:1 — over the
        // floor, under full strength, so the header row stays quieter than the
        // ink-deep day numbers it labels.
        weekday: "rounded-md w-9 font-sans uppercase text-ds-10 tracking-[0.18em] text-[hsl(var(--accent-ink)/0.9)]",
        week: "flex w-full mt-2",
        day: "h-11 w-11 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(buttonVariants({ variant: "ghost" }), "h-11 w-11 p-0 font-sans font-medium text-[hsl(var(--ink-deep))] aria-selected:opacity-100 rounded-full"),
        range_end: "day-range-end",
        selected:
          "!bg-[hsl(var(--bark))] !text-[hsl(var(--parchment))] hover:!bg-[hsl(var(--bark))] focus:!bg-[hsl(var(--bark))] shadow-[0_1px_2px_hsl(var(--bark)/0.18)] font-sans font-bold",
        today:
          "!bg-[hsl(var(--burnt-sienna)/0.10)] !text-[hsl(var(--burnt-sienna))] !font-sans !font-bold ring-1 ring-[hsl(var(--burnt-sienna)/0.28)]",
        outside: "day-outside text-[hsl(var(--olivewood)/0.8)] opacity-60 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        // DELIBERATELY LEFT BELOW AA, and pinned as such in
        // src/test/lowAlphaForegroundContrast.test.ts. This is the INACTIVE
        // state of a day button — react-day-picker renders it `disabled` — and
        // WCAG 1.4.3 exempts "text that is part of an inactive user interface
        // component" from the 4.5:1 floor by name. Darkening it would not be a
        // fix: a disabled day that reads as legible as an enabled one is a NEW
        // defect, and the `opacity-50` beside it says the same thing twice on
        // purpose. Measured 1.99:1 light / 2.47:1 dark, which is the point.
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
