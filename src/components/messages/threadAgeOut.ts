/**
 * threadAgeOut — when a FINISHED job's thread stops appearing in the inbox's
 * All tab.
 *
 * ── THE DECISION (owner, 2026-09-19) ─────────────────────────────────────
 * "Keep them, auto-hide after a while. Never delete."
 *
 * ── WHY DELETION IS OFF THE TABLE ────────────────────────────────────────
 * A finished job's thread is EVIDENCE, and it sits on exactly the jobs most
 * likely to be argued about later:
 *   - the dispute flow's "Timeline & Evidence" control reads the thread;
 *   - the safety ladder (`reports`, `user_violations`,
 *     `message_violation_ladder`, `apply_message_scan_consequence`) keys off
 *     `messages` rows — the consequence ladder escalates on their COUNT, so
 *     removing rows would quietly de-escalate a repeat offender;
 *   - a completed job's messaging closes at +24h precisely so a dispute
 *     window still has a record to look at.
 * So this module HIDES FROM A VIEW. It reads; it never writes. Nothing here
 * deletes a message, and nothing here touches `thread_archives` — that is the
 * user's own explicit archive, a human decision an automatic rule must never
 * silently undo.
 *
 * ── WHICH MECHANISM DOES WHAT (read this before assuming one is redundant) ─
 * There are TWO separate reasons a finished thread leaves a view, and they
 * cover different tabs:
 *
 *   ACTIVE tab  — LIVE_JOB_STATUSES in ConversationList.tsx. `completed` and
 *                 `cancelled` are simply not live statuses, so finished
 *                 threads are absent from Active from the moment the job
 *                 finishes, at ANY age. Since 2026-09-19 Active is also the
 *                 tab the inbox lands on (lib/inboxDefault.ts), so this is
 *                 what keeps the DEFAULT view clear.
 *   ALL tab     — this module. All is the tab that means "everything", so a
 *                 finished thread stays there for a long time and only drops
 *                 out once nothing in the product can still send you back to
 *                 it. This is the only thing that ever trims All.
 *
 * Neither subsumes the other: the Active rule is status-only and instant, the
 * All rule is age-based and slow. Delete either and a real case regresses.
 *
 * ── THE THRESHOLD, DERIVED ───────────────────────────────────────────────
 * Not a round number. It is the last day the product itself can still send a
 * reader back to a finished job's thread, which is two live server rules laid
 * end to end:
 *
 *   1. REVIEW_WINDOW_DAYS = 30. `public.can_review_job` (verified live on
 *      prod, 2026-09-19) requires
 *      `COALESCE(poster_completed_at, helper_completed_at, updated_at) >
 *       now() - interval '30 days'`. Day 31, no review can be left at all.
 *   2. REVIEW_BLIND_HOLD_DAYS = 14. `public.set_review_visibility` holds the
 *      FIRST side's review invisible for 14 days when there is no reciprocal
 *      one. So a review left on the last legal day (30) does not become
 *      visible — and cannot be responded to via `respond_to_review`, which
 *      has no deadline of its own — until day 44.
 *
 * 30 + 14 = 44. After that, nothing in the app invites either party back to a
 * finished job's conversation. Shorten this only by shortening one of those
 * two server rules first; lengthening it is always safe.
 *
 * The formal dispute deadline (72h) and the revision acceptance window (72h)
 * both close long before day 44, so the review legs are the binding pair.
 *
 * ── THE ANCHOR ───────────────────────────────────────────────────────────
 * `messagingClosesAt`, not `lastAt`. Two reasons:
 *   - it is SERVER-derived (`get_messaging_closes_at`, the same expression
 *     the RLS gate uses), so the age is not read off the device clock — the
 *     caller passes `serverNow()`;
 *   - it means "when this thread closed", which is the fact being aged from.
 *     `lastAt` is the last MESSAGE, which can predate completion by weeks and
 *     would age out a job that finished yesterday.
 * A thread with no `messagingClosesAt` NEVER ages out. That is deliberate
 * fail-open: an un-deployed RPC or a failed fetch must not hide anything.
 *
 * ── THE UNREAD EXEMPTION ─────────────────────────────────────────────────
 * A thread with an unread message never ages out, at any age. A default view
 * must not conceal something the reader has not read — the same principle
 * that made the Active default ship with its "N unread in other
 * conversations" banner.
 *
 * ── AGED OUT IS NOT UNREACHABLE ──────────────────────────────────────────
 * Three live paths still reach an aged-out thread:
 *   1. The inbox's own search box. ConversationList applies this rule only
 *      when the search field is EMPTY, so typing a name or a job title finds
 *      the thread again. Searching is an explicit act; hiding a result from
 *      it would be lying.
 *   2. The Unread tab, via the exemption above.
 *   3. A deep link (`/messages?jobId=&userId=`), which is what the job
 *      card's Message control produces. That path resolves from
 *      `allConversations` — the pre-filter list — or rebuilds the thread
 *      outright via `buildDeepLinkPlaceholder`, and in both cases carries
 *      `messagingClosesAt` with it, so a reached-by-link finished thread
 *      still renders its read-only closed notice correctly.
 * If any of those three ever stops working, this stops being "hidden" and
 * starts being "deleted with extra steps".
 */
import type { Conversation } from "./types";

/** `public.can_review_job` — no review may be left after this many days. */
export const REVIEW_WINDOW_DAYS = 30;

/**
 * `public.set_review_visibility` — a first-and-only review stays invisible
 * this long, so the reply window opens only after it.
 */
export const REVIEW_BLIND_HOLD_DAYS = 14;

/** The last day the product can still send someone back to the thread. */
export const THREAD_AGE_OUT_DAYS = REVIEW_WINDOW_DAYS + REVIEW_BLIND_HOLD_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Job states that mean "this work is over" — the only ones that can age out. */
export const FINISHED_JOB_STATUSES = new Set(["completed", "cancelled"]);

/**
 * True when this thread should drop out of the All tab.
 *
 * `now` is the caller's responsibility and must be SERVER time
 * (`serverNow()` from lib/messagingLockout) — the same clock the closing
 * instant was stamped on.
 */
export function isThreadAgedOut(convo: Conversation, now: number): boolean {
  // Unread beats every other consideration. See the exemption note above.
  if (convo.unread > 0) return false;
  if (!convo.jobStatus || !FINISHED_JOB_STATUSES.has(convo.jobStatus)) return false;
  // No server-derived closing instant → no age → never hidden (fail-open).
  const closedAt = convo.messagingClosesAt ? Date.parse(convo.messagingClosesAt) : NaN;
  if (Number.isNaN(closedAt)) return false;
  return now - closedAt > THREAD_AGE_OUT_DAYS * DAY_MS;
}
