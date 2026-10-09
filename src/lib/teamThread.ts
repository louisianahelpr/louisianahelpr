/**
 * The "Louisiana Helpr Team" thread: an admin's direct conversation with one
 * user, opened from the admin User Profile dialog (owner, 2026-10-09; two-way).
 *
 * Every other thread is keyed on a job. A team-thread row has none
 * (`messages.job_id` NULL, `team_thread_user_id` = the user whose thread it is;
 * migration 20261009223503_team_thread_direct_messages.sql). The Messages page
 * keys threads by `${jobId}_${otherUserId}` throughout, so a team row is given a
 * SENTINEL job id at the moment it enters the client (`normalizeMessageRow`):
 * `team:<userId>`. It is never a uuid, so any job-scoped server call that is
 * accidentally handed it fails loudly (22P02) instead of reading the wrong job.
 * Every job-scoped call site asks `isTeamThreadKey` first and skips.
 *
 * Writes never go through a direct INSERT (RLS refuses a job-less row): the
 * staff side calls `admin_send_team_message`, the user `send_team_reply`.
 */

export const TEAM_THREAD_NAME = "Louisiana Helpr Team";
/** The app icon stands in for a face on the user's side of the thread. */
export const TEAM_THREAD_AVATAR = "/apple-touch-icon.png";

const PREFIX = "team:";

export const teamThreadKey = (teamUserId: string): string => `${PREFIX}${teamUserId}`;

export const isTeamThreadKey = (jobId: string | null | undefined): boolean =>
  typeof jobId === "string" && jobId.startsWith(PREFIX);

/** The user whose team thread this key names, or null for a job key. */
export const teamUserIdFromKey = (jobId: string | null | undefined): string | null =>
  isTeamThreadKey(jobId) ? (jobId as string).slice(PREFIX.length) : null;

/** Where a thread lives: the deep link the inbox, nav and notifications use. */
export const teamThreadLink = (teamUserId: string): string =>
  `/messages?teamThread=${encodeURIComponent(teamUserId)}`;

/**
 * The deep link that opens a conversation. Team thread: `?teamThread=`. Q262:
 * a deleted-account thread has no userId to link, and a jobId-only link opens
 * it when it is the job's only thread. Otherwise both params.
 */
export function conversationLink(c: {
  jobId: string;
  otherUserId: string | null;
  teamThread?: TeamThreadSide;
}): string {
  if (c.teamThread) return teamThreadLink(c.teamThread.userId);
  return c.otherUserId === null
    ? `/messages?jobId=${c.jobId}`
    : `/messages?jobId=${c.jobId}&userId=${c.otherUserId}`;
}

/**
 * A `messages` row as the database returns it -> the client's Message shape,
 * whose `job_id` is always a string. A team row's NULL job becomes its
 * sentinel key; a job row is returned unchanged.
 */
export function normalizeMessageRow<T extends { job_id: string | null; team_thread_user_id?: string | null }>(
  row: T,
): Omit<T, "job_id"> & { job_id: string } {
  if (row.job_id !== null) return row as Omit<T, "job_id"> & { job_id: string };
  return { ...row, job_id: teamThreadKey(row.team_thread_user_id ?? "") };
}

/** Which side of a team thread the viewer is on. */
export type TeamThreadSide = { userId: string; viewerIsStaff: boolean };
