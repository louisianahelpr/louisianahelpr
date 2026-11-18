/**
 * Area 08 H3 (design audit 11-18): a Notification settings row's label and description, and a group header, in the
 * app language. Unknown keys keep the row's own English (a new row is never blank).
 */
import { t } from "./language";
import { enNotifPrefs } from "./enNotifPrefs";

type K = keyof typeof enNotifPrefs;
const has = (k: string): k is K => k in enNotifPrefs;

export function notifPrefLabel(key: string, fallback: string): string {
  const k = `np.l.${key}`;
  return has(k) ? t(k) : fallback;
}

export function notifPrefDescription(key: string, fallback: string | undefined): string | undefined {
  if (!fallback) return fallback;
  const k = `np.d.${key}`;
  return has(k) ? t(k) : fallback;
}

export function notifPrefGroup(title: string): string {
  const k = `np.g.${title}`;
  return has(k) ? t(k) : title;
}
