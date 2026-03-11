import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ClipboardList } from "lucide-react";
import { toast } from "sonner";

type ScopeItem = {
  id: string;
  description: string;
  completed: boolean;
};

export function ScopeAgreement({
  jobId,
  isOwner,
  isHelper,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
}) {
  const [items, setItems] = useState<ScopeItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadItems();
  }, [jobId]);

  const loadItems = async () => {
    const { data } = await supabase
      .from("job_scope_items" as any)
      .select("*")
      .eq("job_id", jobId)
      .order("created_at");
    if (data) setItems(data as any[]);
    setLoading(false);
  };

  const addItem = async () => {
    if (!newItem.trim()) return;
    const { error } = await (supabase.from("job_scope_items" as any) as any).insert({
      job_id: jobId,
      description: newItem.trim(),
    });
    if (error) {
      toast.error("Failed to add scope item");
    } else {
      setNewItem("");
      loadItems();
    }
  };

  const toggleItem = async (id: string, completed: boolean) => {
    await (supabase.from("job_scope_items" as any) as any)
      .update({ completed })
      .eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, completed } : i)));
  };

  const removeItem = async (id: string) => {
    await (supabase.from("job_scope_items" as any) as any).delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-primary" /> Scope Agreement
      </h3>
      <p className="text-xs text-muted-foreground">
        Agreed-upon tasks for this job. Both parties can track completion.
      </p>

      {items.length === 0 && !isOwner && (
        <p className="text-xs text-muted-foreground italic">No scope items defined yet.</p>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 group">
            <Checkbox
              checked={item.completed}
              onCheckedChange={(checked) => toggleItem(item.id, !!checked)}
              disabled={!isOwner && !isHelper}
            />
            <span
              className={`text-sm flex-1 ${
                item.completed ? "line-through text-muted-foreground" : "text-foreground"
              }`}
            >
              {item.description}
            </span>
            {isOwner && (
              <button
                onClick={() => removeItem(item.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add scope item…"
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            maxLength={200}
          />
          <Button size="sm" variant="outline" onClick={addItem} disabled={!newItem.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
