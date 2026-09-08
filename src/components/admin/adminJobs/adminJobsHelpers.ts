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

/**
 * A job that is OPEN in the marketplace with no money behind it.
 *
 * `useJobSubmit`'s `cleanupOrphanJob` names the failure exactly: a job whose
 * payment setup failed and whose cleanup DELETE then matched zero rows leaves
 * "an orphan in the marketplace with NO escrow behind it — browsable,
 * applicable-to, and impossible to pay out". That cleanup is best-effort by
 * design (it must not throw over the error that triggered it), so when it does
 * not land, nothing else notices. Helpers apply to the job, spend a pitch on
 * it, and the job can never be awarded.
 *
 * Until now the class was invisible: the admin Jobs queue flagged spam
 * keywords, odd budgets and past dates — every signal about a HUMAN — and had
 * nothing at all for "the platform's own checkout dropped this on the floor".
 * An operator could only find one by reading raw rows.
 */
export const GHOST_JOB_FLAG = "Open with no escrow behind it";

/**
 * Payment states that mean money is genuinely committed to the job.
 *
 * Derived from `jobs_payment_status_check`, whose full admitted set is
 * unpaid · escrow · payout_pending · released · refunded · cancelled ·
 * abandoned · failed · chargeback · cancelling. Only these three mean funds
 * exist; every other value on an OPEN job means the listing is live and the
 * money is not. Listed as the FUNDED set rather than as a blocklist on
 * purpose: a new payment state added later defaults to "not funded", which is
 * the safe direction for a detector whose whole job is to notice absence.
 */
const FUNDED_PAYMENT_STATUSES = new Set(["escrow", "payout_pending", "released"]);

/**
 * Grace period before an unfunded open job counts as a ghost.
 *
 * A job row is inserted BEFORE Stripe Checkout completes — that ordering is
 * the design, not a bug — so for a few minutes after posting, `open` +
 * `unpaid` is simply a checkout in flight and flagging it would make the queue
 * cry wolf on every healthy post. Thirty minutes is far longer than any real
 * checkout and far shorter than the hourly sweeps, so a genuinely stranded row
 * is named while an in-progress one is left alone.
 */
export const GHOST_GRACE_MINUTES = 30;

/**
 * True when this job is live to helpers but has no funds behind it, and has
 * been that way long enough that a checkout cannot still be running.
 */
export function isGhostJob(job: Pick<Job, "status" | "payment_status" | "created_at">): boolean {
  if (job.status !== "open") return false;
  // A null payment_status is unfunded, not unknown — the column is only ever
  // written by the payment path.
  if (FUNDED_PAYMENT_STATUSES.has(job.payment_status ?? "")) return false;
  if (!job.created_at) return false;
  const ageMs = Date.now() - new Date(job.created_at).getTime();
  return Number.isFinite(ageMs) && ageMs > GHOST_GRACE_MINUTES * 60_000;
}

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

  // Platform-integrity, not moderation: this one is about OUR checkout, not
  // about the poster. It stays in the moderation set (so the row surfaces in
  // the default Flagged queue rather than needing to be gone looking for) and
  // the Ghosts tab gives the class its own view.
  if (isGhostJob(job)) flags.push(GHOST_JOB_FLAG);

  return flags;
}
