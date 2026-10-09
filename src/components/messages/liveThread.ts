import type { Conversation } from "./types";

/**
 * Job states that mean "this work is still running", for the Active inbox tab.
 * `open` is deliberately absent: a thread on an open posting is somebody asking
 * about a job nobody has been awarded yet, which is a conversation, not a job in
 * progress. Completed / cancelled are equally absent — those threads are
 * history, and history lives under All.
 */
const LIVE_JOB_STATUSES = new Set([
  "accepted",
  "in_progress",
  "revision_requested",
  "disputed",
  "pending_approval",
]);

/**
 * What the Active tab shows, and the ONE predicate its count and the
 * hidden-unread banner derive from (ConversationList). A "Louisiana Helpr
 * Team" thread (src/lib/teamThread.ts) has no job status and is always live:
 * a direct line to staff is never "history".
 */
export const isLiveThread = (c: Conversation): boolean =>
  !!c.teamThread || (!!c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus));
