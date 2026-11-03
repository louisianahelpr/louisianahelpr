/**
 * The Schedule tab's two-column layout (calendar | Upcoming jobs from 1024px, stacked below), in its own tiny
 * module so the loading placeholder (ProfileTabFallback) can draw the same grid without pulling ScheduleTab's
 * chunk onto the boot path (Q2013). The reasoning for the numbers lives on ScheduleTab's SCHEDULE_LAYOUT_CLASS.
 */
export const SCHEDULE_LAYOUT_CLASS =
  "grid grid-cols-1 gap-section items-start min-[1024px]:grid-cols-[clamp(320px,42%,480px)_minmax(0,1fr)] min-[1024px]:gap-6";
