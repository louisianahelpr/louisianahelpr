import { safeStorage } from "@/lib/safeStorage";
import type { Job } from "./types";
import { isPastDue } from "@/lib/jobDate";

const RESOLVED_FLAGS_KEY = "admin_resolved_job_flags";

export const getResolvedFlags = (): Set<string> => {
  try { return new Set(JSON.parse(safeStorage.getItem(RESOLVED_FLAGS_KEY) || "[]")); }
  catch { return new Set(); }
};

export const saveResolvedFlags = (set: Set<string>) => {
  safeStorage.setItem(RESOLVED_FLAGS_KEY, JSON.stringify([...set]));
};

/**
 * The one auto-flag that is a STALENESS signal rather than a moderation
 * concern. Everything else in `detectFlags` is a reason to look at a human's
 * behaviour — spam keywords, a phone number in the description, a budget that
 * makes no sense. "Date needed is in the past" just means the calendar moved.
 *
 * It is also, by a wide margin, the most common flag: on prod every one of the
 * 20 jobs in the queue carried it and nothing else, so the moderation list
 * rendered twenty identical red banners down the page. Twenty alarms that are
 * all the same alarm is not twenty alarms, it is wallpaper — and it buried the
 * one card that had a real flag on it. Split out here so the list can render it
 * as a quiet amber note, keep the destructive treatment for actual moderation
 * flags, and sort staleness-only rows to the bottom.
 */
export const STALE_DATE_FLAG = "Date needed is in the past";

/** Moderation flags only — the staleness signal removed. */
export const moderationFlags = (flags: string[] | undefined): string[] =>
  (flags ?? []).filter((f) => f !== STALE_DATE_FLAG);

/** True when the only thing wrong with this job is that its date has passed. */
export const isStaleOnly = (flags: string[] | undefined): boolean =>
  !!flags?.includes(STALE_DATE_FLAG) && moderationFlags(flags).length === 0;

// ─── Auto-flag logic ──────────────────────────────────────
export function detectFlags(job: Job): string[] {
  const flags: string[] = [];
  const desc = (job.description || "").toLowerCase();
  const title = (job.title || "").toLowerCase();
  const combined = `${title} ${desc}`;

  // Unreasonably high budget for the category
  if (job.budget > 5000) flags.push("Very high budget ($" + job.budget + ")");

  // Suspiciously low budget with long hours
  if (job.budget <= 10 && (job.estimated_hours || 0) >= 4) flags.push("Very low pay for estimated hours");

  // Spam / scam keywords
  const spamWords = ["cashapp", "venmo", "zelle", "wire transfer", "western union", "crypto", "bitcoin", "pay outside", "off platform", "cash only", "gift card", "send money", "wire me", "advance payment"];
  for (const word of spamWords) {
    if (combined.includes(word)) {
      flags.push("Contains suspicious payment keyword: \"" + word + "\"");
      break;
    }
  }

  // Personal info patterns
  const phoneRegex = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (phoneRegex.test(combined)) flags.push("Contains phone number in description");
  if (emailRegex.test(combined)) flags.push("Contains email in description");

  // Very short/empty description
  if (desc.trim().length < 10) flags.push("Description too short or vague");

  // Excessive caps (yelling)
  const upperCount = (job.description || "").replace(/[^A-Z]/g, "").length;
  const totalAlpha = (job.description || "").replace(/[^a-zA-Z]/g, "").length;
  if (totalAlpha > 20 && upperCount / totalAlpha > 0.7) flags.push("Excessive caps (possible spam)");

  // Date in the past — BOTH SIDES in the platform's zone.
  //
  // This compared `new Date(date_needed)`, which is UTC midnight for a bare
  // YYYY-MM-DD, against `new Date(new Date().toDateString())`, which is LOCAL
  // midnight. In Central those are 00:00Z and 05:00Z, so a job dated TODAY was
  // always "earlier than today" and the moderation queue flagged every
  // same-day job as overdue. Eight active jobs dated today on prod, zero
  // actually past.
  if (isPastDue(job.date_needed)) {
    flags.push(STALE_DATE_FLAG);
  }

  return flags;
}
