/**
 * The saved-ids cache after an optimistic save or unsave.
 *
 * `undefined` in, `undefined` out: when the saved-ids read never succeeded
 * there is no list to edit, and React Query leaves the cache untouched when an
 * updater returns undefined. Seeding it with `[jobId]` used to turn a FAILED
 * read into a successful one-item list, so the saved-only feed showed that one
 * job as everything saved, with no error (lh-silent-failure review of Q1701).
 */
export function optimisticSavedIds(prev: string[] | undefined, jobId: string, saved: boolean): string[] | undefined {
  if (prev === undefined) return undefined;
  if (saved) return prev.includes(jobId) ? prev : [...prev, jobId];
  return prev.filter((id) => id !== jobId);
}
