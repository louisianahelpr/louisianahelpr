import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Users, XCircle } from "lucide-react";
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
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadHelpers();
  }, [jobId]);

  const loadHelpers = async () => {
    const { data, error } = await supabase
      .from("group_job_helpers")
      .select("*")
      .eq("job_id", jobId);
    if (error) {
      console.error("[GroupJobHelpers] failed to load group helpers:", error);
      toast.error("Couldn't load group helprs");
      return;
    }
    const rows = (data ?? []) as unknown as GroupHelper[];
    if (rows.length > 0) {
      const helperIds = rows.map((h) => h.helper_id);
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", helperIds);
      if (profilesError) {
        console.error("[GroupJobHelpers] failed to load helper profiles:", profilesError);
      }
      const nameMap = new Map(profiles?.map((p) => [p.user_id, formatName(p.full_name, "Helpr")]) || []);
      setHelpers(
        rows.map((h) => ({
          ...h,
          helperName: nameMap.get(h.helper_id) || "Helpr",
        }))
      );
    } else {
      setHelpers([]);
    }
  };

  const removeHelper = async (id: string) => {
    if (removingIds.has(id)) return;
    const removed = helpers.find((h) => h.id === id);
    setRemovingIds((prev) => new Set(prev).add(id));
    // Optimistically drop the helper so the UI updates on tap.
    setHelpers((prev) => prev.filter((h) => h.id !== id));

    const { error } = await supabase.from("group_job_helpers").delete().eq("id", id);

    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (error) {
      console.error("[GroupJobHelpers] failed to remove helper:", error);
      toast.error("Couldn't remove helpr");
      // Revert: re-add the removed helper, or reload if we lost the snapshot.
      if (removed) {
        setHelpers((prev) => (prev.some((h) => h.id === id) ? prev : [...prev, removed]));
      } else {
        loadHelpers();
      }
      return;
    }

    toast.success("Helpr removed from group");
  };

  const filledSlots = helpers.filter((h) => h.status === "accepted").length;

  return (
    <div className="rounded-ds-md liquid-glass p-5 space-y-3">
      <h3 className="text-ds-13 font-semibold text-foreground flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" /> Group Job
      </h3>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${(filledSlots / helpersNeeded) * 100}%` }}
          />
        </div>
        <span className="text-ds-11 font-medium text-foreground">
          {filledSlots}/{helpersNeeded} helprs
        </span>
      </div>

      {helpers.length > 0 && (
        <div className="space-y-2">
          {helpers.map((h) => (
            <div key={h.id} className="flex items-center justify-between p-2 rounded-ds-sm border border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-ds-11 font-bold">
                  {(h.helperName || "?")[0].toUpperCase()}
                </div>
                <span className="text-ds-13 text-foreground">{h.helperName}</span>
                <span className={`text-ds-11 px-1.5 py-0.5 rounded-full ${
                  h.status === "accepted" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
                }`}>
                  {h.status}
                </span>
              </div>
              {isOwner && (
                <button onClick={() => removeHelper(h.id)} aria-label="Remove helper" className="text-muted-foreground hover:text-destructive">
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {filledSlots < helpersNeeded && (
        <p className="text-ds-11 text-muted-foreground text-center">
          {helpersNeeded - filledSlots} more helpr{helpersNeeded - filledSlots > 1 ? "s" : ""} needed
        </p>
      )}
    </div>
  );
}
