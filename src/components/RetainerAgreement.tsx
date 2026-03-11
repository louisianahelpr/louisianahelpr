import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CalendarHeart, Pause, Play, XCircle } from "lucide-react";
import { toast } from "sonner";

type Retainer = {
  id: string;
  customer_id: string;
  helper_id: string;
  category: string;
  frequency: string;
  budget_per_session: number;
  discount_percent: number;
  status: string;
  next_job_date: string | null;
  description: string | null;
  created_at: string;
};

export function RetainerAgreement({
  customerId,
  helperId,
  helperName,
}: {
  customerId: string;
  helperId: string;
  helperName: string;
}) {
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("cleaning");
  const [frequency, setFrequency] = useState("weekly");
  const [budget, setBudget] = useState("");
  const [description, setDescription] = useState("");
  const [nextDate, setNextDate] = useState("");

  useEffect(() => {
    loadRetainers();
  }, [customerId, helperId]);

  const loadRetainers = async () => {
    const { data } = await supabase
      .from("retainer_agreements" as any)
      .select("*")
      .eq("customer_id", customerId)
      .eq("helper_id", helperId)
      .order("created_at", { ascending: false });
    if (data) setRetainers(data as any[]);
  };

  const createRetainer = async () => {
    if (!budget || !nextDate) return;
    const { error } = await (supabase.from("retainer_agreements" as any) as any).insert({
      customer_id: customerId,
      helper_id: helperId,
      category,
      frequency,
      budget_per_session: parseFloat(budget),
      next_job_date: nextDate,
      description: description.trim() || null,
    });
    if (error) {
      toast.error("Failed to create retainer");
    } else {
      toast.success("Retainer agreement created!");
      setShowForm(false);
      setBudget("");
      setDescription("");
      setNextDate("");
      loadRetainers();
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await (supabase.from("retainer_agreements" as any) as any)
      .update({ status })
      .eq("id", id);
    toast.success(`Retainer ${status}`);
    loadRetainers();
  };

  const frequencyLabel: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <CalendarHeart className="w-4 h-4 text-primary" /> Retainer with {helperName}
      </h3>

      {retainers.map((r) => (
        <div
          key={r.id}
          className={`rounded-lg border p-3 space-y-2 ${
            r.status === "active" ? "border-primary/30 bg-primary/5" : "border-border"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground capitalize">{r.category.replace("_", " ")}</p>
              <p className="text-xs text-muted-foreground">
                {frequencyLabel[r.frequency]} · ${r.budget_per_session}/session · {r.discount_percent}% discount
              </p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                r.status === "active"
                  ? "bg-primary/10 text-primary"
                  : r.status === "paused"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {r.status}
            </span>
          </div>
          {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
          {r.next_job_date && (
            <p className="text-xs text-muted-foreground">
              Next session: {new Date(r.next_job_date + "T00:00").toLocaleDateString()}
            </p>
          )}
          {r.status === "active" && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(r.id, "paused")}>
                <Pause className="w-3 h-3 mr-1" /> Pause
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => updateStatus(r.id, "cancelled")}>
                <XCircle className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </div>
          )}
          {r.status === "paused" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(r.id, "active")}>
              <Play className="w-3 h-3 mr-1" /> Resume
            </Button>
          )}
        </div>
      ))}

      {!showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="w-full">
          <CalendarHeart className="w-4 h-4 mr-1" /> Set Up Retainer
        </Button>
      )}

      {showForm && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cleaning">Cleaning</SelectItem>
                  <SelectItem value="yard_work">Yard Work</SelectItem>
                  <SelectItem value="pet_care">Pet Care</SelectItem>
                  <SelectItem value="errands">Errands</SelectItem>
                  <SelectItem value="handyman">Handyman</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Frequency</label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Budget/session ($)</label>
              <Input type="number" min="5" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">First session</label>
              <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)…"
            rows={2}
            className="text-xs"
            maxLength={300}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={createRetainer} disabled={!budget || !nextDate}>
              Create Retainer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            10% discount applied automatically for retainer bookings.
          </p>
        </div>
      )}
    </div>
  );
}
