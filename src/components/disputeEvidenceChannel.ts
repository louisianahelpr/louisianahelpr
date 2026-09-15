/**
 * Which write, if any, adds follow-up evidence to a dispute for this viewer.
 *
 *   opener        the party who filed it, through the opener-only UPDATE (RLS:
 *                 auth.uid() = opener_id AND status = 'open').
 *   reopened      a dispute an admin re-opened with rpc_supersede_dispute_decision:
 *                 either party, through rpc_add_dispute_evidence, which checks
 *                 party membership and the upload path server-side.
 *   unattributed  no opener, but NOT an admin re-open — the opener's account was
 *                 deleted (deletion anonymises opener_id). Nobody can add to it.
 *   blocked       the other party on a party-filed dispute — shown why, not a
 *                 dead control.
 *   closed        the dispute is no longer open.
 *   legacy        no formal disputes row: jobs.dispute_evidence_urls, job-party policy.
 */
export type DisputeEvidenceChannel = "opener" | "reopened" | "unattributed" | "blocked" | "closed" | "legacy";

/**
 * The reason prefix rpc_supersede_dispute_decision writes on the dispute it
 * opens, and rpc_add_dispute_evidence checks. A NULL opener alone does not mark
 * an admin re-open (round-5 review, LOW-2). Byte-identical to the migration —
 * disputeEvidenceChannel.test.ts reads both.
 */
export const REOPENED_REASON_PREFIX = "Re-opened by an admin after the earlier decision could not be carried out:";

export function isAdminReopened(dispute: { opener_id: string | null; reason?: string | null } | null): boolean {
  return !!dispute && dispute.opener_id === null && (dispute.reason ?? "").startsWith(REOPENED_REASON_PREFIX);
}

export function disputeEvidenceChannel(
  dispute: { status: string; opener_id: string | null; reason?: string | null } | null,
  userId: string | null,
): DisputeEvidenceChannel {
  if (!dispute) return "legacy";
  if (dispute.status !== "open") return "closed";
  if (dispute.opener_id === null) return isAdminReopened(dispute) ? "reopened" : "unattributed";
  return dispute.opener_id === userId ? "opener" : "blocked";
}
