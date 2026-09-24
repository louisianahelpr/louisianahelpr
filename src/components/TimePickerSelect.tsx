/** Format a "HH:mm" or "HH:mm:ss" time string to 12-hour display */
export function formatTime12(time: string | null | undefined): string {
  if (!time || time === "flexible") return "Flexible";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
