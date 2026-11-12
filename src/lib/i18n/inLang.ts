/**
 * A word by its KEY for a Spanish reader, else the English given (F260q). For English tables that stay the English
 * (CONDITION_LABEL, SIZE_LABEL, CATEGORY_LABEL...) drawn by a file that does not load their dictionary: English readers
 * get the table's own words, and a Spanish reader whose Spanish has not loaded yet gets them too, never a raw key.
 */
import type { MsgKey } from "./en";
import { getLang, t } from "./language";

export function wordInLang(key: string, english: string, vars?: Record<string, string | number>): string {
  if (getLang() !== "es") return english;
  const w = t(key as MsgKey, vars);
  return w === key ? english : w;
}
