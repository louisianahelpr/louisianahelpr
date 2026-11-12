/**
 * The job card's status line in the member's language (F260q). jobStatusLine.ts keeps its English tables (the width
 * and copy guards measure them); for a Spanish reader each line is looked up by its CODE (cl.p.<PosterWait>,
 * cl.hn.<HelperWait>, ...: enCardLines.ts / esCardLines.ts), never by its English words. The English is not shipped a
 * second time: English readers get the table's own words, and a Spanish reader whose Spanish has not loaded yet gets
 * them too (never a raw key). Guard: src/test/cardLinesInSpanish.test.ts.
 */
import type { MsgKey } from "@/lib/i18n/en";
import { getLang, t } from "@/lib/i18n/language";
import { BUCKET_LABEL, type ActivityBucket } from "@/lib/activityBuckets";

/** The line for `key` in Spanish, else the English given (English reader, or Spanish not loaded yet). */
export function inLang(key: string, english: string, vars?: Record<string, string | number>): string {
  if (getLang() !== "es") return english;
  const w = t(key as MsgKey, vars);
  return w === key ? english : w;
}

/** An eyebrow: a bucket's word by its bucket, else the state's own (cl.pe.<id> / cl.he.<id>). */
export function eyebrowInLang(side: "p" | "h", id: string, english: string): string {
  if (getLang() !== "es") return english;
  const bucket = (Object.keys(BUCKET_LABEL) as ActivityBucket[]).find((b) => BUCKET_LABEL[b] === english);
  return inLang(bucket ? `cl.b.${bucket}` : `cl.${side}e.${id}`, english);
}

/** The card's times in the member's language ("Wed 9:00 AM" / "mié 9:00 a. m."). */
export function cardLocale(): string {
  return getLang() === "es" ? "es-US" : "en-US";
}
