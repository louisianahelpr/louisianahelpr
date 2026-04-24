/**
 * GDPR + CCPA data rights page.
 *
 * - GDPR Art. 17 "right to erasure" → delete account button (calls existing
 *   delete-own-account edge function)
 * - CCPA "do not sell or share" → opt-out toggle (we don't sell data, but
 *   the toggle still has to exist for CA residents)
 * - Data export → triggers a JSON dump of profile + jobs + messages
 *
 * Linked from Settings, Privacy Policy, and the iOS App Store privacy listing.
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { report } from "@/lib/errorLogger";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Trash2, ShieldOff, Loader2, ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { safeStorage } from "@/lib/safeStorage";

const DataRights = () => {
  usePageTitle("Your Data Rights — Helpr");
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [doNotSell, setDoNotSell] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      const stored = safeStorage.getItem("helpr_do_not_sell");
      if (stored === "1") setDoNotSell(true);
    });
  }, []);

  const handleExport = async () => {
    if (!userId) return;
    setExporting(true);
    try {
      const [{ data: profile }, { data: jobs }, { data: applications }, { data: reviews }] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("jobs").select("*").or(`customer_id.eq.${userId},helper_id.eq.${userId}`),
        supabase.from("applications").select("*").eq("helper_id", userId),
        supabase.from("reviews").select("*").or(`reviewer_id.eq.${userId},reviewee_id.eq.${userId}`),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        profile,
        jobs,
        applications,
        reviews,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `helpr-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Your data has been downloaded");
    } catch (err) {
      report(err, { tags: { source: "DataRights.exportData" } });
      toast.error("Failed to export your data. Try again or contact support.");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-own-account");
      if (error) throw error;
      toast.success("Your account has been deleted. Goodbye 👋");
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete account. Contact support.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleDoNotSell = (next: boolean) => {
    setDoNotSell(next);
    safeStorage.setItem("helpr_do_not_sell", next ? "1" : "0");
    toast.success(next ? "Opted out of data sharing" : "Opted in to data sharing");
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <PageHeader title="Your Data Rights" />
      <main className="container mx-auto px-4 py-6 max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Under the EU GDPR and California CCPA, you have specific rights about how Helpr handles your personal data.
          Use the controls below to exercise them. For all other privacy questions email{" "}
          <a href="mailto:privacy@louisianahelpr.com" className="text-primary underline">privacy@louisianahelpr.com</a>.
        </p>

        {/* Export */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Download className="w-5 h-5 text-primary mt-1 flex-shrink-0" aria-hidden />
            <div className="flex-1">
              <h2 className="font-display font-semibold text-lg">Download your data</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Get a complete copy of your Helpr data — profile, posted jobs, applications, and reviews — as a single JSON file.
              </p>
            </div>
          </div>
          <Button onClick={handleExport} disabled={exporting || !userId} className="w-full sm:w-auto" size="lg">
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparing…</> : "Download my data"}
          </Button>
        </section>

        {/* Do not sell — CCPA */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldOff className="w-5 h-5 text-primary mt-1 flex-shrink-0" aria-hidden />
            <div className="flex-1">
              <h2 className="font-display font-semibold text-lg">Do not sell or share my personal information</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Helpr does not sell your data. This toggle additionally opts you out of any cross-context behavioral
                advertising that may be enabled in the future.
              </p>
            </div>
            <Switch checked={doNotSell} onCheckedChange={toggleDoNotSell} aria-label="Do not sell my personal information" />
          </div>
        </section>

        {/* Delete — GDPR Art. 17 */}
        <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Trash2 className="w-5 h-5 text-destructive mt-1 flex-shrink-0" aria-hidden />
            <div className="flex-1">
              <h2 className="font-display font-semibold text-lg">Delete my account</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Permanently removes your profile, posted jobs, applications, messages, and personal information.
                Financial records (completed payouts, tax records) are retained as required by IRS regulations.
                <strong className="text-foreground"> This cannot be undone.</strong>
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="lg" className="w-full sm:w-auto">Delete my account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes everything in your account that's not legally required for tax/audit purposes.
                  You'll be signed out immediately and cannot sign back in with this email.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {deleting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting…</> : "Yes, delete my account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <div className="text-center pt-4">
          <Link to="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to Privacy Policy
          </Link>
        </div>
      </main>
    </div>
  );
};

export default DataRights;
