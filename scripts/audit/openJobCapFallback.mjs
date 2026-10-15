/**
 * prod-seed's jobs upsert, past the 5-open-job cap (docs/OPEN.md Q1816, vacuity).
 *
 * enforce_open_job_limit is a BEFORE INSERT row trigger, and PostgREST's upsert
 * (POST ... on_conflict=id, merge-duplicates) is an INSERT ... ON CONFLICT DO
 * UPDATE, so the trigger fires even for a seed job that ALREADY EXISTS and is
 * only being repaired. When the shared poster holds 5 open PAID jobs (on
 * 2026-10-15 three of them were funded leftovers of failed e2e-journeys runs,
 * waiting ~23 h for the next run's pre-run sweep), every --apply died with
 * `POST jobs → 400 ... maximum of 5 open jobs` and took vacuity's prod legs
 * with it (run 38684819715).
 *
 * The repair of an existing row is an UPDATE, which the cap does not judge, so
 * on exactly that refusal the chunk's rows are written by PATCH, one per id,
 * each proven by its returned row. A row that does not exist yet still needs
 * the INSERT the cap refuses: that is thrown with the cause named, never
 * skipped.
 */

export const OPEN_JOB_CAP_REFUSAL = /maximum of 5 open jobs at a time/;

/**
 * @param {Array<Record<string, unknown> & { id: string }>} chunk
 * @param {{
 *   post: (rows: object[]) => Promise<object[]>,
 *   existingIds: (ids: string[]) => Promise<string[]>,
 *   patch: (id: string, values: Record<string, unknown>) => Promise<object[]>,
 * }} io
 */
export async function upsertJobsPastOpenJobCap(chunk, io) {
  try {
    return await io.post(chunk);
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e);
    if (!OPEN_JOB_CAP_REFUSAL.test(message)) throw e;
    const ids = chunk.map((r) => r.id);
    const existing = new Set(await io.existingIds(ids));
    const missing = ids.filter((id) => !existing.has(id));
    if (missing.length) {
      throw new Error(
        `${message}: ${missing.length} seed job(s) do not exist yet (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}) and cannot be created while their poster holds 5 open paid jobs (enforce_open_job_limit). ` +
          "Clear that poster's funded leftovers (scripts/e2e/prod-lifecycle-sweeper.mjs) and re-run.",
      );
    }
    const out = [];
    for (const row of chunk) {
      const { id, ...values } = row;
      const got = await io.patch(id, values);
      if (!Array.isArray(got) || got.length !== 1) {
        throw new Error(`jobs ${id}: the PATCH past the open-job cap wrote ${Array.isArray(got) ? got.length : "no"} row(s), expected 1`);
      }
      out.push(got[0]);
    }
    return out;
  }
}
