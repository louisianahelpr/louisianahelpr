import { unwrap } from "@/lib/supabaseResult";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import type { ConfigCheck } from "./useConfigChecks";

/**
 * Open items in the ops alert ledger (public.ops_alert_ledger, docs/OPEN.md Q1).
 *
 * Every alert — error_logs rows, Slack posts from edge functions and SQL,
 * workflow Slack posts, nightly-red issues, Sentry — is one item per
 * fingerprint, open until its own detector is re-run and shows it cleared.
 * "Posted is not handled": this card is the list of what is still not handled.
 *
 * A failed read is a row that says so (tone `unknown`), never an empty card:
 * an empty card here reads as "no open alerts", the one thing it must not say
 * falsely.
 */
const TONE: Record<string, ConfigCheck["tone"]> = {
  fatal: "danger",
  critical: "danger",
  error: "danger",
  warning: "warn",
  info: "unknown",
};

/**
 * NOID-24 M7: the ledger's CI rows. Measured from the code: main-red-watch.yml records a red workflow run with
 * `--source-kind nightly_red --source "nightly-red"`, and scripts/ops-alert-ledger.mjs syncs the open nightly-red
 * issues the same way (source = the label). The other nightly_red labels (prod-down, prod-errors, ...) are real ops
 * alerts. Lead instruction (10-30): the home's open errors leave CI rows out; no ledger row is closed or deleted.
 */
export const CI_SOURCE = "nightly-red";

/**
 * How many open ledger items are serious (a warning or a note is not), CI rows aside: the
 * number the admin home reads before it may call the platform calm. Same ledger
 * and same "open" as the list below. A failed read throws, so the page shows it
 * as a data error, never as a confident zero.
 */
export async function seriousOpenAlertCount(): Promise<number> {
  const result = await supabase
    .from("ops_alert_ledger")
    .select("id", { count: "exact", head: true })
    .neq("status", "closed")
    .in("severity", ["fatal", "critical", "error"])
    .neq("source", CI_SOURCE);
  unwrap(result);
  if (result.count === null) throw new Error("The alert ledger returned no count");
  return result.count;
}

export const useSeriousOpenAlertCount = (enabled: boolean) =>
  useQuery({
    queryKey: ["admin-open-alerts", "serious-count"],
    enabled,
    staleTime: 60_000,
    queryFn: seriousOpenAlertCount,
  });

export interface LedgerRow {
  id: string; severity: string; status: string; source_kind: string; source: string; title: string; count: number;
  last_seen: string; verify_kind: string | null; verify_note: string | null;
}

/** NOID-24 M7: enough rows that a critical item is never past the cap (prod 10-30: 2 critical + 78 error open). */
export const OPEN_ALERT_LIMIT = 200;

const SEVERITY_GROUP: Record<string, number> = { fatal: 0, critical: 0, error: 1, warning: 3, info: 3 };
const GROUP_TITLES = ["Critical", "Errors", "CI and nightly checks", "Warnings and notes"] as const;

/**
 * NOID-24 M7: the Open Alerts list in groups, critical first (fatal and critical), then errors, then CI rows,
 * then warnings and notes; newest first inside each. Each check carries its group's title for the heading.
 */
export function openAlertChecks(rows: readonly LedgerRow[]): (ConfigCheck & { group: string; groupStart: boolean })[] {
  const rank = (r: LedgerRow) => (r.source === CI_SOURCE ? 2 : SEVERITY_GROUP[r.severity] ?? 1);
  return [...rows]
    .sort((a, b) => rank(a) - rank(b) || Date.parse(b.last_seen) - Date.parse(a.last_seen))
    .map((r, i, sorted) => ({
      id: r.id,
      group: GROUP_TITLES[rank(r)],
      groupStart: i === 0 || rank(sorted[i - 1]) !== rank(r),
      label: `${r.title} (${r.count}×)`,
      tone: TONE[r.severity] ?? "danger",
      detail:
        `${r.source_kind} · ${r.source} · ${r.severity} · ${r.status} · last ${new Date(r.last_seen).toLocaleString()}` +
        ` · closes when: ${r.verify_kind === "sql_condition" ? "its SQL condition re-checks clear" : r.verify_kind === "workflow" ? "its workflow re-runs green" : "someone re-runs its detector and records the evidence"}` +
        (r.verify_note ? ` · ${r.verify_note}` : ""),
    }));
}

/** The Open Alerts read (useOpenAlerts' fetcher): a failed read is a row that says so, never an empty card. */
export async function fetchOpenAlerts(): Promise<(ConfigCheck & { group?: string; groupStart?: boolean })[]> {
  const { data, error } = await supabase
    .from("ops_alert_ledger")
    .select("id, severity, status, source_kind, source, title, count, last_seen, verify_kind, verify_note")
    .neq("status", "closed")
    .order("last_seen", { ascending: false })
    .limit(OPEN_ALERT_LIMIT);
  if (error) {
    return [{ id: "ledger-read", label: "Could not read the alert ledger", tone: "unknown", detail: error.message }];
  }
  if (!data?.length) {
    return [{ id: "ledger-empty", label: "No open alerts", tone: "ok", detail: "Every recorded alert has been re-checked by its detector and cleared." }];
  }
  return openAlertChecks(data as LedgerRow[]);
}

export const useOpenAlerts = () =>
  useInstantQuery<(ConfigCheck & { group?: string; groupStart?: boolean })[]>({
    key: ["admin-open-alerts"],
    fallback: [],
    fetcher: fetchOpenAlerts,
  });
