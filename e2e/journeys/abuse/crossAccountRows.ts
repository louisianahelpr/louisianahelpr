/**
 * Which rows an IDOR read returned that the reader has NO party right to.
 *
 * 2026-11-10 (e2e-abuse-notifications 42860928141): the "neither account can
 * read the other's applications" check failed on application b47b1961. Read on
 * prod 2026-11-15: its job (7f02689d, "SEED TEST Wash two cars", seeded
 * 2026-11-09) is OWNED by the helper test account and the poster test account
 * is the applicant, so the live policy "Job owners can view applications for
 * their jobs" correctly lets the helper see it. A job owner seeing an applicant
 * is the product, not a leak; asserting `[]` on every row convicted the seed.
 *
 * A row on a job the reader owns is a party read and is left out. Every other
 * row is a leak. The owned set comes from the reader's own `jobs` read, so a
 * job the reader cannot see never excuses a row (an embedded `jobs!inner` would
 * DROP a leaked row whose job RLS hides, and pass the check on a real leak).
 */
export function crossAccountApplicationRows<T extends { job_id: string | null }>(rows: T[], readerOwnedJobIds: Iterable<string>): T[] {
  const owned = new Set(readerOwnedJobIds);
  return rows.filter((r) => r.job_id === null || !owned.has(r.job_id));
}
