import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BusinessShell from "@/components/business/shell/BusinessShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { CalendarClock, Plus, Loader2, Trash2, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";

const SCHEDULE_PRESETS = [
  { id: "weekday_9am", label: "Every weekday at 9am", cron: "0 9 * * 1-5" },
  { id: "mon_9am", label: "Every Monday at 9am", cron: "0 9 * * 1" },
  { id: "first_of_month", label: "First of the month at 9am", cron: "0 9 1 * *" },
  { id: "custom", label: "Custom cron", cron: "" },
];

interface TemplateRow {
  id: string;
  name: string;
  schedule_cron: string;
  schedule_label: string | null;
  template_payload: any;
  next_run_at: string | null;
  last_run_at: string | null;
  active: boolean;
  created_at: string;
}

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not scheduled";

const BusinessContracts = () => {
  usePageTitle("Recurring Jobs — Helpr Business");
  const { business, isLoading } = useMyBusiness();
  const queryClient = useQueryClient();
  const businessId = business?.business_id;

  // Compose state
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState("mon_9am");
  const [customCron, setCustomCron] = useState("");
  const [budgetCents, setBudgetCents] = useState("12500");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: templates = [], isLoading: tLoading } = useQuery({
    queryKey: queryKeys.business.templates(businessId),
    enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("business_job_templates")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error && (error.code === "PGRST204" || error.code === "42P01")) return [];
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });

  if (isLoading) {
    return (
      <BusinessShell eyebrow="Recurring jobs" title="Contracts">
        <div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>
      </BusinessShell>
    );
  }
  if (!business) return <Navigate to="/dashboard" replace />;

  const selectedPreset = SCHEDULE_PRESETS.find((p) => p.id === presetId)!;
  const cronExpression = presetId === "custom" ? customCron.trim() : selectedPreset.cron;
  const scheduleLabel = presetId === "custom" ? `Cron: ${customCron.trim() || "—"}` : selectedPreset.label;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !name.trim() || !cronExpression) return;
    setSubmitting(true);
    try {
      const payload = {
        title: name.trim(),
        description: description.trim(),
        budget_cents: Number(budgetCents) || 0,
      };
      const { error } = await (supabase.from as any)("business_job_templates").insert({
        business_id: businessId,
        name: name.trim(),
        schedule_cron: cronExpression,
        schedule_label: scheduleLabel,
        template_payload: payload,
        // TODO: real next_run_at computation belongs in the cron worker
        // that materializes jobs from these templates. For now we leave
        // it null and the worker fills it on first scan.
        next_run_at: null,
        active: true,
      });
      if (error) throw error;
      hapticSuccess();
      toast.success("Recurring job created");
      setName(""); setDescription(""); setBudgetCents("12500");
      queryClient.invalidateQueries({ queryKey: queryKeys.business.templates(businessId) });
    } catch (err: any) {
      hapticError();
      if (err?.code === "PGRST204" || err?.code === "42P01") {
        toast.error("Templates table not yet deployed — run `supabase db push`.");
      } else {
        toast.error(err.message || "We couldn't save that template — try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const togglePower = async (row: TemplateRow) => {
    try {
      const { error } = await (supabase.from as any)("business_job_templates")
        .update({ active: !row.active })
        .eq("id", row.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.business.templates(businessId) });
    } catch (err: any) {
      toast.error(err.message || "Couldn't update template.");
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await (supabase.from as any)("business_job_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: queryKeys.business.templates(businessId) });
    } catch (err: any) {
      toast.error(err.message || "Couldn't delete template.");
    }
  };

  return (
    <BusinessShell
      eyebrow="Recurring jobs"
      title="Contracts"
      meta="Schedule jobs that auto-post on a cron. Your team accepts as they come in."
    >
      <Card className="p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4" /> New recurring job
        </h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="t-name">Job name</Label>
            <Input
              id="t-name"
              placeholder="Weekly office cleaning"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <Label htmlFor="t-desc">Description</Label>
            <Textarea
              id="t-desc"
              placeholder="Vacuum, restock supplies, take out trash…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
            <div>
              <Label htmlFor="t-schedule">Schedule</Label>
              <select
                id="t-schedule"
                className="w-full h-10 px-3 rounded-ds-sm border border-border bg-background text-ds-13"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="t-budget">Budget (cents)</Label>
              <Input
                id="t-budget"
                type="number"
                min={0}
                value={budgetCents}
                onChange={(e) => setBudgetCents(e.target.value)}
              />
            </div>
          </div>
          {presetId === "custom" && (
            <div>
              <Label htmlFor="t-cron">Cron expression</Label>
              <Input
                id="t-cron"
                placeholder="0 9 * * 1-5"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className="font-mono"
              />
              <p className="text-ds-11 text-muted-foreground mt-1">
                Five fields: minute hour day-of-month month day-of-week.
              </p>
            </div>
          )}
          <div className="pt-1">
            <Button type="submit" disabled={submitting || !name.trim() || !cronExpression}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create schedule"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <CalendarClock className="w-4 h-4" /> Active schedules
          </h2>
          <Badge variant="secondary" className="text-ds-11">{templates.length}</Badge>
        </div>
        {tLoading ? (
          <div className="py-6 flex justify-center"><HelprSpinner size={24} /></div>
        ) : templates.length === 0 ? (
          <p className="text-ds-12 text-muted-foreground">No recurring jobs yet.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {templates.map((t) => (
              <li key={t.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-semibold text-ds-13 truncate">{t.name}</span>
                    {!t.active && <Badge variant="outline" className="text-ds-10">Paused</Badge>}
                  </div>
                  <p className="text-ds-11 text-muted-foreground">
                    {t.schedule_label ?? t.schedule_cron} · Next run {fmtDate(t.next_run_at)}
                  </p>
                </div>
                <Switch checked={t.active} onCheckedChange={() => togglePower(t)} aria-label="Toggle schedule" />
                <Button variant="ghost" size="sm" onClick={() => deleteTemplate(t.id)} aria-label="Delete">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-ds-11 text-muted-foreground mt-4 flex items-center gap-1.5">
          <Power className="w-3 h-3" />
          A background cron worker materializes jobs from these schedules.
        </p>
      </Card>
    </BusinessShell>
  );
};

export default BusinessContracts;
