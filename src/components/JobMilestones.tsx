import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, CheckCircle, Circle, Milestone } from "lucide-react";
import { toast } from "sonner";

type MilestoneItem = {
  id: string;
  title: string;
  amount: number;
  status: string;
  sort_order: number;
};

export function JobMilestones({
  jobId,
  isOwner,
  isHelper,
  totalBudget,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
  totalBudget: number;
}) {
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMilestones();
  }, [jobId]);

  const loadMilestones = async () => {
    const { data } = await supabase
      .from("job_milestones" as any)
      .select("*")
      .eq("job_id", jobId)
      .order("sort_order");
    if (data) setMilestones(data as any[]);
    setLoading(false);
  };

  const addMilestone = async () => {
    if (!newTitle.trim() || !newAmount) return;
    const amount = parseFloat(newAmount);
    const usedAmount = milestones.reduce((sum, m) => sum + m.amount, 0);
    if (usedAmount + amount > totalBudget) {
      toast.error(`Exceeds budget! Remaining: $${(totalBudget - usedAmount).toFixed(2)}`);
      return;
    }
    const { error } = await (supabase.from("job_milestones" as any) as any).insert({
      job_id: jobId,
      title: newTitle.trim(),
      amount,
      sort_order: milestones.length,
    });
    if (error) {
      toast.error("Failed to add milestone");
    } else {
      setNewTitle("");
      setNewAmount("");
      loadMilestones();
    }
  };

  const completeMilestone = async (id: string) => {
    await (supabase.from("job_milestones" as any) as any)
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    toast.success("Milestone completed!");
    loadMilestones();
  };

  const removeMilestone = async (id: string) => {
    await (supabase.from("job_milestones" as any) as any).delete().eq("id", id);
    loadMilestones();
  };

  if (loading) return null;

  const usedAmount = milestones.reduce((sum, m) => sum + m.amount, 0);
  const remaining = totalBudget - usedAmount;
  const completedAmount = milestones
    .filter((m) => m.status === "completed")
    .reduce((sum, m) => sum + m.amount, 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Milestone className="w-4 h-4 text-primary" /> Milestones
      </h3>

      {milestones.length > 0 && (
        <>
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(completedAmount / totalBudget) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              ${completedAmount.toFixed(2)} / ${totalBudget.toFixed(2)} completed
            </p>
          </div>

          <div className="space-y-2">
            {milestones.map((m) => (
              <div
                key={m.id}
                className={`flex items-center gap-2 rounded-lg border p-2.5 ${
                  m.status === "completed" ? "border-primary/30 bg-primary/5" : "border-border"
                }`}
              >
                {m.status === "completed" ? (
                  <CheckCircle className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span
                  className={`text-sm flex-1 ${
                    m.status === "completed" ? "line-through text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {m.title}
                </span>
                <span className="text-sm font-medium text-primary">${m.amount.toFixed(2)}</span>
                {m.status !== "completed" && isHelper && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => completeMilestone(m.id)}>
                    Done
                  </Button>
                )}
                {m.status !== "completed" && isOwner && (
                  <button onClick={() => removeMilestone(m.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {isOwner && remaining > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Remaining budget: <span className="font-medium text-foreground">${remaining.toFixed(2)}</span>
          </p>
          <div className="flex gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Milestone name…"
              className="text-sm flex-1"
              maxLength={100}
            />
            <Input
              type="number"
              step="1"
              min="1"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              placeholder="$"
              className="w-20 text-sm"
            />
            <Button size="sm" variant="outline" onClick={addMilestone} disabled={!newTitle.trim() || !newAmount}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {milestones.length === 0 && !isOwner && (
        <p className="text-xs text-muted-foreground italic">No milestones set for this job.</p>
      )}
    </div>
  );
}
