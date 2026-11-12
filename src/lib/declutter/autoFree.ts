/**
 * "If it doesn't sell, make it free after __ days" (OWN-FREE; owner request via the lead, 2026-10-30): Never (the
 * default for every new listing), 7, 14, 21 or 30 days. The server holds the same list
 * (declutter_item_private_auto_free_days_choice and declutter_set_auto_free_days, migration 20261030030408);
 * src/test/declutterAutoFreeDays.test.ts keeps the two equal. Pure: no React, no network.
 */
import { enListingParts } from "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

export const AUTO_FREE_DAY_CHOICES = [7, 14, 21, 30] as const;

export const AUTO_FREE_LABEL = enListingParts["lp.afLabel"];

/** The choices: Never first (the default), named so it can't be read as "never drop", then each day count. */
export const AUTO_FREE_OPTIONS: { value: string; label: string }[] = [
  { value: "never", label: enListingParts["lp.afNeverOption"] },
  ...AUTO_FREE_DAY_CHOICES.map((d) => ({ value: String(d), label: enListingParts["lp.afDays"].replace("{n}", String(d)) })),
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
  if (days === null) return t("lp.afNever");
  return t("lp.afExplainer", { n: days });
}

/** The toast after a change is saved. */
export function autoFreeSaved(days: number | null): string {
  return days === null ? t("lp.afNever") : t("lp.afSaved", { n: days });
}
