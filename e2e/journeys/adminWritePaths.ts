/**
 * EVERY ADMIN MONEY / ACCOUNT WRITE PATH, AND WHICH JOURNEY DRIVES IT (Q226).
 *
 * Until 2026-09-26 no journey drove an admin refund (Quick Refund /
 * admin_refund_general) or the ban gate on writes; the ban gate was unit-tested
 * only. This registry covers the whole class:
 *
 *   - its keys are DERIVED FROM SOURCE by src/test/adminWritePathsDriven.test.ts:
 *     every `action === "admin_…"` branch in supabase/functions/create-payment,
 *     every `action === '…'` branch in supabase/functions/admin-user-actions,
 *     the execute-dispute-split function, and the `enforce_ban_gate` trigger
 *     function (the ban gate on writes). A path with no entry, or an entry for a
 *     path that is gone, fails that guard;
 *   - `success` is the admin doing it for real; `refusal` is a NON-admin trying
 *     it and being refused. Each is `driven` (the spec and a code EVIDENCE
 *     string that must appear in that spec's code) or `uncovered` with the
 *     concrete reason. Every create-payment admin action's refusal MUST be
 *     driven: it needs no admin and no third account.
 *   - 04-money-outcomes.spec.ts announces every `uncovered` entry at run time.
 */

export type PathCoverage = { driven: { spec: string; evidence: string } } | { uncovered: string };
export type AdminPath = { success: PathCoverage; refusal?: PathCoverage };

const MONEY = "e2e/journeys/04-money-outcomes.spec.ts";

const SHARED_TARGET =
  "its target is another account, and the only accounts a journey has are the two shared ones: banning, warning or " +
  "de-verifying either locks every other lane (scenarios.ts REAL_BACKEND_UNREACHABLE.banned). Needs a dedicated seed " +
  "account the run may act on and restore — owner: credentials (e.g. PLAYWRIGHT_BANNABLE_EMAIL/_PASSWORD in CI)";
const DISPUTE_ONLY =
  "needs a DISPUTED job; the only one on prod is prod-audit's shared fixture (e2e/prod-audit/fundedOpenJob.ts " +
  "ensureDisputedJob), which settling would consume, and opening a new dispute per run pages #ops-alerts " +
  "(notify_ops_dispute_filed)";

// @two-way src/test/adminWritePathsDriven.test.ts:an entry whose path is gone from source fails
export const ADMIN_WRITE_PATHS: Record<string, AdminPath> = {
  "create-payment:admin_refund_general": {
    success: { driven: { spec: MONEY, evidence: 'action: "admin_refund_general", jobId, reason' } },
    refusal: { driven: { spec: MONEY, evidence: "for (const action of NON_ADMIN_REFUSED)" } },
  },
  "create-payment:admin_refund_dispute": {
    success: { uncovered: DISPUTE_ONLY },
    refusal: { driven: { spec: MONEY, evidence: "for (const action of NON_ADMIN_REFUSED)" } },
  },
  "create-payment:admin_release_dispute": {
    success: { uncovered: DISPUTE_ONLY },
    refusal: { driven: { spec: MONEY, evidence: "for (const action of NON_ADMIN_REFUSED)" } },
  },
  "execute-dispute-split": { success: { uncovered: `${DISPUTE_ONLY}; it also needs an admin decision (rpc_decide_dispute) on it` } },
  "admin-user-actions:set_ban_status": { success: { uncovered: SHARED_TARGET } },
  "admin-user-actions:formal_warning": { success: { uncovered: SHARED_TARGET } },
  "admin-user-actions:confirm_message_ban": { success: { uncovered: SHARED_TARGET } },
  "admin-user-actions:dismiss_message_ban_review": {
    success: { uncovered: `needs a pending message-ban review on an account; ${SHARED_TARGET}` },
  },
  "admin-user-actions:grant_admin": {
    success: { uncovered: "grants the admin role; granting it to a shared journey account would give every lane admin power — never driven by design" },
  },
  "admin-user-actions:manual_verify": { success: { uncovered: SHARED_TARGET } },
  "admin-user-actions:idv_reject": { success: { uncovered: SHARED_TARGET } },
  "admin-user-actions:request_id_reupload": { success: { uncovered: SHARED_TARGET } },
  "admin-user-actions:reset_password": {
    success: { uncovered: "emails a password-reset link to the target; on a shared journey account the reset would race every lane signing in with its password" },
  },
  // The ban gate on WRITES: a banned account's insert/update/delete refused by the
  // enforce_ban_gate trigger on every user-writable table.
  "sql:enforce_ban_gate": {
    success: { uncovered: `needs a BANNED session to attempt the writes; ${SHARED_TARGET}` },
  },
};

/** Paths (and halves) no leg drives, with the reason. */
export function uncoveredAdminPaths(): Array<{ path: string; half: "success" | "refusal"; why: string }> {
  const out: Array<{ path: string; half: "success" | "refusal"; why: string }> = [];
  for (const [path, p] of Object.entries(ADMIN_WRITE_PATHS)) {
    if ("uncovered" in p.success) out.push({ path, half: "success", why: p.success.uncovered });
    if (p.refusal && "uncovered" in p.refusal) out.push({ path, half: "refusal", why: p.refusal.uncovered });
  }
  return out;
}
