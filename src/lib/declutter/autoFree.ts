/**
 * "If it doesn't sell, make it free after __ days" (OWN-FREE; owner request via the lead, 2026-10-30): Never (the
 * default for every new listing), 7, 14, 21 or 30 days. The server holds the same list
 * (declutter_item_private_auto_free_days_choice and declutter_set_auto_free_days, migration 20261030030408);
 * src/test/declutterAutoFreeDays.test.ts keeps the two equal. Pure: no React, no network.
 */
export const AUTO_FREE_DAY_CHOICES = [7, 14, 21, 30] as const;

export const AUTO_FREE_LABEL = "If it doesn't sell, make it free after";

/** The choices: Never first (the default), named so it can't be read as "never drop", then each day count. */
export const AUTO_FREE_OPTIONS: { value: string; label: string }[] = [
  { value: "never", label: "Never make it free" },
  ...AUTO_FREE_DAY_CHOICES.map((d) => ({ value: String(d), label: `${d} days` })),
];

export function autoFreeValue(days: number | null): string {
  return days === null ? "never" : String(days);
}

export function autoFreeDaysFrom(value: string): number | null {
  const n = Number(value);
  return (AUTO_FREE_DAY_CHOICES as readonly number[]).includes(n) ? n : null;
}

/** What the choice does, in one line under the dropdown. */
export function autoFreeExplainer(days: number | null): string {
  // About free only (owner 2026-10-30): it once said "It stays at your price" here, which a seller read as "no price drops".
  if (days === null) return "It won't become free on its own. This has nothing to do with price drops.";
  return `If it hasn't sold by day ${days}, it becomes free and anyone nearby can claim it. Already past day ${days}? It becomes free tonight.`;
}

/** The line before Post: about free only, so it can't be read as "never drop". */
export function autoFreeOutcomeLine(days: number | null): string {
  return days === null ? "Make it free: never. It won't become free on its own." : `Make it free: after ${days} days, if it hasn't sold.`;
}

/** The toast after a change is saved. */
export function autoFreeSaved(days: number | null): string {
  return days === null ? "It won't become free on its own." : `If it hasn't sold by day ${days}, it becomes free.`;
}
