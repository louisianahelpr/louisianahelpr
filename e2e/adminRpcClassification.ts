// Admin RPC read/write classification, shared by the nightly prod-audit spec
// (e2e/prod-audit/admin-views.spec.ts, which uses READ_RPC as its firewall)
// and the PR-time guard src/test/adminRpcsClassified.test.ts. Moved here
// 2026-10-04: the check is static, yet it ran only in the nightly suite, so
// admin_gift_card_paid_job_ids (Q454, merged 2026-10-04) first showed up as a
// red prod-audit run instead of a red PR.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Read RPCs by prefix, plus read RPCs whose names carry no read verb. Adding a
 * name here is a claim that the function does not write: check
 * `pg_get_functiondef` on prod first.
 *
 * `admin_stalled_job_queue` added 2026-09-20. Verified live on prod before
 * adding: `LANGUAGE sql STABLE SECURITY DEFINER`, one SELECT over
 * `job_completion_nudges JOIN jobs`, and `pg_proc.provolatile = 's'`.
 *
 * `admin_last_activity` and `admin_last_logins` added 2026-09-30. Verified live
 * on prod: both `LANGUAGE sql STABLE`, one SELECT (jobs/applications and
 * login_history), `pg_proc.provolatile = 's'`.
 *
 * `admin_ban_settlement_reviews` added 2026-10-05 (Q1324): plpgsql STABLE
 * SECURITY DEFINER, SELECTs only (migration 20261006014801). Not on prod until
 * that migration lands: re-check provolatile = 's' there after it deploys.
 *
 * `admin_gift_card_paid_job_ids` added 2026-10-04 (Q454's gift-refund warning).
 * Verified live on prod: `pg_proc.provolatile = 's'`, SECURITY DEFINER, no
 * INSERT/UPDATE/DELETE in its body.
 * `admin_booking_sources` added 2026-10-30 (B66 Book me, 20261030013347): STABLE,
 * SECURITY DEFINER, a single SELECT (read from the migration; it reaches prod on merge).
 * `admin_signup_source_report` added 2026-10-31 (OPS-5, 20261031220447): plpgsql STABLE SECURITY DEFINER, one
 * RETURN QUERY SELECT, no INSERT/UPDATE/DELETE (read from the migration; re-check provolatile = 's' after deploy).
 */
export const READ_RPC =
  /\/rest\/v1\/rpc\/(get_|list_|count_|admin_get_|admin_list_|search_|admin_support_queue(\?|$)|admin_support_replies(\?|$)|admin_stalled_job_queue(\?|$)|admin_notification_crosses_seed_boundary(\?|$)|admin_last_activity(\?|$)|admin_payouts_held_for_review(\?|$)|shops_admin_queue(\?|$)|admin_last_logins(\?|$)|admin_ban_settlement_reviews(\?|$)|admin_gift_card_paid_job_ids(\?|$)|admin_section_funnel(\?|$)|admin_sms_status(\?|$)|admin_approval_escalation_queue(\?|$)|admin_booking_sources(\?|$)|admin_signup_source_report(\?|$))/;

/**
 * Admin RPCs that WRITE. Not an allow-list — the opposite: naming one here is
 * how the inventory check below is told "yes, the firewall is right to refuse
 * this one". Each verified `provolatile = 'v'` on prod, 2026-09-20.
 */
export const WRITE_RPC = new Set([
  // 2026-10-19 (lander33, train12): the held-for-review payout page (20261019070737).
  // "Release to automatic" puts a held payout/refund back to pending and "Settled by hand"
  // closes it with the Stripe id or off-Stripe note; both plpgsql VOLATILE, admin only
  // (has_role), writing the payout row + admin_audit_log. The list
  // (admin_payouts_held_for_review) is STABLE and sits in READ_RPC above.
  "admin_payout_release",
  "admin_payout_settle_by_hand",
  // 2026-10-19 (shops-m3): Shops orders (M4, 20261019071055). Each plpgsql VOLATILE, admin only
  // (has_role first), writing the order / payout / refund / strike row + admin_audit_log. The queue
  // (shops_admin_queue) is STABLE and sits in READ_RPC above.
  "shops_admin_pay_shop",
  "shops_admin_refund_order",
  "shops_admin_remove_strike",
  "shops_admin_give_strike",
  // 2026-10-17 (lander, section A train): admin "End series" (Q417 (c)) ends a
  // recurring series and refunds unbooked paid visits (20261012194707); "Close
  // as test" (Q1769) settles a test-mode dispute (20261015061949). Both plpgsql,
  // VOLATILE, writing jobs / disputes and admin_audit_log.
  "rpc_admin_end_recurring_series",
  "rpc_close_test_mode_dispute",
  "rpc_settle_dispute_without_payment",
  "admin_delete_review",
  "admin_reverse_violation",
  "resolve_stalled_job_flag",
  // payout-after-approval (2026-10-23, migration 20261023143240): has_role admin, UPDATEs job_approval_escalations + INSERTs admin_audit_log
  "resolve_approval_escalation",
  "review_credential",
  "rpc_decide_dispute",
  // Q764 (2026-10-04): the server-side payout hold. Each writes payout_holds and
  // admin_audit_log (migration 20261004162921, provolatile = 'v').
  "admin_set_payout_hold",
  "admin_release_payout_hold",
  "admin_deny_payout_hold",
  // Q1324 (2026-10-05): settle an automatic ban's jobs / mark a name match
  // checked. Both write (settlement, ban_evasion_matches) and admin_audit_log
  // (migration 20261006014801, plpgsql volatile).
  "admin_confirm_ban_settlement",
  "admin_resolve_ban_evasion_match",
  // 2026-10-09: an admin's direct message to a user (Louisiana Helpr Team
  // thread). Writes messages, notifications and admin_audit_log (migration
  // 20261011161100, plpgsql volatile).
  "admin_send_team_message",
  // 2026-10-12: hidden feature switches. Writes feature_switches and
  // admin_audit_log (migration 20261012031120, plpgsql volatile).
  "admin_set_feature_switch",
]);

/**
 * Every RPC name the admin surface calls, read out of the admin source itself.
 *
 * Matches `supabase.rpc("x"` AND `(supabase.rpc as any)("x"` — the second form
 * is how a brand-new RPC is called before `types.ts` is regenerated, and it is
 * exactly the form that hid `admin_stalled_job_queue` from a narrower scan.
 */
export function adminRpcNames(root: string = process.cwd()): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !/\.test\./.test(p)) files.push(p);
    }
  };
  walk(join(root, "src/components/admin"));
  files.push(join(root, "src/pages/admin/Admin.tsx"));
  const names = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\brpc\b[^("]{0,40}?\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}


/** Admin RPC names matched by neither READ_RPC nor WRITE_RPC (base URL is irrelevant to the match). */
export function unclassifiedAdminRpcs(names: string[]): string[] {
  return names.filter((n) => !READ_RPC.test(`/rest/v1/rpc/${n}`) && !WRITE_RPC.has(n));
}

/** Names classified as a write that the read firewall would still pass. */
export function writesTheFirewallPasses(): string[] {
  return [...WRITE_RPC].filter((n) => READ_RPC.test(`/rest/v1/rpc/${n}`));
}
