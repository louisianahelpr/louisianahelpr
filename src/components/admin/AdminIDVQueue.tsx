import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldAlert, RefreshCw, Loader2, CheckCircle2, XCircle, Eye } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { report } from "@/lib/errorLogger";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";

interface IDVProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  idv_status: string | null;
  idv_confidence: number | null;
  idv_failure_reason: string | null;
  idv_session_id: string | null;
  idv_attempted_at: string | null;
  approval_status: string;
  legacy_manual_review: boolean;
  created_at: string;
}

const STATUS_TABS = [
  { key: "manual_review", label: "Manual Review", icon: ShieldAlert, color: "bg-destructive/10 text-destructive" },
  { key: "failed", label: "Failed", icon: XCircle, color: cn("bg-warning/10", toneTextClasses.warning) },
  { key: "pending", label: "Pending/Processing", icon: Loader2, color: cn("bg-info/10", toneTextClasses.info) },
  { key: "verified", label: "Verified", icon: CheckCircle2, color: cn("bg-success/10", toneTextClasses.success) },
];

const AdminIDVQueue = () => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("manual_review");
  const [actioning, setActioning] = useState<string | null>(null);
  const [selected, setSelected] = useState<IDVProfile | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ profile: IDVProfile; action: "approve" | "deny" } | null>(null);

  // Settings
  const [hybridEnabled, setHybridEnabled] = useState(false);
  const [threshold, setThreshold] = useState("85");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const queryKey = ["admin-idv-queue", activeTab];
  const { data: profiles, isInitialLoading, isFetching } = useInstantQuery<IDVProfile[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      const statusFilters = activeTab === "pending"
        ? ["pending", "processing"]
        : [activeTab];

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, idv_status, idv_confidence, idv_failure_reason, idv_session_id, idv_attempted_at, approval_status, legacy_manual_review, created_at")
        .in("idv_status", statusFilters)
        .order("idv_attempted_at", { ascending: false, nullsFirst: false })
        .limit(100);

      if (error) {
        toast.error(error.message);
        return [];
      }
      return (data as IDVProfile[]) || [];
    },
  });

  const load = () => qc.invalidateQueries({ queryKey });

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("id, hybrid_idv_enabled, idv_auto_approve_threshold")
      .maybeSingle();
    if (error) {
      console.error("[AdminIDVQueue] loadSettings:", error);
      toast.error("Couldn't load IDV settings — refresh to retry");
      return;
    }
    if (data) {
      setSettingsId(data.id);
      setHybridEnabled(!!data.hybrid_idv_enabled);
      setThreshold(String(data.idv_auto_approve_threshold ?? 85));
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const saveSettings = async () => {
    if (!settingsId) return;
    const t = parseFloat(threshold);
    if (isNaN(t) || t < 0 || t > 100) {
      toast.error("Threshold must be 0–100");
      return;
    }
    setSavingSettings(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({
        hybrid_idv_enabled: hybridEnabled,
        idv_auto_approve_threshold: t,
      })
      .eq("id", settingsId);
    setSavingSettings(false);
    if (error) toast.error(error.message);
    else {
      toast.success("IDV settings updated");
      await logAdminAction("update_idv_settings", "platform_settings", settingsId, {
        hybrid_idv_enabled: hybridEnabled,
        idv_auto_approve_threshold: t,
      });
    }
  };

  const approveUser = async (p: IDVProfile) => {
    setActioning(p.user_id);
    const { error } = await supabase
      .from("profiles")
      .update({
        idv_status: "verified",
        approval_status: "approved",
      })
      .eq("user_id", p.user_id);

    if (error) {
      setActioning(null);
      toast.error(error.message);
      return;
    }

    // In-app notification (auto-fires browser push via useRealtimePush).
    // Best-effort: the approval already succeeded, so a failed notification
    // shouldn't block the flow — log it instead of swallowing silently.
    const { error: notifyErr } = await supabase.from("notifications").insert({
      user_id: p.user_id,
      title: "✅ Verification Successful",
      message: "An admin verified your identity. You're cleared to start using Helpr!",
      type: "success",
      link: "/dashboard",
    });
    if (notifyErr) report(notifyErr, { tags: { source: "AdminIDVQueue.approveNotify" } });

    // Branded "Verification Successful" email
    try {
      await supabase.functions.invoke("send-account-status-email", {
        body: { userId: p.user_id, status: "verified" },
      });
    } catch (e) {
      report(e, { tags: { source: "AdminIDVQueue.sendVerifiedEmail" } });
    }

    setActioning(null);
    toast.success(`${formatName(p.full_name)} approved`);
    await logAdminAction("idv_manual_approve", "user", p.user_id, { previous_status: p.idv_status });
    setSelected(null);
    load();
  };

  const denyUser = async (p: IDVProfile) => {
    setActioning(p.user_id);
    const { error } = await supabase
      .from("profiles")
      .update({
        idv_status: "failed",
        approval_status: "denied",
        denial_reason: "Identity verification could not be confirmed.",
      })
      .eq("user_id", p.user_id);
    setActioning(null);
    if (error) toast.error(error.message);
    else {
      toast.success(`${formatName(p.full_name)} denied`);
      await logAdminAction("idv_manual_deny", "user", p.user_id, { previous_status: p.idv_status });
      setSelected(null);
      load();
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-ds-11 text-muted-foreground">
        Hybrid IDV: Stripe auto-approves clear submissions; uncertain ones land here.
      </p>

      {/* Settings card */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-4 max-w-2xl">
        <h3 className="font-semibold text-foreground">Settings</h3>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="hybrid-toggle" className="text-ds-13 font-medium">Hybrid IDV enabled</Label>
            <p className="text-ds-11 text-muted-foreground">When off, all new signups go to the manual queue.</p>
          </div>
          <Switch
            id="hybrid-toggle"
            checked={hybridEnabled}
            onCheckedChange={setHybridEnabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="threshold" className="text-ds-13 font-medium">Auto-approve confidence threshold</Label>
          <p className="text-ds-11 text-muted-foreground">Submissions scoring at or above this value are auto-approved (0–100).</p>
          <Input
            id="threshold"
            type="number"
            min="0"
            max="100"
            step="1"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="max-w-[120px]"
          />
        </div>
        <Button onClick={saveSettings} disabled={savingSettings} size="sm">
          {savingSettings ? "Saving…" : "Save settings"}
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-ds-sm text-ds-13 font-medium border transition-colors flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
        <Button variant="ghost" size="sm" onClick={load} disabled={isFetching} className="ml-auto">
          <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* List */}
      {isInitialLoading ? (
        <div className="flex items-center justify-center py-12">
          <HelprSpinner size={24} />
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-ds-md liquid-glass p-8 text-center">
          <p className="text-ds-11 text-muted-foreground">No users in this status.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => {
            const tab = STATUS_TABS.find((t) =>
              t.key === p.idv_status || (t.key === "pending" && (p.idv_status === "pending" || p.idv_status === "processing"))
            );
            return (
              <div key={p.user_id} className="rounded-ds-md liquid-glass p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground text-ds-13 truncate">{formatName(p.full_name, "—")}</p>
                    {tab && (
                      <Badge className={`text-ds-11 ${tab.color}`}>{tab.label}</Badge>
                    )}
                    {p.idv_confidence !== null && (
                      <Badge variant="sienna" className="text-ds-11">
                        {Math.round(p.idv_confidence)}% confidence
                      </Badge>
                    )}
                  </div>
                  <p className="text-ds-11 text-muted-foreground truncate">{p.email || "—"}</p>
                  {p.idv_failure_reason && (
                    <p className="text-ds-11 text-destructive mt-1">⚠️ {p.idv_failure_reason}</p>
                  )}
                  {p.idv_attempted_at && (
                    <p className="text-ds-10 text-muted-foreground mt-0.5">
                      Attempted {new Date(p.idv_attempted_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Icon-only, so it needs an explicit name — and a per-row one.
                      "View" repeated down the queue tells a screen-reader user
                      nothing about WHICH applicant they are about to open, on a
                      screen where the next click approves or denies an identity
                      check. Its siblings ("Approve"/"Deny") carry visible text. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(p)}
                    aria-label={`View verification details for ${formatName(p.full_name, "this applicant")}`}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  {(p.idv_status === "manual_review" || p.idv_status === "failed") && (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setConfirmAction({ profile: p, action: "approve" })}
                        disabled={actioning === p.user_id}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmAction({ profile: p, action: "deny" })}
                        disabled={actioning === p.user_id}
                      >
                        Deny
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHero
            eyebrow="Identity verification"
            title={formatName(selected?.full_name, "User")}
          />
          {selected && (
            <div className="space-y-3 text-ds-13">
              <Row label="Email" value={selected.email || "—"} />
              <Row label="IDV Status" value={selected.idv_status || "—"} />
              <Row label="Confidence" value={selected.idv_confidence !== null ? `${Math.round(selected.idv_confidence)}%` : "—"} />
              <Row label="Failure reason" value={selected.idv_failure_reason || "—"} />
              <Row label="Stripe session" value={selected.idv_session_id || "—"} mono />
              <Row label="Approval status" value={selected.approval_status} />
              <Row label="Attempted" value={selected.idv_attempted_at ? new Date(selected.idv_attempted_at).toLocaleString() : "—"} />
              <Row label="Legacy manual review" value={selected.legacy_manual_review ? "Yes" : "No"} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BrandConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction?.action === "approve" ? "Approve this verification?" : "Deny this verification?"}
        description={
          confirmAction?.action === "approve"
            ? `${formatName(confirmAction?.profile.full_name, "This user")} will be marked verified and cleared to use Helpr.`
            : `${formatName(confirmAction?.profile.full_name, "This user")} will be denied. They'll be notified their identity couldn't be confirmed.`
        }
        primaryLabel={confirmAction?.action === "approve" ? "Approve" : "Deny"}
        primaryTone={confirmAction?.action === "approve" ? "bark" : "sienna"}
        primaryHaptic={confirmAction?.action === "approve" ? "success" : "error"}
        primaryDisabled={!!actioning}
        onPrimary={(e) => {
          e.preventDefault();
          if (!confirmAction) return;
          const { profile, action } = confirmAction;
          setConfirmAction(null);
          if (action === "approve") approveUser(profile);
          else denyUser(profile);
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
};

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex justify-between gap-4 border-b border-border pb-1.5">
    <span className="text-muted-foreground text-ds-11 uppercase tracking-wide">{label}</span>
    <span className={`text-foreground text-right break-all ${mono ? "font-mono text-ds-11" : ""}`}>{value}</span>
  </div>
);

export default AdminIDVQueue;
