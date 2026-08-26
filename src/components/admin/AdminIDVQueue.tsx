import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, Eye, Loader2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { report } from "@/lib/errorLogger";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard, AdminFilterStrip } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";

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
      toast.error("Couldn't load IDV settings — refresh to retry.");
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
      toast.error("Threshold must be 0–100.");
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
      await logAdminAction("update_idv_settings", "platform_settings", settingsId, {
        hybrid_idv_enabled: hybridEnabled,
        idv_auto_approve_threshold: t,
      });
    }
  };

  /**
   * Bulk selection, keyed by user_id. Named `checkedIds` because `selected`
   * already means "the one row whose detail drawer is open" in this file.
   *
   * Approve only, deliberately — same rule as the credential queue. A denial
   * carries a reason the applicant reads and acts on, and one reason pasted
   * across a batch is either wrong for most of them or so generic it tells
   * them nothing. Denying stays per-row, where the reason box is.
   */
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  /** Only rows an admin may actually act on can be ticked. */
  const isActionable = (p: IDVProfile) =>
    p.idv_status === "manual_review" || p.idv_status === "failed";

  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Sequential, not Promise.all: each approval writes a profile row, inserts a
   * notification and invokes an email function. Firing twenty of those at once
   * is how you discover a rate limit mid-incident, and a queue this size is
   * not worth the risk.
   */
  const approveChecked = async () => {
    if (checkedIds.size === 0) return;
    setBulkRunning(true);
    const targets = profiles.filter((p) => checkedIds.has(p.user_id) && isActionable(p));
    let ok = 0;
    const failures: string[] = [];
    for (const p of targets) {
      try {
        await approveUser(p, { silent: true });
        ok++;
      } catch (e) {
        report(e, { tags: { source: "AdminIDVQueue.approveChecked" } });
        failures.push(formatName(p.full_name, "an applicant"));
      }
    }
    setBulkRunning(false);
    setCheckedIds(new Set());
    load();
    // Report the partial outcome honestly — a blanket "Approved" after two of
    // five succeeded is how a queue silently keeps stale rows.
    if (failures.length === 0) toast.success(`Approved ${ok}`);
    else if (ok === 0) toast.error(`Could not approve ${failures.length}`);
    else toast.warning(`Approved ${ok}, ${failures.length} failed — ${failures.join(", ")}`);
  };

  const approveUser = async (p: IDVProfile, opts?: { silent?: boolean }) => {
    setActioning(p.user_id);
    // .select("user_id"): this is the write that clears someone to work. A
    // zero-row update returns error === null, and the queue used to go on to
    // notify and email "You're cleared" over an unchanged profile.
    try {
      unwrapMutation(
        await supabase
          .from("profiles")
          .update({
            idv_status: "verified",
            approval_status: "approved",
          })
          .eq("user_id", p.user_id)
          .select("user_id"),
        {
          action: "approve this verification",
          rejectedMessage: "This verification wasn't approved — the profile is unchanged. Check your admin permissions and try again.",
          context: { targetUserId: p.user_id },
        },
      );
    } catch (err) {
      setActioning(null);
      // Throw in bulk so the caller can count it as a failure; toast when the
      // admin clicked this one row directly.
      if (opts?.silent) throw err;
      toast.error(mutationErrorMessage(err, "Couldn't approve that verification — try again."));
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
    await logAdminAction("idv_manual_approve", "user", p.user_id, { previous_status: p.idv_status });
    if (opts?.silent) return;
    setSelected(null);
    load();
  };

  const denyUser = async (p: IDVProfile) => {
    setActioning(p.user_id);
    let denied = true;
    try {
      unwrapMutation(
        await supabase
          .from("profiles")
          .update({
            idv_status: "failed",
            approval_status: "denied",
            denial_reason: "Identity verification could not be confirmed.",
          })
          .eq("user_id", p.user_id)
          .select("user_id"),
        {
          action: "deny this verification",
          rejectedMessage: "This verification wasn't denied — the profile is unchanged. Check your admin permissions and try again.",
          context: { targetUserId: p.user_id },
        },
      );
    } catch (err) {
      denied = false;
      toast.error(mutationErrorMessage(err, "Couldn't deny that verification — try again."));
    }
    setActioning(null);
    if (denied) {
      await logAdminAction("idv_manual_deny", "user", p.user_id, { previous_status: p.idv_status });
      setSelected(null);
      load();
    }
  };

  return (
    <AdminViewShell>
      {/* Settings card. The stranded lead sentence above it is now this
          card's subtitle — it describes the auto-approve behaviour these two
          controls configure, so it belongs to them rather than to the bare
          page background. */}
      <AdminCard
        title="Auto-Approve Settings"
        subtitle="Hybrid IDV: Stripe auto-approves clear submissions; uncertain ones land in the queue below."
        className="max-w-2xl"
        contentClassName="space-y-4"
      >
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
          {savingSettings ? "Saving…" : "Save Settings"}
        </Button>
      </AdminCard>

      {/* The queue. Refresh used to sit `ml-auto` at the end of the tab row,
          so at 375 the four status chips wrapped to two lines and pushed a
          lone Refresh onto a third with a dead band beside it. It refreshes
          THIS list, so it is the card's header action; the chips become one
          scrollable strip. */}
      <AdminCard
        title="Verification Queue"
        action={
          <Button variant="outline" size="sm" onClick={load} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
        contentClassName="space-y-4"
      >
      <AdminFilterStrip label="Filter submissions by status">
        {STATUS_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={activeTab === tab.key}
              className={`shrink-0 px-3 py-1.5 rounded-ds-sm text-ds-13 font-medium border transition-colors flex items-center gap-1.5 ${
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
      </AdminFilterStrip>

      {/* Appears only once something is ticked, so the default queue reads
          exactly as it did before bulk existed. */}
      {checkedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-ds-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-ds-13 font-medium text-foreground">
            {checkedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={bulkRunning} onClick={() => setCheckedIds(new Set())}>
              Clear
            </Button>
            <Button size="sm" variant="primary" disabled={bulkRunning} onClick={approveChecked}>
              {bulkRunning ? "Approving…" : `Approve ${checkedIds.size}`}
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {isInitialLoading ? (
        <div className="flex items-center justify-center py-12">
          <HelprSpinner size={24} />
        </div>
      ) : profiles.length === 0 ? (
        /* EmptyState is itself a card. Wrapping it in a second liquid-glass
           card drew a white tile inside a white tile — visible in the 375
           capture as a nested double border. */
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={ShieldCheck}
          title="Nothing in this status"
          body="Try another status tab above."
        />
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => {
            const tab = STATUS_TABS.find((t) =>
              t.key === p.idv_status || (t.key === "pending" && (p.idv_status === "pending" || p.idv_status === "processing"))
            );
            return (
              <div key={p.user_id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 flex items-center justify-between gap-3">
                {isActionable(p) && (
                  <input
                    type="checkbox"
                    className="shrink-0 h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={checkedIds.has(p.user_id)}
                    onChange={() => toggleChecked(p.user_id)}
                    disabled={bulkRunning}
                    aria-label={`Select ${formatName(p.full_name, "this applicant")} for bulk approval`}
                  />
                )}
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
      </AdminCard>

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
        title={confirmAction?.action === "approve" ? "Approve This Verification?" : "Deny This Verification?"}
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
    </AdminViewShell>
  );
};

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex justify-between gap-4 border-b border-border pb-1.5">
    <span className="text-muted-foreground text-ds-11 uppercase tracking-wide">{label}</span>
    <span className={`text-foreground text-right break-all ${mono ? "font-mono text-ds-11" : ""}`}>{value}</span>
  </div>
);

export default AdminIDVQueue;
