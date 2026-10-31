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
 * How many open ledger items are serious (a warning or a note is not): the
 * number the admin home reads before it may call the platform calm. Same ledger
 * and same "open" as the list below. A failed read throws, so the page shows it
 * as a data error, never as a confident zero.
 */
export const useSeriousOpenAlertCount = (enabled: boolean) =>
  useQuery({
    queryKey: ["admin-open-alerts", "serious-count"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await supabase
        .from("ops_alert_ledger")
        .select("id", { count: "exact", head: true })
        .neq("status", "closed")
        .in("severity", ["fatal", "critical", "error"]);
      unwrap(result);
      if (result.count === null) throw new Error("The alert ledger returned no count");
      return result.count;
    },
  });

export const useOpenAlerts = () =>
  useInstantQuery<ConfigCheck[]>({
    key: ["admin-open-alerts"],
    fallback: [],
    fetcher: async () => {
      const { data, error } = await supabase
        .from("ops_alert_ledger")
        .select("id, severity, status, source_kind, source, title, count, last_seen, verify_kind, verify_note")
        .neq("status", "closed")
        .order("last_seen", { ascending: false })
        .limit(50);
      if (error) {
        return [{ id: "ledger-read", label: "Could not read the alert ledger", tone: "unknown", detail: error.message }];
      }
      if (!data?.length) {
        return [{ id: "ledger-empty", label: "No open alerts", tone: "ok", detail: "Every recorded alert has been re-checked by its detector and cleared." }];
      }
      return data.map((r) => ({
        id: r.id,
        label: `${r.title} (${r.count}×)`,
        tone: TONE[r.severity] ?? "danger",
        detail:
          `${r.source_kind} · ${r.source} · ${r.severity} · ${r.status} · last ${new Date(r.last_seen).toLocaleString()}` +
          ` · closes when: ${r.verify_kind === "sql_condition" ? "its SQL condition re-checks clear" : r.verify_kind === "workflow" ? "its workflow re-runs green" : "someone re-runs its detector and records the evidence"}` +
          (r.verify_note ? ` · ${r.verify_note}` : ""),
      }));
    },
  });
