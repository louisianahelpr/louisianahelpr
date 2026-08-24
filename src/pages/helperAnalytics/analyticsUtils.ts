/** Month label from a Date: "Jun" */
export function shortMonth(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short" });
}

/** Day-of-week label from a number 0-6 (0 = Sunday) */
export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
