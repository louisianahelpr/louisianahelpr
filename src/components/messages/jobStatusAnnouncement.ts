/**
 * A JOB'S STATUS CHANGING MUST CLOSE ITS THREAD IN PLACE — NOT ON THE NEXT TAP.
 *
 * ── THE DEFECT, MEASURED ON PROD 2026-09-19 ────────────────────────────────
 * With text in the composer, the other party cancels the job. The "Job
 * cancelled" system bubble arrives LIVE (the DB trigger writes a
 * `messages` row flagged `is_system` in the same transaction as the status
 * UPDATE, and the Messages realtime channel delivers it to both parties).
 * But the header still read OPEN and the composer stayed enabled, because
 * `threadClosed` in ChatView derives only from `activeConvo.messagingClosesAt`
 * — a value fetched ONCE when the inbox loaded, when the job was not yet
 * cancelled. Nothing re-asked.
 *
 * Pressing Send then "recovered" it: the insert bounced off RLS with 42501,
 * sendHandlers re-read the job, and the thread finally flipped to CANCELLED —
 * with the typed text converted into a failed "Not Sent" bubble. That is
 * FAIL-ON-TAP, which ChatComposer's own header says this codebase rejects: a
 * control that looks pressable being the one that does not work. It is the
 * same shape as the arrival gate rewritten earlier the same day.
 *
 * It also stranded a piece of UI: the dashed `thread-closed-unsent-draft`
 * "Not sent" box in ChatComposer, whose comment describes exactly this
 * cancellation case, was UNREACHABLE on it — by the time the thread closed,
 * the draft had already been cleared into the failed bubble. Closing before
 * the tap is what hands the draft to that box instead.
 *
 * ── WHY THE ANNOUNCEMENT IS A TRUSTWORTHY SOURCE ───────────────────────────
 * The instruction was: do not poll, and do not close on a STALE status. This
 * module reads neither a cached field nor a client clock. It reads the
 * announcement row the database itself wrote, inside the same transaction as
 * the transition, delivered by realtime — an EVENT, not a snapshot. Its
 * `created_at` is the server's own stamp for the moment the status moved,
 * which is the same instant `public.job_messaging_closes_at` anchors on
 * (`jobs.cancelled_at` for a cancellation — see migration 20260919220233).
 * So the client can never close AHEAD of the server: the server has already
 * been refusing sends since the instant this row was written.
 *
 * The wording is the trigger's own (migration 20260720130000
 * `insert_job_status_system_message`): `✓ Job awarded`, `▶ Work started`,
 * `✓ Job completed`, `✕ Job cancelled`, `⚠ Dispute opened`. Matching is on
 * whole words after the glyph is stripped, so "Job completed" can never be
 * caught by the "cancelled" rule and vice versa.
 */
import { MESSAGING_LOCKOUT_HOURS } from "@/lib/messagingLockout";
import type { Conversation } from "./types";

/**
 * Leading run of non-letter, non-digit characters — the `✓ ` / `▶ ` / `✕ ` /
 * `⚠ ` prefixes the DB trigger bakes into the stored content, plus any
 * emoji-presentation variant (`▶️`) or stray spacing around them.
 *
 * Stripped at READ rather than migrated in the database on purpose: rows
 * already written to `public.messages` carry the glyph, so a trigger-only
 * change would fix new threads and leave every existing one mixed.
 * SystemEventRow renders off the same helper, so the icon it picks and the
 * status this module derives can never disagree about what a row says.
 */
const LEADING_GLYPHS = /^[^\p{L}\p{N}]+/u;

export function stripSystemGlyphs(content: string | null | undefined): string {
  return (content ?? "").replace(LEADING_GLYPHS, "").trim();
}

/**
 * The patch an announcement implies for the thread that receives it.
 *
 * `messagingClosesAt` is `null` for the transitions that do NOT put a thread
 * on a clock. A null here means "leave whatever closing instant is already
 * held alone" — never "clear it". A completed job that is later disputed must
 * keep the completion's 24-hour deadline, not have it wiped by the dispute.
 */
export interface ThreadStatusPatch {
  /** The `job_status` enum value this announcement reports. */
  jobStatus: string;
  /** ISO closing instant implied by that status, or null if it implies none. */
  messagingClosesAt: string | null;
}

/**
 * How each announcement maps to a status, and whether that status closes the
 * thread. `closesAt` is handed the announcement's own server timestamp.
 *
 * Deliberately NOT a second copy of `job_messaging_closes_at`'s logic for
 * every branch — only the two statuses that close are given a formula, and
 * each mirrors one arm of that function:
 *   cancelled — closes at the cancellation instant itself, already in the
 *               past by the time anything reads it (the migration's own
 *               words: "already in the past by construction");
 *   completed — 24 hours after completion, the window that exists so a
 *               dispute has something to read.
 * The server remains the authority: this only decides when the CLIENT stops
 * offering a composer the server is already refusing.
 */
const ANNOUNCEMENTS: {
  matches: RegExp;
  jobStatus: string;
  closesAt: ((atMs: number) => number) | null;
}[] = [
  { matches: /\bawarded\b/i, jobStatus: "accepted", closesAt: null },
  { matches: /\bstarted\b/i, jobStatus: "in_progress", closesAt: null },
  // Before `complete`, because "cancelled" and "completed" both begin "c" and
  // a looser rule for either would swallow the other.
  { matches: /\bcancell?ed\b/i, jobStatus: "cancelled", closesAt: (at) => at },
  {
    matches: /\bcomplete(d)?\b/i,
    jobStatus: "completed",
    closesAt: (at) => at + MESSAGING_LOCKOUT_HOURS * 60 * 60 * 1000,
  },
  { matches: /\bdispute/i, jobStatus: "disputed", closesAt: null },
];

/**
 * Read one stored system message as a thread-status change.
 *
 * Returns null when the row is not a recognised status announcement (a
 * future transition, a hand-written system note, an unparseable timestamp) —
 * the caller then changes nothing, which is the safe direction: the thread
 * stays as the server last described it and the send path still explains a
 * refusal.
 */
export function threadPatchFromSystemMessage(
  content: string | null | undefined,
  at: string | null | undefined,
): ThreadStatusPatch | null {
  const label = stripSystemGlyphs(content);
  if (!label) return null;
  const rule = ANNOUNCEMENTS.find((r) => r.matches.test(label));
  if (!rule) return null;
  const atMs = at ? Date.parse(at) : NaN;
  if (Number.isNaN(atMs)) {
    // No usable instant — we still know WHAT happened, so the chip can move;
    // we just cannot say when the thread closes, so we do not claim to.
    return { jobStatus: rule.jobStatus, messagingClosesAt: null };
  }
  return {
    jobStatus: rule.jobStatus,
    messagingClosesAt: rule.closesAt
      ? new Date(rule.closesAt(atMs)).toISOString()
      : null,
  };
}

/** The subset of a `messages` row an announcement is read from. */
export interface AnnouncementRow {
  job_id?: string | null;
  content?: string | null;
  created_at?: string | null;
  is_system?: boolean;
}

/**
 * Fold an announcement into one conversation row, returning the row UNCHANGED
 * when the announcement is not about it (or is not an announcement at all).
 *
 * Kept here, beside the derivation, rather than inline in the hook, so the
 * whole chain — wording in, closed thread out — can be exercised without a
 * database, a channel or a React tree. Two invariants live in these six lines
 * and both have a guard:
 *   · a thread on ANOTHER job is never touched — a poster can have several
 *     threads open and only one of them is on the cancelled job;
 *   · `messagingClosesAt` is written, never cleared. A transition that puts no
 *     clock on the thread must not wipe the deadline an earlier one set.
 */
export function patchThreadForAnnouncement(
  convo: Conversation,
  msg: AnnouncementRow,
): Conversation {
  if (!msg.is_system || !msg.job_id || convo.jobId !== msg.job_id) return convo;
  const patch = threadPatchFromSystemMessage(msg.content, msg.created_at);
  if (!patch) return convo;
  return {
    ...convo,
    jobStatus: patch.jobStatus,
    messagingClosesAt: patch.messagingClosesAt ?? convo.messagingClosesAt,
  };
}
