import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import BusinessShell from "@/components/business/shell/BusinessShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { FileText, Mail, Plus, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";

type Cadence = "monthly" | "weekly" | "off";

const fmtMonth = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });

const BusinessReports = () => {
  usePageTitle("Monthly Reports — Helpr Business");
  const { business, isLoading } = useMyBusiness();

  const [recipients, setRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [saving, setSaving] = useState(false);

  const businessId = business?.business_id;

  // Hydrate prefs once business resolves
  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const { data, error } = await (supabase.from as any)("businesses")
        .select("report_recipients, report_cadence")
        .eq("id", businessId)
        .maybeSingle();
      if (error) {
        // PGRST204/missing column → migration not deployed yet. Leave defaults.
        return;
      }
      setRecipients(((data as any)?.report_recipients ?? []) as string[]);
      setCadence((((data as any)?.report_cadence as Cadence) ?? "monthly"));
    })();
  }, [businessId]);

  if (isLoading) {
    return (
      <BusinessShell eyebrow="Reports" title="Monthly Reports">
        <div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>
      </BusinessShell>
    );
  }
  if (!business) return <Navigate to="/dashboard" replace />;
  if (!business.is_owner) {
    return (
      <BusinessShell eyebrow="Reports" title="Monthly Reports">
        <Card className="p-6">
          <p className="text-ds-13 text-muted-foreground">Only the business owner can configure report delivery.</p>
        </Card>
      </BusinessShell>
    );
  }

  const addRecipient = () => {
    const v = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (recipients.includes(v.toLowerCase())) {
      toast.message("Already in the list.");
      return;
    }
    setRecipients([...recipients, v.toLowerCase()]);
    setNewEmail("");
  };

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter((e) => e !== email));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await (supabase.from as any)("businesses")
        .update({ report_recipients: recipients, report_cadence: cadence })
        .eq("id", businessId);
      if (error) throw error;
      hapticSuccess();
      toast.success("Saved");
    } catch (err: any) {
      hapticError();
      if (err?.code === "PGRST204" || err?.code === "42703") {
        toast.error("Reports columns not yet deployed — run `supabase db push`.");
      } else {
        toast.error(err.message || "Couldn't save preferences.");
      }
    } finally {
      setSaving(false);
    }
  };

  const previewMonth = new Date();
  previewMonth.setMonth(previewMonth.getMonth() - 1);

  return (
    <BusinessShell
      eyebrow="Reports"
      title="Monthly Reports"
      meta="Auto-emailed PDF of last month's activity."
    >
      <Card className="p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4" /> Last month preview
        </h2>
        <div className="rounded-ds-md border border-dashed border-border bg-background p-6 text-center">
          <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
          <p className="font-semibold text-ds-13">Helpr Business · {fmtMonth(previewMonth)}</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            Total spend · jobs completed · helpers used · top categories
          </p>
          <Button variant="outline" size="sm" className="mt-3" disabled>
            Preview PDF (coming soon)
          </Button>
        </div>
      </Card>

      <Card className="p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4" /> Recipients
        </h2>
        <div className="flex gap-2 mb-3">
          <Input
            type="email"
            placeholder="finance@yourcompany.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
          />
          <Button onClick={addRecipient} variant="outline"><Plus className="w-4 h-4" /></Button>
        </div>
        {recipients.length === 0 ? (
          <p className="text-ds-12 text-muted-foreground">No recipients yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recipients.map((r) => (
              <Badge key={r} variant="secondary" className="gap-1 px-2 h-7">
                {r}
                <button onClick={() => removeRecipient(r)} aria-label={`Remove ${r}`} className="ml-0.5 hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 mb-5">
        <h2 className="font-semibold mb-3">Cadence</h2>
        <Label htmlFor="r-cadence" className="sr-only">Cadence</Label>
        <select
          id="r-cadence"
          className="w-full h-10 px-3 rounded-ds-sm border border-border bg-background text-ds-13"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as Cadence)}
        >
          <option value="monthly">Monthly (1st of each month)</option>
          <option value="weekly">Weekly (every Monday)</option>
          <option value="off">Off (don't send)</option>
        </select>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save preferences"}
      </Button>
    </BusinessShell>
  );
};

export default BusinessReports;
