/**
 * GDPR + CCPA data rights page.
 *
 * - Data export → triggers a JSON dump of profile + jobs + messages
 * - CCPA "do not sell or share" → opt-out toggle (we don't sell data, but
 *   the toggle still has to exist for CA residents)
 *
 * GDPR Art. 17 "right to erasure" is exercised from the Profile / Settings
 * screen's "Delete account" control (single entry point — no duplicate here).
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
import { Download, ShieldOff, Loader2, ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import { hapticError } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";
import PublicLayout from "@/components/marketing/PublicLayout";
import { isNativePlatform } from "@/lib/nativeInit";

const DataRights = () => {
  usePageMeta({
    title: "Your Data Rights — Helpr",
    description:
      "Exercise your GDPR and CCPA data rights with Helpr — export your data, opt out of data sharing, or permanently delete your account.",
    canonical: "https://www.louisianahelpr.com/data-rights",
    ogTitle: "Your Data Rights — Helpr",
    ogDescription:
      "Export, correct, or delete your personal information on Helpr at any time under the EU GDPR and California CCPA.",
  });
  // Derive the user id from the app-wide auth snapshot (getSession-backed,
  // local, offline-safe) rather than a network getUser() call. This route is
  // public (linked from the App Store privacy listing), so a logged-out
  // visitor correctly gets a null id and a disabled export. The bug this
  // avoids is for a logged-IN user: a failed getUser() round-trip (transient
  // auth-server hiccup) used to leave `userId` null and the export button
  // permanently disabled even though a valid local session existed.
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const [exporting, setExporting] = useState(false);
  const [doNotSell, setDoNotSell] = useState(false);

  useEffect(() => {
    const stored = safeStorage.getItem("helpr_do_not_sell");
    if (stored === "1") setDoNotSell(true);
  }, []);

  const handleExport = async () => {
    if (!userId) return;
    setExporting(true);
    try {
      const [profileRes, jobsRes, applicationsRes, reviewsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("jobs").select("*").or(`customer_id.eq.${userId},helper_id.eq.${userId}`),
        supabase.from("applications").select("*").eq("helper_id", userId),
        supabase.from("reviews").select("*").or(`reviewer_id.eq.${userId},reviewee_id.eq.${userId}`),
      ]);

      const firstError = profileRes.error || jobsRes.error || applicationsRes.error || reviewsRes.error;
      if (firstError) throw firstError;

      const { data: profile } = profileRes;
      const { data: jobs } = jobsRes;
      const { data: applications } = applicationsRes;
      const { data: reviews } = reviewsRes;

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
      hapticError();
      toast.error("We couldn't put your data together just now — try again or email support.");
    } finally {
      setExporting(false);
    }
  };

  const toggleDoNotSell = (next: boolean) => {
    setDoNotSell(next);
    safeStorage.setItem("helpr_do_not_sell", next ? "1" : "0");
    toast.success(next ? "Opted out of data sharing" : "Opted in to data sharing");
  };

  // PageHeader renders an in-app top bar with brand + back + right slot; on
  // web that stacks BELOW PublicLayout's marketing nav (double chrome), so
  // it's native-only. On web the marketing PublicLayout already carries the
  // top nav and footer, and the hero title is rendered inline below.
  const header = isNativePlatform ? (
    <PageHeader
      eyebrow="Privacy controls"
      title="Your Data Rights"
      meta="Export, correct, or delete your information at any time"
      showBrand
      rightSlot={<NotificationPanel />}
    />
  ) : (
    <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-5 lg:px-8 xl:px-12 pt-8">
      <h1 className="text-page-title leading-tight">Your Data Rights</h1>
      <p className="font-serif italic mt-1 text-[0.82rem]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Export, correct, or delete your information at any time
      </p>
    </div>
  );

  const inner = (
    <>
      {header}
      <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-5 lg:px-8 xl:px-12 pb-10 space-y-5 mt-2">
        <p className="text-ds-11 text-muted-foreground max-w-2xl">
          Under the EU GDPR and California CCPA, you have specific rights about how Helpr handles your personal data.
          Use the controls below to exercise them. For all other privacy questions email{" "}
          <a href="mailto:admin@louisianahelpr.com" className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>admin@louisianahelpr.com</a>.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
        {/* Export */}
        <section className="rounded-2xl liquid-glass p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Download className="w-5 h-5 text-primary mt-1 flex-shrink-0" aria-hidden />
            <div className="flex-1">
              <h2 className="font-display italic font-semibold text-ds-17">Download your data</h2>
              <p className="text-ds-11 text-muted-foreground mt-1">
                Get a complete copy of your Helpr data — profile, posted jobs, applications, and reviews — as a single JSON file.
              </p>
            </div>
          </div>
          <Button
            onClick={handleExport}
            disabled={exporting || !userId}
            variant="bark"
            className="w-full sm:w-auto"
            size="lg"
          >
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparing…</> : "Download my data"}
          </Button>
        </section>

        {/* Do not sell — CCPA */}
        <section className="rounded-2xl liquid-glass p-5 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldOff className="w-5 h-5 text-primary mt-1 flex-shrink-0" aria-hidden />
            <div className="flex-1">
              <h2 className="font-display italic font-semibold text-ds-17">Do not sell or share my personal information</h2>
              <p className="text-ds-11 text-muted-foreground mt-1">
                Helpr does not sell your data. This toggle additionally opts you out of any cross-context behavioral
                advertising that may be enabled in the future.
              </p>
            </div>
            <Switch checked={doNotSell} onCheckedChange={toggleDoNotSell} aria-label="Do not sell my personal information" />
          </div>
        </section>
        </div>

        {/* Account deletion (GDPR Art. 17 erasure) lives on the Profile /
            Settings screen — keeping a single entry point avoids a confusing
            duplicate control here. */}

        <div className="text-center pt-4">
          <Link to="/privacy" className="text-ds-11 text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to Privacy Policy
          </Link>
        </div>
      </div>
    </>
  );

  if (isNativePlatform) {
    return <div className="min-h-screen bg-premium-page pb-safe-nav">{inner}</div>;
  }
  return <PublicLayout showCtaBand={false}>{inner}</PublicLayout>;
};

export default DataRights;
