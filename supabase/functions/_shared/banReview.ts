/**
 * Q1324 (owner 2026-10-05, "ban now, admin settles"; lh-money-escrow review):
 * while a ban settlement review is open for an account, EVERY job of that
 * account, as poster and as Helpr, is frozen against the automatic money
 * paths until an admin confirms or lifts the ban.
 *
 * The database refuses the moves themselves (a transfer claim, escrow ->
 * payout_pending: migration 20261006030849); the crons read this first so a
 * frozen job is an outcome ("ban_review"), not a refused write that pages
 * every run.
 *
 * ZERO imports: the edge harness loads the REAL module.
 */

export type BanReviewLookup =
  | { ok: true; users: Set<string> }
  | { ok: false; message: string };

type Db = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

/**
 * The accounts under an OPEN ban settlement review. A read that fails is
 * `ok: false`: the caller moves no money this run (fail closed). A table that
 * does not exist yet (the migration has not deployed: 42P01 / PGRST205) is an
 * empty set.
 */
export async function loadBanReviewUsers(db: Db, onlyIds?: string[]): Promise<BanReviewLookup> {
  let res: { data: Array<{ user_id: string }> | null; error: { message?: string; code?: string } | null };
  try {
    // With ids, only those rows: a full read past PostgREST's row cap would be
    // truncated, which reads as "not under review" (fails open).
    const base = db.from("ban_settlement_queue").select("user_id").eq("review_state", "open");
    res = await (onlyIds ? base.in("user_id", onlyIds) : base);
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "read threw";
    return { ok: false, message };
  }
  if (res.error) {
    if (res.error.code === "42P01" || res.error.code === "PGRST205") return { ok: true, users: new Set() };
    return { ok: false, message: res.error.message ?? "unknown error" };
  }
  return { ok: true, users: new Set((res.data ?? []).map((r) => r.user_id).filter(Boolean)) };
}

/** Is this job frozen by an open review on its poster or its Helpr? */
export function frozenByBanReview(
  lookup: Extract<BanReviewLookup, { ok: true }>,
  job: { customer_id?: string | null; helper_id?: string | null },
): boolean {
  return (!!job.customer_id && lookup.users.has(job.customer_id)) || (!!job.helper_id && lookup.users.has(job.helper_id));
}
