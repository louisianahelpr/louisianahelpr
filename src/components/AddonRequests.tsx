import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Check, X, Package } from "lucide-react";
import { toast } from "sonner";

type Addon = {
  id: string;
  description: string;
  additional_cost: number;
  status: string;
  requested_by: string;
  created_at: string;
};

export function AddonRequests({
  jobId,
  isOwner,
  isHelper,
  userId,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
  userId: string;
}) {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");

  useEffect(() => {
    loadAddons();
  }, [jobId]);

  const loadAddons = async () => {
    const { data } = await supabase
      .from("addon_requests" as any)
      .select("*")
      .eq("job_id", jobId)
      .order("created_at");
    if (data) setAddons(data as any[]);
  };

  const submitAddon = async () => {
    if (!description.trim() || !cost) return;
    const { error } = await (supabase.from("addon_requests" as any) as any).insert({
      job_id: jobId,
      requested_by: userId,
      description: description.trim(),
      additional_cost: parseFloat(cost),
    });
    if (error) {
      toast.error("Failed to submit add-on request");
    } else {
      toast.success("Add-on request sent!");
      setDescription("");
      setCost("");
      setShowForm(false);
      loadAddons();
    }
  };

  const updateAddonStatus = async (id: string, status: string) => {
    await (supabase.from("addon_requests" as any) as any)
      .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null })
      .eq("id", id);
    toast.success(`Add-on ${status}`);
    loadAddons();
  };

  if (addons.length === 0 && !isHelper && !isOwner) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Package className="w-4 h-4 text-primary" /> Add-on Requests
      </h3>
      <p className="text-xs text-muted-foreground">
        Request additional work with extra compensation.
      </p>

      {addons.map((addon) => (
        <div
          key={addon.id}
          className={`rounded-lg border p-3 space-y-1 ${
            addon.status === "approved"
              ? "border-primary/30 bg-primary/5"
              : addon.status === "rejected"
              ? "border-destructive/30 bg-destructive/5"
              : "border-border"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-foreground">{addon.description}</p>
            <span className="text-sm font-semibold text-primary shrink-0">
              +${addon.additional_cost.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                addon.status === "approved"
                  ? "bg-primary/10 text-primary"
                  : addon.status === "rejected"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {addon.status}
            </span>
            {addon.status === "pending" && isOwner && (
              <div className="flex gap-1 ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-primary"
                  onClick={() => updateAddonStatus(addon.id, "approved")}
                >
                  <Check className="w-3 h-3 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive"
                  onClick={() => updateAddonStatus(addon.id, "rejected")}
                >
                  <X className="w-3 h-3 mr-1" /> Reject
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}

      {isHelper && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="w-full">
          <PlusCircle className="w-4 h-4 mr-1" /> Request Add-on
        </Button>
      )}

      {showForm && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the additional work…"
            rows={2}
            maxLength={300}
          />
          <div className="flex gap-2">
            <Input
              type="number"
              step="1"
              min="1"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Extra cost ($)"
              className="w-32"
            />
            <Button size="sm" onClick={submitAddon} disabled={!description.trim() || !cost}>
              Submit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
