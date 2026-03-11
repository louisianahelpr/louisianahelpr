import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type GroupHelper = {
  id: string;
  helper_id: string;
  status: string;
  helperName?: string;
};

export function GroupJobHelpers({
  jobId,
  helpersNeeded,
  isOwner,
}: {
  jobId: string;
  helpersNeeded: number;
  isOwner: boolean;
}) {
  const [helpers, setHelpers] = useState<GroupHelper[]>([]);

  useEffect(() => {
    loadHelpers();
  }, [jobId]);

  const loadHelpers = async () => {
    const { data } = await supabase
      .from("group_job_helpers" as any)
      .select("*")
      .eq("job_id", jobId);
    if (data && (data as any[]).length > 0) {
      const helperIds = (data as any[]).map((h: any) => h.helper_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", helperIds);
      const nameMap = new Map(profiles?.map((p) => [p.user_id, p.full_name || "Helpr"]) || []);
      setHelpers(
        (data as any[]).map((h: any) => ({
          ...h,
          helperName: nameMap.get(h.helper_id) || "Helper",
        }))
      );
    } else {
      setHelpers([]);
    }
  };

  const removeHelper = async (id: string) => {
    await (supabase.from("group_job_helpers" as any) as any).delete().eq("id", id);
    toast.success("Helper removed from group");
    loadHelpers();
  };

  const filledSlots = helpers.filter((h) => h.status === "accepted").length;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" /> Group Job
      </h3>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${(filledSlots / helpersNeeded) * 100}%` }}
          />
        </div>
        <span className="text-xs font-medium text-foreground">
          {filledSlots}/{helpersNeeded} helpers
        </span>
      </div>

      {helpers.length > 0 && (
        <div className="space-y-2">
          {helpers.map((h) => (
            <div key={h.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                  {(h.helperName || "?")[0].toUpperCase()}
                </div>
                <span className="text-sm text-foreground">{h.helperName}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  h.status === "accepted" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
                }`}>
                  {h.status}
                </span>
              </div>
              {isOwner && (
                <button onClick={() => removeHelper(h.id)} className="text-muted-foreground hover:text-destructive">
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {filledSlots < helpersNeeded && (
        <p className="text-xs text-muted-foreground text-center">
          {helpersNeeded - filledSlots} more helper{helpersNeeded - filledSlots > 1 ? "s" : ""} needed
        </p>
      )}
    </div>
  );
}
