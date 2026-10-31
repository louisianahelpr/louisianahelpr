import type { Json } from "@/integrations/supabase/types";

/**
 * What the admin audit log hides and how it sorts rows (Admin M1, M2). Measured on
 * prod 2026-10-30: of the newest 200 rows 155 were system UPDATEs of user_bans; of
 * 1126 such rows in 30 days 1096 were about test accounts and 561 changed nothing
 * but updated_at, so real admin actions sat a page below the fold. 11 of the 33
 * job_status_override rows were an admin moving a job they were a party to.
 */
export interface AuditRow {
  id: string;
  admin_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Json | null;
  created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_TARGETS = new Set(["user", "profile"]);
const JOB_TARGETS = new Set(["job", "jobs"]);
const ITEM_TARGETS = new Set(["declutter_item"]);

const asRow = (v: Json | undefined): Record<string, Json | undefined> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : null;

/** Both snapshots of a trigger-written row ({op, old, new}), each absent on the other kind of write. */
function snapshots(row: AuditRow): Record<string, Json | undefined>[] {
  const d = asRow(row.details ?? undefined);
  if (!d) return [];
  return [asRow(d.old), asRow(d.new)].filter((r): r is Record<string, Json | undefined> => r !== null);
}

const uuidsOf = (values: (Json | undefined)[]): string[] =>
  values.filter((v): v is string => typeof v === "string" && UUID.test(v));

/** Everything a row is ABOUT, for the test-data check. The actor is not its subject. */
export function auditSubjects(row: AuditRow): { users: string[]; jobs: string[]; items: string[] } {
  const snaps = snapshots(row);
  const target = row.target_id && UUID.test(row.target_id) ? row.target_id : null;
  const type = row.target_type ?? "";
  return {
    users: [...uuidsOf(snaps.flatMap((s) => [s.user_id, s.helper_id, s.customer_id])), ...(target && USER_TARGETS.has(type) ? [target] : [])],
    jobs: [...uuidsOf(snaps.map((s) => s.job_id)), ...(target && JOB_TARGETS.has(type) ? [target] : [])],
    items: target && ITEM_TARGETS.has(type) ? [target] : [],
  };
}

/** A trigger's UPDATE that changed nothing but updated_at: nothing happened, so there is nothing to show. */
export function isNoOpAudit(row: AuditRow): boolean {
  if (row.action !== "UPDATE") return false;
  const d = asRow(row.details ?? undefined);
  const before = asRow(d?.old);
  const after = asRow(d?.new);
  if (!before || !after) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete("updated_at");
  return [...keys].every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]));
}

export type AuditKind = "all" | "people" | "money" | "jobs" | "declutter" | "settings" | "support";

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  all: "All kinds",
  people: "Members and bans",
  money: "Money",
  jobs: "Jobs",
  declutter: "Declutter",
  settings: "Settings and switches",
  support: "Support and reports",
};

const MONEY_TARGETS = new Set(["payment_refunds", "payout_transfers", "instant_payouts", "gift_cards"]);
const PEOPLE_TARGETS = new Set(["user", "profile", "user_bans", "user_roles", "fraud_flag"]);
const SETTINGS_TARGETS = new Set(["feature_switch", "platform_settings"]);

/** Which filter a row falls under. Money wins over Jobs: a refund on a job is a money event. */
export function auditKind(row: AuditRow): Exclude<AuditKind, "all"> | "other" {
  const type = row.target_type ?? "";
  const action = row.action;
  if (MONEY_TARGETS.has(type) || /refund|payout|payment/.test(action)) return "money";
  if (action.startsWith("declutter") || type.startsWith("declutter")) return "declutter";
  if (action.startsWith("support") || action.startsWith("team_message") || type === "report") return "support";
  if (JOB_TARGETS.has(type)) return "jobs";
  if (SETTINGS_TARGETS.has(type)) return "settings";
  if (PEOPLE_TARGETS.has(type)) return "people";
  return "other";
}

export type AuditActor = "anyone" | "admin" | "system";

export const AUDIT_ACTOR_LABEL: Record<AuditActor, string> = {
  anyone: "Anyone",
  admin: "An admin",
  system: "Automatic",
};

export function auditMatches(
  row: AuditRow & { admin_name?: string },
  filter: { kind: AuditKind; actor: AuditActor; search: string },
  summary: string | null,
): boolean {
  if (filter.kind !== "all" && auditKind(row) !== filter.kind) return false;
  if (filter.actor === "admin" && !row.admin_id) return false;
  if (filter.actor === "system" && row.admin_id) return false;
  const q = filter.search.trim().toLowerCase();
  if (!q) return true;
  return [row.admin_name, row.action.replace(/_/g, " "), row.target_type, row.target_id, summary]
    .some((v) => (v ?? "").toLowerCase().includes(q));
}
