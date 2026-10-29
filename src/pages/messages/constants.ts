import { isTeamThreadKey, teamUserIdFromKey } from "@/lib/teamThread";

export const CHAT_PAGE_SIZE = 50;

/**
 * `/messages` URL contract for "is a thread open".
 *
 * MobileNav hides the whole bottom dock while `?chat=` is present
 * (src/components/MobileNav.tsx) — an open conversation replaces the app
 * chrome with its own header, iOS-style. That makes the flag load-bearing:
 * if it is ever set while the LIST is on screen there is no bottom nav and
 * no way out of Messages at all.
 *
 * That is exactly what shipped. `openConvo` set the flag from component
 * state, and nothing on any path removed it, so:
 *   - open a thread → tap "View profile" → back → Messages remounts with
 *     `activeConvo` null but `?chat=1` still in the URL → stranded on the list;
 *   - worse on native: RouteMemory (src/components/RouteMemory.tsx) records
 *     `pathname + search`, so a WKWebView jetsam-reload restores the user to
 *     `/messages?chat=1` with no thread open — the owner's device repro.
 *
 * The invariant now enforced in Messages.tsx is: **the flag is present if and
 * only if a thread is actually open**, in both directions. Opening pushes the
 * flagged entry (so an OS/gesture back closes the thread instead of leaving
 * Messages); losing the flag closes the thread; a flag with no thread behind
 * it is stripped on sight.
 */
/**
 * The flag NAMES the open thread (F27, audit 2026-10-28; lead decision): `?chat=<jobId>&with=<userId>`.
 * It was `?chat=1`, which said "a thread is open" but not which, so route memory had to drop it and a
 * resume, a reload or a shared link landed on the inbox instead of the conversation. Now the URL is
 * enough to reopen that exact thread (threadFromChatFlag; Messages hands it to the deep-link loader).
 * A deleted-account thread has no other user to name, so it carries the job alone; a team thread
 * carries its `team:<user>` key. Guard: src/test/chatResumeReopensThread.test.tsx.
 */
export function chatOpenPath(c: { jobId: string; otherUserId: string | null }): string {
  const q = new URLSearchParams({ chat: c.jobId });
  if (c.otherUserId && !isTeamThreadKey(c.jobId)) q.set("with", c.otherUserId);
  return `/messages?${q.toString()}`;
}

/** The value old builds wrote: a thread is open, but it names none. Still stripped on sight. */
const LEGACY_CHAT_FLAG = "1";

/**
 * The thread an open-chat URL names, or null when it names none (no flag, or legacy `?chat=1`).
 * A job id with no `with` opens that job's chat only when it has exactly one other party (the
 * deep-link loader's own rule), otherwise the list.
 */
export function threadFromChatFlag(params: URLSearchParams): {
  jobId: string | null;
  userId: string | null;
  teamUserId: string | null;
} | null {
  const chat = params.get("chat");
  const jobId = chat && chat !== LEGACY_CHAT_FLAG ? chat : null;
  if (!jobId) return null;
  const teamUserId = teamUserIdFromKey(jobId);
  if (teamUserId) return { jobId: null, userId: null, teamUserId };
  return { jobId, userId: params.get("with") || null, teamUserId: null };
}
export const MESSAGES_LIST_PATH = "/messages";

/**
 * History-entry marker set on the entry `openConvo` pushes. Its presence is
 * how the in-app back affordance knows it can honestly `navigate(-1)` (same
 * result as the swipe/hardware back) rather than having to replace — which
 * would otherwise leave a duplicate list entry and a dead back press.
 */
export const THREAD_OPEN_STATE = { threadOpen: true } as const;

/** Reads the marker off a `location.state` of unknown shape. */
export function isThreadOpenEntry(state: unknown): boolean {
  return !!(state as { threadOpen?: boolean } | null)?.threadOpen;
}
