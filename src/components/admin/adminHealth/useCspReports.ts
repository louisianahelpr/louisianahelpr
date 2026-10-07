import { supabase } from "@/integrations/supabase/client";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import type { ConfigCheck } from "./useConfigChecks";

/**
 * Q1352 (lh-authz-rls review of Q1318): CSP violation reports were stored and
 * never read. csp-report writes one error_logs row per request with
 * tags.source = 'csp' and tags.directive / tags.blocked; prod-errors-check
 * skips them and no screen drew them, so a script the CSP blocks on every page
 * was invisible. This is the last 24 hours, counted by directive and blocked
 * host, on the admin health screen.
 *
 * A failed read is a row that says so (tone `unknown`), never "none".
 */
export const CSP_WINDOW_HOURS = 24;
const ROW_LIMIT = 1000;

export type CspRow = { tags: Record<string, unknown> | null; context?: Record<string, unknown> | null };

/** The blocked target's host (or the CSP keyword: inline, eval, ...). */
function blockedHost(blocked: string): string {
  try {
    return new URL(blocked).host || blocked;
  } catch {
    // Not a URL: a CSP keyword like "inline" or "(none)", shown as it is.
    return blocked;
  }
}

/** Rows -> checks: a summary row, then one per (directive, blocked host), most first. */
export function cspChecks(rows: CspRow[], capped: boolean): ConfigCheck[] {
  if (rows.length === 0) {
    return [{ id: "csp-none", label: `No CSP violation reports in the last ${CSP_WINDOW_HOURS} hours`, tone: "ok", detail: "Nothing the Content Security Policy blocked was reported from louisianahelpr.com." }];
  }
  const groups = new Map<string, { directive: string; host: string; n: number }>();
  let reports = 0;
  for (const r of rows) {
    const tags = r.tags ?? {};
    const directive = String(tags.directive ?? "(unknown)");
    const host = blockedHost(String(tags.blocked ?? "(none)"));
    const n = Number((r.context ?? {}).report_count ?? 1) || 1;
    reports += n;
    const key = `${directive}|${host}`;
    const g = groups.get(key) ?? { directive, host, n: 0 };
    g.n += n;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.n - a.n);
  return [
    {
      id: "csp-total",
      label: `${reports} CSP violation report${reports === 1 ? "" : "s"} in the last ${CSP_WINDOW_HOURS} hours${capped ? ` (first ${ROW_LIMIT} rows read)` : ""}`,
      tone: "warn",
      detail: `${sorted.length} distinct directive and blocked-host pair${sorted.length === 1 ? "" : "s"}. A blocked script or frame of our own means the policy is breaking the page; an extension's is noise csp-report already drops. Reports are unauthenticated: anyone can post one, so a count can include forged rows.`,
    },
    ...sorted.slice(0, 10).map((g) => ({
      id: `csp-${g.directive}-${g.host}`,
      label: `${g.directive} blocked ${g.host} (${g.n}×)`,
      tone: "warn" as const,
      detail: "From error_logs, tags.source = 'csp'.",
    })),
  ];
}

export const useCspReports = () =>
  useInstantQuery<ConfigCheck[]>({
    key: ["admin-csp-reports"],
    fallback: [],
    fetcher: async () => {
      const since = new Date(Date.now() - CSP_WINDOW_HOURS * 3_600_000).toISOString();
      const { data, error } = await supabase
        .from("error_logs")
        .select("tags, context")
        .eq("tags->>source", "csp")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);
      if (error) {
        return [{ id: "csp-read", label: "Could not read CSP violation reports", tone: "unknown", detail: error.message }];
      }
      const rows = (data ?? []) as CspRow[];
      return cspChecks(rows, rows.length >= ROW_LIMIT);
    },
  });
