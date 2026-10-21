/**
 * Board 141 (docs/OPEN.md Q2272): a LIVE refund request holds the job's money.
 *
 * A poster's request to the Helpr for part or all of the money back
 * (public.refund_requests, 20261021102943) is live while it is:
 *   - open (waiting on the Helpr, at most 2 days);
 *   - declined, with its normal dispute not opened yet (the sweep files it);
 *   - agreed, with its decided dispute not executed yet (the sweep settles it).
 * While one is live, no money may leave toward the Helpr. The database
 * refuses escrow -> payout_pending itself (refuse_payout_pending_while_
 * refund_requested, raising `refund_request_open`); the crons read this first
 * so a held job is an outcome ("refund_requested"), not a refused write that
 * pages every run. isLiveRefundRequest is the same rule as the SQL
 * public.refund_request_is_live; src/test/refundRequestHold.test.ts holds them
 * together.
 *
 * FAIL CLOSED: a read error is `ok: false`, and the caller moves no money on
 * it. A missing table (42P01 / PGRST205, the migration-lag window) holds no
 * job: a database with no refund_requests table has no request in it.
 *
 * ZERO imports (the caller passes its service-role client), so the edge test
 * harness runs the REAL module.
 */

/** The code the database raises when a live request refuses escrow -> payout_pending. */
const REFUND_REQUEST_OPEN_CODE = "refund_request_open";

/** What the release button says when the database refused it for a live request. */
export const REFUND_REQUEST_RELEASE_MESSAGE =
  "There's a refund request on this job, so its payment waits for the answer. Once it's agreed, or Helpr decides, the money moves on its own.";

/** Did this write fail because a live refund request held the job's money? */
export function isRefundRequestHoldRefusal(message: string | null | undefined): boolean {
  return !!message && new RegExp(`\\b${REFUND_REQUEST_OPEN_CODE}\\b`).test(message);
}

export interface RefundRequestRow {
  job_id: string;
  status: string;
  dispute_id: string | null;
  /** The linked dispute (PostgREST embed), when there is one. */
  disputes?: { status: string | null; execution_status: string | null } | null;
}

/** The statuses that can be live; the rest never hold money. */
const REFUND_REQUEST_LIVE_STATUSES = ["open", "declined", "agreed"] as const;

/**
 * Is this request live? The SQL rule public.refund_request_is_live, row for
 * row: an agreed request whose dispute row could not be read counts as live
 * (fail closed), as NOT EXISTS reads it in SQL.
 */
export function isLiveRefundRequest(row: RefundRequestRow): boolean {
  if (row.status === "open") return true;
  if (row.status === "declined") return row.dispute_id === null || row.dispute_id === undefined;
  if (row.status === "agreed") {
    const d = row.disputes;
    if (!d) return true;
    return !(d.execution_status === "executed" || d.status !== "decided");
  }
  return false;
}

const tableMissing = (error: unknown) => {
  const code = String((error as { code?: string } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205";
};

/** The columns every reader selects: the row and its dispute's settlement state. */
const REFUND_REQUEST_HOLD_SELECT =
  "job_id, status, dispute_id, disputes!refund_requests_dispute_id_fkey(status, execution_status)";

/** Which of `jobIds` a live refund request holds. Fails closed. */
export async function loadRefundHeldJobs(
  db: { from: (t: string) => any },
  jobIds: ReadonlyArray<string | null | undefined>,
): Promise<{ ok: true; jobs: Set<string> } | { ok: false; message: string }> {
  const ids = [...new Set(jobIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const jobs = new Set<string>();
  if (ids.length === 0) return { ok: true, jobs };
  let res: { data: RefundRequestRow[] | null; error: { message?: string; code?: string } | null };
  try {
    res = await db
      .from("refund_requests")
      .select(REFUND_REQUEST_HOLD_SELECT)
      .in("job_id", ids)
      .in("status", [...REFUND_REQUEST_LIVE_STATUSES]);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (res.error) {
    if (tableMissing(res.error)) return { ok: true, jobs };
    return { ok: false, message: res.error.message ?? "refund request read failed" };
  }
  for (const row of res.data ?? []) {
    if (row && ids.includes(row.job_id) && isLiveRefundRequest(row)) jobs.add(row.job_id);
  }
  return { ok: true, jobs };
}
