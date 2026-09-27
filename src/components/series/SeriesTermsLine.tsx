import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isNotDeployedYet } from "@/lib/seriesDates";

/**
 * "One Helpr for every visit" or "Days can be split between Helprs": the
 * series terms a Helpr reads BEFORE applying (owner decision Q407 (4)).
 *
 * The browse rows do not carry the column (a select naming a column the
 * database lacks would fail the whole browse feed in the deploy window), so it
 * is read here, from the same open_jobs_browse view the listing came from.
 * `known` short-circuits the read when the caller already has the value. A
 * missing column (db-deploy not landed) or any failure renders nothing.
 */
export function SeriesTermsLine({ jobId, known }: { jobId: string; known?: boolean | null }) {
  const { data } = useQuery({
    queryKey: ["series-terms", jobId],
    enabled: typeof known !== "boolean",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("open_jobs_browse")
        .select("series_split_ok")
        .eq("id", jobId)
        .maybeSingle();
      if (error) {
        if (isNotDeployedYet(error)) return null;
        throw error;
      }
      return (row as { series_split_ok?: boolean | null } | null)?.series_split_ok ?? null;
    },
  });
  const split = typeof known === "boolean" ? known : data;
  if (typeof split !== "boolean") return null;
  return (
    <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground" data-series-terms={split ? "split" : "one"}>
      <Users className="w-3 h-3" aria-hidden />
      {split ? "Days can be split between Helprs" : "One Helpr for every visit"}
    </span>
  );
}
