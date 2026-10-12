/**
 * An inbox row's age, relative so the list reads as "active", not as a stack
 * of full dates: "now", "5m", "3h", "2d", then "Oct 4".
 */
export function rowAge(lastAt: string, now: number = Date.now()): string {
  const ageMin = Math.floor((now - new Date(lastAt).getTime()) / 60000);
  const ageHr = Math.floor(ageMin / 60);
  const ageDay = Math.floor(ageHr / 24);
  return ageMin < 1 ? "now" :
    ageMin < 60 ? `${ageMin}m` :
    ageHr < 24 ? `${ageHr}h` :
    ageDay < 7 ? `${ageDay}d` :
    new Date(lastAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
