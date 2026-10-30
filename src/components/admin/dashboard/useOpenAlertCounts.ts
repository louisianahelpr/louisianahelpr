import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * How many alerts on the ledger are still open, for the admin home (audit
 * 2026-10-30 H1: a critical money alert sat open for a day while the home said
 * "Everything looks calm"). Same "open" as the Health list: anything not
 * closed. A failed read reaches the home's "Some stats may be outdated" line.
 */
export const useOpenAlertCounts = (enabled: boolean) =>
  useQuery({
    queryKey: ["admin-open-alert-counts"],
    enabled,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("ops_alert_ledger")
          .select("severity")
          .neq("status", "closed")
          .in("severity", ["fatal", "critical", "error"])
          .limit(1000),
      ) ?? [];
      const critical = rows.filter((r) => r.severity !== "error").length;
      return { critical, error: rows.length - critical };
    },
  });
