/**
 * Write one `admin_audit_log` row (who, what, target, when, reason) for an
 * admin action taken inside an edge function (Q76).
 *
 * Non-fatal by design: it runs AFTER the action it records, so the action has
 * already happened and a 500 here would only invite a second click. Never
 * silent: `.select("id")` makes a zero-row insert visible, and a lost row goes
 * to Slack — an admin action with no audit trail is exactly what the table
 * exists to prevent.
 *
 * `admin_id` is the admin who acted (from the verified JWT, never the body);
 * `created_at` is the table default; put the admin's reason in
 * `details.reason` when the action takes one.
 *
 * ZERO imports on purpose: the caller passes its own `postSlackOpsAlert`, so
 * the edge test harness runs this REAL module (a mock would put the audit
 * write outside the tests that check it) — same shape as payoutClaim.ts.
 */

export interface AdminAuditRow {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  /** Function name, for the log line and the alert. */
  source: string;
}

// deno-lint-ignore no-explicit-any
type AlertFn = (input: any) => Promise<unknown>;

// deno-lint-ignore no-explicit-any
export async function writeAdminAudit(supabaseAdmin: any, row: AdminAuditRow, alert: AlertFn): Promise<boolean> {
  let failure: string | null = null;
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .insert({
        admin_id: row.adminId,
        action: row.action,
        target_type: row.targetType,
        target_id: row.targetId,
        details: row.details ?? null,
      })
      .select("id");
    if (error) failure = error.message ?? String(error);
    else if (!data || data.length === 0) failure = "insert matched 0 rows";
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure === null) return true;

  console.error(
    `CRITICAL: [${row.source}] admin_audit_log write failed for ${row.action} on ${row.targetType} ${row.targetId}: ${failure}`,
  );
  await alert({
    kind: "money_at_risk",
    severity: "warning",
    title: "Admin action left no audit trail",
    message: `An admin action (${row.action}) completed in ${row.source}, but its admin_audit_log row was not written.`,
    fields: {
      action: row.action,
      target: `${row.targetType} ${row.targetId}`,
      admin_id: row.adminId,
      db_error: failure.slice(0, 200),
    },
  });
  return false;
}
