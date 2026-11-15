/**
 * Q2368 (lead 11-03): the durable record of a payout-account link change that used to leave only a console line.
 * One server-side severity-info error_logs row per change: tags.source 'stripe-connect' and tags.kind
 * 'connect-reset' (a member's reset in stripe-connect) or 'connect-dead-account-close' (stripe-webhook
 * accountUpdated closing a deleted account's cached gate), with the user and the old and new account ids.
 *
 * These rows are a record, not an alert: public.error_log_is_record_only (20261103203658) keeps them out of the
 * Slack trigger and the ops-alert ledger, so nothing new reaches the owner. A failed insert is logged, never thrown:
 * the change it records already happened and is correct. Zero imports: the edge harness serves the real module.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type ConnectRecordKind = "connect-reset" | "connect-dead-account-close";

export async function recordConnectChange(
  db: Db,
  r: { kind: ConnectRecordKind; userId: string; oldAccountId: string | null; newAccountId: string | null; isSeed?: boolean },
): Promise<void> {
  const message = r.kind === "connect-reset"
    ? `stripe-connect reset the payout account ${r.oldAccountId ?? "(none)"} -> ${r.newAccountId ?? "(none)"}`
    : `stripe-webhook closed the payout gate of deleted account ${r.oldAccountId ?? "(none)"}`;
  const { error } = await db.from("error_logs").insert({
    user_id: r.userId,
    severity: "info",
    message,
    tags: { source: "stripe-connect", kind: r.kind, ...(r.isSeed ? { seed: true } : {}) },
    context: { old_account_id: r.oldAccountId, new_account_id: r.newAccountId },
  });
  if (error) console.error(`[connect-record] could not record ${r.kind} for ${r.userId}: ${error.message}`);
}

/** Anything that looks like a secret or a card number never reaches the row. */
function scrub(text: string): string {
  return text
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "<key>")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "<key>")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}/g, "<jwt>")
    .replace(/\b\d{12,19}\b/g, "<number>");
}

/**
 * stripe-connect's generic 500 (owner 11-14, prod-errors item 9): the cause, durably. The 11-11 and 11-13
 * status / list_payout_methods 500s left only a console line, and edge logs had aged out by the time anyone looked.
 * One severity-error row: tags.source 'stripe-connect', tags.kind 'connect-500', tags.action; the message is
 * "stripe-connect 500 (<action>) — <name>: <message>" (the alert title is the part before " — ", so one action is one
 * alert); context carries the Stripe type/code/status. No body, no card data, no keys (scrub above). A test
 * account's row is tagged seed (the digest, never a page). A failed insert is logged, never thrown.
 */
export async function recordConnectFailure(
  db: Db,
  r: { userId: string | null; action: string | null; test: boolean; err: Error & { type?: string; code?: string; statusCode?: number } },
): Promise<void> {
  const name = r.err?.name || "Error";
  const what = scrub(String(r.err?.message ?? "(no message)")).slice(0, 300);
  const { error } = await db.from("error_logs").insert({
    user_id: r.userId,
    severity: "error",
    message: `stripe-connect 500 (${r.action ?? "unknown action"}) — ${name}: ${what}`,
    tags: { source: "stripe-connect", kind: "connect-500", action: r.action ?? "unknown", ...(r.test ? { seed: true } : {}) },
    context: {
      error_name: name,
      stripe_type: r.err?.type ?? null,
      stripe_code: r.err?.code ?? null,
      stripe_status: typeof r.err?.statusCode === "number" ? r.err.statusCode : null,
    },
  });
  if (error) console.error(`[connect-record] could not record a stripe-connect 500 (${r.action}): ${error.message}`);
}

/**
 * Q2794 (lead + owner 2026-11-14; lh-money-escrow): every place a member can be owed money, or have been paid, keyed
 * by that member. A stale payout-account clear pages ops only when one of these holds a row for the member; otherwise
 * the clear is a record (tags.money_history false is record-only in public.error_log_is_record_only). Columns read on
 * prod 2026-11-14 (information_schema). `in` narrows a source to the states that mean money, `neq` drops the one that
 * does not; a source with neither counts every row.
 * A new money table belongs here: src/test/edge/stripeConnectStaleClearMoneyHistory.test.ts holds the list.
 */
export const MONEY_HISTORY_SOURCES: ReadonlyArray<{ table: string; member: string; in?: { column: string; values: string[] }; neq?: { column: string; value: string } }> = [
  { table: "payout_transfers", member: "helper_id" },
  { table: "payout_payee_waits", member: "payee_id" },
  { table: "payout_holds", member: "helper_id" },
  { table: "instant_payouts", member: "helper_id" },
  // Every jobs.payment_status the CHECK allows that can mean money for the Helpr (cancelling: a fee may be owed).
  { table: "jobs", member: "helper_id", in: { column: "payment_status", values: ["escrow", "held", "payout_pending", "released", "cancelling", "chargeback"] } },
  // Every tip but a failed one (prod 2026-11-14: paid 16, failed 3, pending 1); an unknown future state still counts.
  { table: "tips", member: "helper_id", neq: { column: "payment_status", value: "failed" } },
  { table: "helpr_task_tips", member: "helpr_id" },
  { table: "cancellation_fee_transfers", member: "helper_id" },
  { table: "crew_cancellation_fee_shares", member: "helper_id" },
  { table: "referral_credits", member: "user_id" },
  { table: "declutter_orders", member: "seller_id", in: { column: "status", values: ["paid", "handed_over"] } },
  { table: "declutter_payouts", member: "seller_id" },
  { table: "declutter_manager_payouts", member: "manager_id" },
  { table: "shipping_claim_payouts", member: "seller_id" },
  { table: "shop_orders", member: "seller_id" },
  { table: "helpr_task_payouts", member: "helpr_id" },
  { table: "provider_payouts", member: "payee_user_id" },
];

/**
 * Has this member any money history (MONEY_HISTORY_SOURCES)? Any read that errors, answers oddly or throws (even
 * while the queries are being built) answers true, so a doubt still pages.
 */
export async function memberHasMoneyHistory(db: Db, userId: string): Promise<boolean> {
  try {
    const reads = await Promise.all(MONEY_HISTORY_SOURCES.map((src) => {
      let q = db.from(src.table).select(src.member).eq(src.member, userId);
      if (src.in) q = q.in(src.in.column, src.in.values);
      if (src.neq) q = q.neq(src.neq.column, src.neq.value);
      return q.limit(1);
    }));
    for (const r of reads as { data: unknown[] | null; error: unknown }[]) {
      if (r.error || !Array.isArray(r.data)) return true;
      if (r.data.length > 0) return true;
    }
    return false;
  } catch {
    // A doubt pages: the caller tags the clear money_history true.
    return true;
  }
}
