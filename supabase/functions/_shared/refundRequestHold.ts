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

/**
 * The execution_error refund_agreements_due (SQL, 20261021102943) records on
 * an agreed refund it will NOT settle automatically because a party is banned,
 * suspended, under a ban review or on a payout hold: an admin settles it from
 * the dispute page. auto-resolve-disputes sets such a split aside (it is
 * waiting on purpose, not half-moved). The SQL writes this exact prefix;
 * src/test/edge/refundAgreementGuard.test.ts holds the two together.
 */
export const REFUND_AGREEMENT_HELD_ERROR = "refund agreement held for admin review";

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
const REFUND_REQUEST_LIVE_STATUSES = ["open", "finish_offered", "coming_back", "declined", "agreed"] as const;

/**
 * Is this request live? The SQL rule public.refund_request_is_live, row for
 * row: an agreed request whose dispute row could not be read counts as live
 * (fail closed), as NOT EXISTS reads it in SQL.
 */
export function isLiveRefundRequest(row: RefundRequestRow): boolean {
  if (row.status === "open") return true;
  // Q2300: a come-back offer waiting on the poster, or accepted and not yet handed over.
  if (row.status === "finish_offered" || row.status === "coming_back") return true;
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

/**
 * Which of `disputeIds` (agreed refunds marked REFUND_AGREEMENT_HELD_ERROR)
 * still have a held party: the poster or the Helpr is banned, suspended,
 * under a ban review or on a payout hold (refund_party_held, service role).
 * auto-resolve-disputes sets an agreement aside only while this says so;
 * once the hold lifts it is stuck again and pages, so it is not forgotten
 * (lh-money-escrow review, 2026-10-21). FAILS CLOSED: any unreadable row or
 * check returns ok:false, and the caller then sets nothing aside.
 */
export async function loadStillHeldAgreements(
  db: { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any },
  disputeIds: ReadonlyArray<string | null | undefined>,
): Promise<{ ok: true; disputes: Set<string> } | { ok: false; message: string }> {
  const ids = [...new Set(disputeIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const disputes = new Set<string>();
  if (ids.length === 0) return { ok: true, disputes };
  try {
    const res = await db
      .from("refund_requests")
      .select("dispute_id, requester_id, answered_by")
      .in("dispute_id", ids);
    if (res.error) return { ok: false, message: res.error.message ?? "refund request read failed" };
    const rows = (res.data ?? []) as Array<{ dispute_id: string | null; requester_id: string | null; answered_by: string | null }>;
    const users = new Set<string>();
    for (const row of rows) {
      for (const u of [row.requester_id, row.answered_by]) if (typeof u === "string" && u) users.add(u);
    }
    const heldUsers = new Set<string>();
    for (const u of users) {
      const held = await db.rpc("refund_party_held", { p_user: u });
      if (held.error || typeof held.data !== "boolean") {
        return { ok: false, message: held.error?.message ?? "refund_party_held returned no answer" };
      }
      if (held.data) heldUsers.add(u);
    }
    for (const row of rows) {
      if (!row.dispute_id || !ids.includes(row.dispute_id)) continue;
      // A party the request no longer names (an anonymised poster) counts as
      // held, as refund_party_held(NULL) does in SQL.
      if (!row.requester_id || !row.answered_by || heldUsers.has(row.requester_id) || heldUsers.has(row.answered_by)) {
        disputes.add(row.dispute_id);
      }
    }
    return { ok: true, disputes };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** What the Helpr is told when they mark done before an agreed come-back. */
export const COME_BACK_PENDING_MESSAGE =
  "You agreed to come back and finish this job. Mark it done once you have, from the agreed time.";

/**
 * Has this job's Helpr agreed to come back and finish, with the agreed time
 * still ahead (refund_come_back_pending, the one SQL rule
 * trg_refuse_done_before_come_back also reads)? create-payment's release
 * asks it before writing a new Helpr done stamp on the service role.
 * FAILS CLOSED: any error but "the function does not exist yet" is ok:false.
 * A database without the function (this migration not deployed yet) has no
 * refund requests at all, so nothing can be pending there.
 */
export async function refundComeBackPending(
  db: { rpc: (fn: string, args: Record<string, unknown>) => any },
  jobId: string,
): Promise<{ ok: true; pending: boolean } | { ok: false; message: string }> {
  try {
    const res = await db.rpc("refund_come_back_pending", { p_job_id: jobId });
    if (res.error) {
      if (res.error.code === "PGRST202" || res.error.code === "42883") return { ok: true, pending: false };
      return { ok: false, message: res.error.message ?? "refund_come_back_pending failed" };
    }
    if (typeof res.data !== "boolean") return { ok: false, message: "refund_come_back_pending returned no answer" };
    return { ok: true, pending: res.data };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Which of `jobIds` had a "Come back and finish" agreed (a refund request
 * closed or standing as coming back). auto-release-payment never releases
 * these INSTANTLY: the first visit's arrival and photos still pass every
 * completion gate, so the poster keeps the normal 24-hour window to say the
 * Helpr never came back (lh-money-escrow re-review, 2026-10-21). FAILS
 * CLOSED: on a read error the caller treats every candidate as one of these.
 */
export async function loadComeBackJobs(
  db: { from: (t: string) => any },
  jobIds: ReadonlyArray<string | null | undefined>,
): Promise<{ ok: true; jobs: Set<string> } | { ok: false; message: string }> {
  const ids = [...new Set(jobIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const jobs = new Set<string>();
  if (ids.length === 0) return { ok: true, jobs };
  try {
    const res = await db
      .from("refund_requests")
      .select("job_id")
      .in("job_id", ids)
      .or("status.eq.coming_back,closed_reason.eq.coming_back");
    if (res.error) {
      if (tableMissing(res.error)) return { ok: true, jobs };
      return { ok: false, message: res.error.message ?? "refund request read failed" };
    }
    for (const row of (res.data ?? []) as Array<{ job_id: string | null }>) {
      if (row?.job_id && ids.includes(row.job_id)) jobs.add(row.job_id);
    }
    return { ok: true, jobs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
