import { useEffect, useState } from "react";
import BusinessNoAccountState from "@/components/business/BusinessNoAccountState";
import BusinessLayout from "@/components/business/BusinessLayout";
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
import { formatCategory, formatTimestamp } from "@/lib/format";
import { jobStatusLabel } from "@/lib/statusLabels";
import { toast } from "sonner";

type JsPDFWithAutoTable = import("jspdf").jsPDF & { lastAutoTable?: { finalY: number } };

// Narrow a thrown value to a Supabase/Postgrest-shaped error so we can read
// its `code` without resorting to `any`.
const isPostgrestError = (e: unknown): e is { code?: string; message?: string } =>
  typeof e === "object" && e !== null && "code" in e;

type Cadence = "monthly" | "weekly" | "off";

// report_recipients / report_cadence are not yet in the generated Supabase
// types (migration regen pending), so the `businesses` table is accessed via
// an untyped builder and the prefs row is described by this local shape.
type ReportPrefsRow = {
  report_recipients: string[] | null;
  report_cadence: Cadence | null;
};

const fmtMonth = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });

const BusinessReports = () => {
  usePageTitle("Monthly Reports — Helpr Business");
  const { business, isLoading } = useMyBusiness();

  const [recipients, setRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const businessId = business?.business_id;

  // Hydrate prefs once business resolves
  useEffect(() => {
    if (!businessId) return;
    (async () => {
      // report_recipients / report_cadence not yet in generated types → untyped builder.
      const { data, error } = await (supabase.from as any)("businesses")
        .select("report_recipients, report_cadence")
        .eq("id", businessId)
        .maybeSingle();
      if (error) {
        // PGRST204/missing column → migration not deployed yet. Leave defaults.
        return;
      }
      const prefs = data as ReportPrefsRow | null;
      setRecipients(prefs?.report_recipients ?? []);
      setCadence(prefs?.report_cadence ?? "monthly");
    })();
  }, [businessId]);

  if (isLoading) {
    return (
      <BusinessLayout eyebrow="Reports" title="Monthly Reports">
        <div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>
      </BusinessLayout>
    );
  }
  if (!business) return <BusinessNoAccountState title="Monthly Reports" />;
  if (!business.is_owner) {
    return (
      <BusinessLayout eyebrow="Reports" title="Monthly Reports">
        <Card className="p-6">
          <p className="text-ds-13 text-muted-foreground">Only the business owner can configure report delivery.</p>
        </Card>
      </BusinessLayout>
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
      // report_* columns not yet in generated types → untyped builder.
      const { error } = await (supabase.from as any)("businesses")
        .update({ report_recipients: recipients, report_cadence: cadence })
        .eq("id", businessId);
      if (error) throw error;
      hapticSuccess();
      toast.success("Saved");
    } catch (err: unknown) {
      hapticError();
      const code = isPostgrestError(err) ? err.code : undefined;
      if (code === "PGRST204" || code === "42703") {
        toast.error("This feature isn't available just yet — check back soon.");
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't save preferences.");
      }
    } finally {
      setSaving(false);
    }
  };

  const previewMonth = new Date();
  previewMonth.setMonth(previewMonth.getMonth() - 1);

  const handlePreviewPdf = async () => {
    if (!businessId) return;
    setPdfBusy(true);
    try {
      const { data: memberRows, error: memberErr } = await supabase
        .from("business_members")
        .select("user_id")
        .eq("business_id", businessId);
      if (memberErr) throw memberErr;
      const memberIds: string[] = (memberRows ?? [])
        .map((r) => r.user_id)
        .filter((id): id is string => !!id);

      const now = new Date();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
      const { data: jobRows, error: jobErr } = await supabase
        .from("jobs")
        .select("id, title, status, budget, category, helper_id, created_at")
        .in("customer_id", memberIds)
        .gte("created_at", lastMonthStart)
        .lte("created_at", lastMonthEnd)
        .order("created_at", { ascending: false });
      if (jobErr) throw jobErr;

      const jobs = jobRows ?? [];
      const totalSpend = jobs
        .filter((j) => j.status === "completed")
        .reduce((sum, j) => sum + Number(j.budget ?? 0), 0);
      const jobsCompleted = jobs.filter((j) => j.status === "completed").length;
      const uniqueHelpers = new Set(jobs.map((j) => j.helper_id).filter(Boolean)).size;

      const categoryCount: Record<string, number> = {};
      for (const j of jobs) {
        if (j.category) categoryCount[j.category] = (categoryCount[j.category] ?? 0) + 1;
      }
      const topCategories = Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const monthLabel = previewMonth.toLocaleString("en-US", { month: "long", year: "numeric" });
      const monthSlug = previewMonth.toLocaleString("en-US", { month: "short", year: "numeric" })
        .replace(/[^a-z0-9]+/gi, "-").toLowerCase();

      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" }) as JsPDFWithAutoTable;

      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.setTextColor("#8B4513");
      doc.text("Helpr Business", 40, 52);
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.setTextColor("#333333");
      doc.text(business!.business_name, 40, 72);
      doc.text(monthLabel, 40, 88);

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor("#8B4513");
      doc.text("Summary", 40, 116);
      doc.setFont("helvetica", "normal");
      doc.setTextColor("#333333");
      doc.setFontSize(10);
      doc.text(`Total Spend: $${totalSpend.toFixed(2)}`, 40, 132);
      doc.text(`Jobs Completed: ${jobsCompleted}`, 200, 132);
      doc.text(`Unique Helpers: ${uniqueHelpers}`, 360, 132);

      let nextY = 152;

      if (topCategories.length > 0) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor("#8B4513");
        doc.text("Top Categories", 40, nextY);
        nextY += 8;
        autoTable(doc, {
          startY: nextY,
          head: [["Category", "Jobs"]],
          body: topCategories.map(([cat, count]) => [formatCategory(cat), count]),
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [139, 69, 19], textColor: [255, 255, 255], fontStyle: "bold" },
          margin: { left: 40, right: 40 },
        });
        nextY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? nextY + 60;
        nextY += 16;
      }

      const jobTableRows = jobs.slice(0, 50).map((j) => [
        formatTimestamp(j.created_at),
        (j.title ?? "").length > 32 ? (j.title ?? "").slice(0, 30) + "…" : (j.title ?? ""),
        jobStatusLabel(j.status),
        `$${Number(j.budget ?? 0).toFixed(2)}`,
      ]);

      if (jobTableRows.length > 0) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor("#8B4513");
        doc.text("Jobs", 40, nextY);
        nextY += 8;
        autoTable(doc, {
          startY: nextY,
          head: [["Date", "Title", "Status", "Budget"]],
          body: jobTableRows,
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [139, 69, 19], textColor: [255, 255, 255], fontStyle: "bold" },
          columnStyles: { 3: { halign: "right" } },
          margin: { left: 40, right: 40 },
        });
        nextY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? nextY + 60;
      }

      doc.setFontSize(8);
      doc.setTextColor("#888888");
      doc.setFont("helvetica", "normal");
      doc.text(
        `Generated ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`,
        40,
        nextY + 20,
      );

      doc.save(`helpr-business-${monthSlug}.pdf`);
      hapticSuccess();
    } catch {
      hapticError();
      toast.error("Couldn't load report data — try again?");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <BusinessLayout
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
          <p className="font-semibold text-ds-13">Helpr Business · {business.business_name} · {fmtMonth(previewMonth)}</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            Total spend · jobs completed · helpers used · top categories
          </p>
          <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={handlePreviewPdf} disabled={pdfBusy}>
            {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {pdfBusy ? "Generating…" : "Preview PDF"}
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
            aria-label="Add recipient email"
            placeholder="finance@yourcompany.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
          />
          <Button onClick={addRecipient} variant="outline" aria-label="Add recipient"><Plus className="w-4 h-4" /></Button>
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
    </BusinessLayout>
  );
};

export default BusinessReports;
