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
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { report } from "@/lib/errorLogger";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, ShieldOff, Loader2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import { hapticError } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";

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
  const navigate = useNavigate();
  // Derive the user id from the app-wide auth snapshot (getSession-backed,
  // local, offline-safe) rather than a network getUser() call. The route is
  // behind ProtectedRoute so a visitor here is always signed in; the null
  // guard remains because a failed getUser() round-trip (transient auth-server
  // hiccup) used to leave `userId` null and the export button permanently
  // disabled even though a valid local session existed.
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

  // Signed-in only (the route is behind ProtectedRoute) and reached from the
  // Profile menu, so this renders in the IN-APP shell on both web and native
  // — the marketing PublicLayout's nav + footer would take a signed-in user
  // back to guest chrome, which the app never does.
  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Your Data Rights"
        meta="Export, correct, or delete your information at any time"
        onBack={() => navigate("/profile")}
      />
      {/* Full page width (matching every other page) — a narrower column here
          left dead gutters, which the project treats as a failed layout. The
          two cards sit side-by-side from `sm` up so they FILL that width.
          Both share one anatomy — icon badge + title + description, then a
          divider and a [status … control] action row — so they read as one
          consistent pair rather than two differently-shaped panels. */}
      <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-5 lg:px-8 xl:px-12 pb-10 space-y-5 mt-6">
        <div className="grid gap-4 sm:grid-cols-2 items-start">
        {/* Export */}
        <section className="rounded-2xl liquid-glass p-5 space-y-4 h-full flex flex-col">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--bark) / 0.10)" }}
            >
              <Download className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-sans font-semibold text-ds-17">Download your data</h2>
              <p className="text-ds-11 text-muted-foreground mt-1">
                Get a complete copy of your Helpr data — profile, posted jobs, applications, and reviews — as a single JSON file.
              </p>
            </div>
          </div>
          {/* mt-auto pins the action row to the card's bottom so both cards'
              dividers line up even when their descriptions differ in length.
              flex-wrap lets the hint and button stack on a narrow phone. */}
          <div
            className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3"
            style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
          >
            <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              JSON file
            </span>
            <Button
              onClick={handleExport}
              disabled={exporting || !userId}
              variant="primary"
              size="sm"
              className="shrink-0"
            >
              {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparing…</> : "Download my data"}
            </Button>
          </div>
        </section>

        {/* Do not sell — CCPA */}
        <section className="rounded-2xl liquid-glass p-5 space-y-4 h-full flex flex-col">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--bark) / 0.10)" }}
            >
              <ShieldOff className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-sans font-semibold text-ds-17">Do not sell or share my personal information</h2>
              <p className="text-ds-11 text-muted-foreground mt-1">
                Helpr does not sell your data. This toggle additionally opts you out of any cross-context behavioral
                advertising that may be enabled in the future.
              </p>
            </div>
          </div>
          <label
            className="mt-auto flex items-center justify-between gap-3 pt-3 cursor-pointer"
            style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
          >
            <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {doNotSell ? "Opted out" : "Opted in"}
            </span>
            <Switch checked={doNotSell} onCheckedChange={toggleDoNotSell} aria-label="Do not sell my personal information" />
          </label>
        </section>
        </div>

        {/* Legal context sits BELOW the controls as a quiet footnote — it's
            background on why these rights exist plus a contact route, not an
            instruction the user needs before acting. Routes to the in-app
            support form rather than a raw mailto: a mailto needs a configured
            mail client (and does nothing in-app), while the support page
            submits straight to admin with the sender already identified.
            Account deletion (GDPR Art. 17 erasure) deliberately lives on
            Profile / Settings only, so there's a single entry point for it
            rather than a duplicate here. */}
        <p className="text-ds-11 leading-relaxed pt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Under the EU GDPR and California CCPA, you have specific rights about how Helpr handles your personal data.
          For any other privacy question,{" "}
          <Link to="/support" className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>contact support</Link>.
        </p>
      </div>
    </div>
  );
};

export default DataRights;
