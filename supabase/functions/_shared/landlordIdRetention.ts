// Landlord ID photos are kept only until the admin's decision is old enough
// (owner 2026-10-19: landlords upload a photo of their ID for admin review).
//
// LANDLORD_ID_RETENTION_DAYS is THE number: the daily sweep below (run by
// cleanup-abandoned-accounts) deletes every ID photo in the landlord's
// user-documents/<uid>/landlord-id/ folder that was uploaded before a decision
// (approve or reject) at least this many days old, then stamps the review row
// (landlord_id_images_deleted). Homes quotes the same constant to the landlord.
// Storage rows cannot be deleted from SQL (storage.protect_delete), so the
// objects go through the Storage API. A failed listing or removal leaves the
// row unstamped (retried next run) and is reported as a defect of the run.
//
// ZERO imports, so a unit test (and the client copy) can load it.

export const LANDLORD_ID_RETENTION_DAYS = 30;

export const LANDLORD_ID_BUCKET = "user-documents";
const LANDLORD_ID_FOLDER = "landlord-id";

export interface LandlordIdSweepClient {
  rpc(
    fn: "landlord_id_images_due",
    args: { p_retention_days: number; p_limit: number },
  ): PromiseLike<{ data: { user_id: string; reviewed_at: string }[] | null; error: { message: string } | null }>;
  rpc(
    fn: "landlord_id_images_deleted",
    args: { p_user_id: string; p_reviewed_at: string },
  ): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      list(
        prefix: string,
        opts: { limit: number; offset: number },
      ): PromiseLike<{ data: { name: string; id: string | null; created_at: string | null }[] | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ data: { name: string }[] | null; error: { message: string } | null }>;
    };
  };
}

export interface LandlordIdSweepResult {
  due: number;
  removed: number;
  stamped: number;
  failures: string[];
}

const PAGE = 100;

/** Delete the ID photos of every decision older than the retention window. Never throws. */
export async function sweepLandlordIdImages(
  client: LandlordIdSweepClient,
  opts: { dryRun?: boolean; maxRows?: number; retentionDays?: number } = {},
): Promise<LandlordIdSweepResult> {
  const out: LandlordIdSweepResult = { due: 0, removed: 0, stamped: 0, failures: [] };
  const days = opts.retentionDays ?? LANDLORD_ID_RETENTION_DAYS;
  const { data: due, error } = await client.rpc("landlord_id_images_due", { p_retention_days: days, p_limit: opts.maxRows ?? 100 });
  if (error) {
    out.failures.push(`due read: ${error.message}`);
    return out;
  }
  if (!Array.isArray(due)) {
    out.failures.push("due read: no rows array");
    return out;
  }
  out.due = due.length;
  const bucket = client.storage.from(LANDLORD_ID_BUCKET);
  for (const row of due) {
    const prefix = `${row.user_id}/${LANDLORD_ID_FOLDER}`;
    const decidedAt = Date.parse(row.reviewed_at);
    if (!Number.isFinite(decidedAt)) {
      out.failures.push(`${row.user_id}: unreadable reviewed_at ${row.reviewed_at}`);
      continue;
    }
    // Every object uploaded before the decision: the photos it decided on and
    // any earlier ones they replaced. A photo uploaded after it (a new
    // submission on its way) is never touched.
    const doomed: string[] = [];
    let listFailed = false;
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error: listErr } = await bucket.list(prefix, { limit: PAGE, offset });
      if (listErr || !Array.isArray(page)) {
        out.failures.push(`${row.user_id}: list ${listErr?.message ?? "no rows array"}`);
        listFailed = true;
        break;
      }
      for (const o of page) {
        if (o.id === null) continue; // a sub-prefix, not an object (none are written here)
        const created = o.created_at ? Date.parse(o.created_at) : NaN;
        if (!Number.isFinite(created) || created <= decidedAt) doomed.push(`${prefix}/${o.name}`);
      }
      if (page.length < PAGE) break;
    }
    if (listFailed) continue;
    if (opts.dryRun) {
      out.removed += doomed.length;
      continue;
    }
    if (doomed.length > 0) {
      const { data: gone, error: rmErr } = await bucket.remove(doomed);
      if (rmErr) {
        out.failures.push(`${row.user_id}: remove ${rmErr.message}`);
        continue;
      }
      // Storage skips a path it cannot remove and still answers no error: count
      // what it says it removed, and stamp nothing unless that is every photo
      // just listed (a re-run lists again and converges).
      const removed = Array.isArray(gone) ? gone.length : 0;
      out.removed += removed;
      if (removed !== doomed.length) {
        out.failures.push(`${row.user_id}: removed ${removed} of ${doomed.length} photos`);
        continue;
      }
    }
    const { data: stamped, error: stampErr } = await client.rpc("landlord_id_images_deleted", {
      p_user_id: row.user_id,
      p_reviewed_at: row.reviewed_at,
    });
    if (stampErr) out.failures.push(`${row.user_id}: stamp ${stampErr.message}`);
    else if (stamped === true) out.stamped += 1;
    // stamped === false: a new submission arrived in between; its photos were
    // uploaded after the decision and were kept. Not a failure.
  }
  return out;
}
