import { useState } from "react";
import BusinessNoAccountState from "@/components/business/BusinessNoAccountState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BusinessLayout from "@/components/business/BusinessLayout";
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
import type { Json } from "@/integrations/supabase/types";
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
  template_payload: Json;
  next_run_at: string | null;
  last_run_at: string | null;
  active: boolean;
  created_at: string;
}

// Narrow a thrown value to a Supabase/Postgrest-shaped error so we can read
// its `code` without resorting to `any`.
const isPostgrestError = (e: unknown): e is { code?: string; message?: string } =>
  typeof e === "object" && e !== null && "code" in e;

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
  const [budgetDollars, setBudgetDollars] = useState("125");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const {
    data: templates = [],
    isLoading: tLoading,
    isError: tError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: queryKeys.business.templates(businessId),
    enabled: !!businessId,
    queryFn: async () => {
      // business_job_templates not yet in generated types → untyped builder.
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
      <BusinessLayout eyebrow="Recurring jobs" title="Contracts">
        <div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>
      </BusinessLayout>
    );
  }
  if (!business) return <BusinessNoAccountState title="Contracts" />;

  const selectedPreset = SCHEDULE_PRESETS.find((p) => p.id === presetId)!;
  const cronExpression = presetId === "custom" ? customCron.trim() : selectedPreset.cron;
  const scheduleLabel = presetId === "custom" ? `Cron: ${customCron.trim() || "—"}` : selectedPreset.label;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !name.trim() || !cronExpression) return;
    setSubmitting(true);
    try {
      // Business verification gate — a recurring template spawns real jobs
      // on a cron, so it must be gated on the same admin-verified status as
      // ad-hoc posting. Fresh fetch + fail closed to mirror the useJobSubmit
      // pattern; the RLS check on jobs.INSERT still fires per spawned row,
      // but we block here so the template itself never lands.
      const { data: bizRow, error: bizErr } = await supabase
        .from("businesses")
        .select("verification_status")
        .eq("id", businessId)
        .single();
      if (bizErr) throw bizErr;
      const bizStatus = (bizRow as { verification_status?: string })?.verification_status;
      if (bizStatus !== "verified") {
        hapticError();
        const label =
          bizStatus === "pending" ? "still being reviewed by our team"
            : bizStatus === "rejected" ? "was rejected — see the reason on your Business page"
              : "not yet verified";
        toast.error(
          `Your business is ${label}. Businesses must be verified (insurance + license) before scheduling recurring jobs.`,
        );
        setSubmitting(false);
        return;
      }

      const payload = {
        title: name.trim(),
        description: description.trim(),
        budget_cents: Math.round((Number(budgetDollars) || 0) * 100),
      };
      const { error } = await (supabase.from as any)("business_job_templates").insert({
        business_id: businessId,
        name: name.trim(),
        schedule_cron: cronExpression,
        schedule_label: scheduleLabel,
        template_payload: payload,
        // next_run_at is intentionally null here — the cron worker that
        // materializes jobs from templates fills it on its first scan.
        next_run_at: null,
        active: true,
      });
      if (error) throw error;
      hapticSuccess();
      toast.success("Recurring job created");
      setName(""); setDescription(""); setBudgetDollars("125");
      queryClient.invalidateQueries({ queryKey: queryKeys.business.templates(businessId) });
    } catch (err: unknown) {
      hapticError();
      const code = isPostgrestError(err) ? err.code : undefined;
      if (code === "PGRST204" || code === "42P01") {
        toast.error("This feature isn't available just yet — check back soon.");
      } else {
        toast.error(err instanceof Error ? err.message : "We couldn't save that template — try again.");
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't update template.");
    }
  };

  const deleteTemplate = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await (supabase.from as any)("business_job_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: queryKeys.business.templates(businessId) });
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Couldn't delete that template — try again?");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <BusinessLayout
      eyebrow="Recurring jobs"
      title="Contracts"
      meta="Schedule jobs that auto-post on a cron. Your team accepts as they come in."
      requiresVerification
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
              <Label htmlFor="t-budget">Budget (USD)</Label>
              <Input
                id="t-budget"
                type="number"
                min={0}
                step="0.01"
                value={budgetDollars}
                onChange={(e) => setBudgetDollars(e.target.value)}
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
          <Badge variant="sienna" className="text-ds-11">{templates.length}</Badge>
        </div>
        {tLoading ? (
          <div className="py-6 flex justify-center"><HelprSpinner size={24} /></div>
        ) : tError ? (
          <div className="py-2">
            <p className="text-ds-12 text-muted-foreground mb-2">
              Couldn't load your schedules.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchTemplates()}>
              Try again
            </Button>
          </div>
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
                <Button variant="ghost" size="sm" disabled={deletingId === t.id} onClick={() => deleteTemplate(t.id)} aria-label="Delete">
                  {deletingId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
    </BusinessLayout>
  );
};

export default BusinessContracts;
