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
