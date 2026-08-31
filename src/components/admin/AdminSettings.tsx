import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { toast } from "sonner";
import { Flag, Percent, Plus, Search, Shield, ShieldCheck, Smartphone, Trash2, UserPlus } from "lucide-react";
import { TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";
import { AdminViewShell, AdminCard } from "./AdminViewShell";
import type { Database } from "@/integrations/supabase/types";
import { logAdminAction } from "@/lib/adminAudit";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireBiometric } from "@/lib/biometricGate";

// The fee-ladder rungs an admin is shown, DERIVED from the tier config rather
// than restated. `TIER_PERKS` is the same table `tierFeePercent()` resolves a
// live payout against and the same one /subscription advertises, so the console
// can no longer quote a ladder the platform does not charge — which is exactly
// what the deleted editable inputs did (see the read-only card below).
const FEE_LADDER: { id: SubscriptionTier; name: string; percent: number }[] = (
  ["free", "basic", "pro", "elite"] as SubscriptionTier[]
).map((id) => ({ id, name: TIER_PERKS[id].name, percent: TIER_PERKS[id].platformFeePercent }));

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Operator kill-switches. Keeping this as a constants list (vs rendering
// every key found in the JSONB blob) means the UI surface is deterministic —
// a stray key written by some other tool can't show up here as a mystery
// toggle. A flag belongs here ONLY once something reads it; see
// src/lib/featureFlags.ts.
//
// This list was five toggles until 2026-08-25, and none of the five were read
// by anything: subscriptions/referrals/AI/boosts/IDV all wrote to
// `feature_flags` and no screen or edge function ever looked. Four were
// deleted rather than wired, because they gate features the app owns end to
// end and which already fail gracefully on their own — a switch whose only
// effect is to hide a working feature is a way to cause an outage, not
// prevent one.
//
// The survivor is the one guarding an EXTERNAL dependency. If Stripe Identity
// goes down, every Helpr is blocked from posting and accepting at the same
// moment, and a native app cannot be hot-fixed inside App Review — so the
// ability to lift that gate for an afternoon is worth a switch. It is phrased
// as "paused" rather than "required" so that absent/unreadable means ENFORCED;
// the reasoning is in featureFlags.ts.
const KNOWN_FEATURE_FLAGS: { id: string; label: string; description: string; danger?: boolean }[] = [
  {
    id: "idv_requirement_paused",
    label: "Pause identity verification",
    description:
      "Emergency use only. While ON, Helprs can post and accept jobs WITHOUT passing Stripe Identity. Turn this on only during a Stripe Identity outage, and turn it off the moment it clears.",
    danger: true,
  },
];

const AdminSettings = () => {
  // Read-only now — displayed as the payout functions' fail-safe fallback, not
  // as an editable rate. See the Fee Model card below for why.
  const [customerFee, setCustomerFee] = useState("");
  const [helperFee, setHelperFee] = useState("");
  const [socialWebhookUrl, setSocialWebhookUrl] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Min-build setter + flag toggles. featureFlags is a free-form map
  // but we only surface KNOWN_FEATURE_FLAGS entries above.
  const [minBuild, setMinBuild] = useState<string>("0");
  const [savingMinBuild, setSavingMinBuild] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [savingFlag, setSavingFlag] = useState<string | null>(null);

  // Admin management
  const [admins, setAdmins] = useState<{ user_id: string; role_id: string; name: string; email: string }[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ user_id: string; role_id: string; name: string } | null>(null);

  useEffect(() => {
    loadSettings();
    loadAdmins();
  }, []);

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[AdminSettings] loadSettings:", error);
      toast.error("Couldn't load platform settings — refresh to retry.");
    } else if (data) {
      const row = data as typeof data & { min_supported_build?: number | null; feature_flags?: Record<string, boolean> | null };
      setCustomerFee(String(data.customer_fee_percent ?? 10));
      setHelperFee(String(data.helper_fee_percent ?? 10));
      setSocialWebhookUrl(String(data.social_webhook_url ?? ""));
      setSettingsId(data.id);
      // Defensive defaults — columns are nullable + migration may not
      // be deployed yet, so always normalise to safe values.
      setMinBuild(String(row.min_supported_build ?? 0));
      // `feature_flags` is a Postgres jsonb column typed as `Json` in the
      // generated types (which includes primitives). We know rows only ever
      // hold {[flag]: boolean} shape — narrow before spreading.
      const flags = row.feature_flags;
      const flagsObj = flags && typeof flags === "object" && !Array.isArray(flags)
        ? (flags as Record<string, boolean>)
        : ({} as Record<string, boolean>);
      setFeatureFlags({ ...flagsObj });
    }
    setLoading(false);
  };

  const saveMinBuild = async () => {
    if (!settingsId) return;
    const n = parseInt(minBuild, 10);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Min build must be a non-negative integer.");
      return;
    }
    if (n > 999_999) {
      toast.error("Min build must be no greater than 999,999.");
      return;
    }
    setSavingMinBuild(true);
    try {
      unwrapMutation(
        await (supabase.from as any)("platform_settings")
          .update({ min_supported_build: n })
          .eq("id", settingsId)
          .select("id"),
        { action: "update the minimum supported build" },
      );
    } catch (err: any) {
      setSavingMinBuild(false);
      if (err?.code === "42703") {
        toast.error("This setting isn't live yet — the latest database update is still deploying. Try again in a few minutes.");
      } else {
        toast.error(mutationErrorMessage(err, err?.message));
      }
      return;
    }
    setSavingMinBuild(false);
    await logAdminAction("update_settings", "platform_settings", settingsId, {
      min_supported_build: n,
    });
  };

  const toggleFlag = async (id: string, value: boolean) => {
    if (!settingsId) return;
    setSavingFlag(id);
    const nextFlags = { ...featureFlags, [id]: value };
    // Optimistic — flip immediately so the UI feels responsive.
    setFeatureFlags(nextFlags);
    try {
      unwrapMutation(
        await (supabase.from as any)("platform_settings")
          .update({ feature_flags: nextFlags })
          .eq("id", settingsId)
          .select("id"),
        { action: "update this feature flag" },
      );
    } catch (err: any) {
      setSavingFlag(null);
      // Roll back optimistic change on failure.
      setFeatureFlags(featureFlags);
      if (err?.code === "42703") {
        toast.error("This setting isn't live yet — the latest database update is still deploying. Try again in a few minutes.");
      } else {
        toast.error(mutationErrorMessage(err, err?.message));
      }
      return;
    }
    setSavingFlag(null);
    await logAdminAction("update_settings", "platform_settings", settingsId, {
      feature_flag: id,
      value,
    });
  };

  const handleSaveWebhook = async () => {
    if (!settingsId) return;
    const url = socialWebhookUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error("Webhook URL must start with http:// or https://");
      return;
    }
    setSavingWebhook(true);
    try {
      unwrapMutation(
        await supabase
          .from("platform_settings")
          .update({ social_webhook_url: url || null })
          .eq("id", settingsId)
          .select("id"),
        { action: "update the social webhook URL" },
      );
    } catch (err: any) {
      setSavingWebhook(false);
      toast.error(mutationErrorMessage(err, err?.message));
      return;
    }
    setSavingWebhook(false);
    await logAdminAction("update_settings", "platform_settings", settingsId, { social_webhook_url: url ? "set" : "cleared" });
  };

  const loadAdmins = async () => {
    setAdminsLoading(true);
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("id, user_id, role")
      .eq("role", "admin");

    if (rolesError) {
      console.error("[AdminSettings] loadAdmins roles:", rolesError);
      toast.error("Couldn't load admin list — refresh to retry.");
      setAdminsLoading(false);
      return;
    }

    if (roles && roles.length > 0) {
      const userIds = roles.map((r) => r.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      if (profilesError) {
        console.error("[AdminSettings] loadAdmins profiles:", profilesError);
      }

      const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);
      setAdmins(
        roles.map((r) => ({
          user_id: r.user_id,
          role_id: r.id,
          name: formatName(profileMap.get(r.user_id)?.full_name, "—"),
          email: profileMap.get(r.user_id)?.email || "—",
        }))
      );
    } else {
      setAdmins([]);
    }
    setAdminsLoading(false);
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const q = searchQuery.trim().toLowerCase();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);

    if (error) {
      console.error("[AdminSettings] searchUsers:", error);
      toast.error("Search failed: " + error.message);
      setSearching(false);
      return;
    }

    // Filter out users who are already admins
    const adminIds = new Set(admins.map((a) => a.user_id));
    setSearchResults((data || []).filter((p) => !adminIds.has(p.user_id)));
    setSearching(false);
  };

  const addAdmin = async (profile: Profile) => {
    // Face ID / Touch ID gate: granting admin is the privilege-escalation
    // primitive that makes every other gate on this page moot — an attacker
    // on a merely-unlocked admin phone would grant themselves a durable role
    // that survives the phone being recovered. No-op on web and on devices
    // without enrolled biometrics (see requireBiometric).
    const ok = await requireBiometric("Confirm granting admin access");
    if (!ok) return;
    setAdding(profile.user_id);
    // The user_roles trigger only admits service_role writes, so the old
    // direct insert here failed on EVERY tap ("Admin roles can only be
    // granted via service_role"). The grant goes through the admin edge
    // function, which verifies the caller and writes the audit log itself —
    // no client-side logAdminAction, or the action would be logged twice.
    const { error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "grant_admin", userId: profile.user_id },
    });

    if (error) {
      const detail = await (error as { context?: Response }).context
        ?.clone()
        .json()
        .then((j: { error?: string }) => j?.error)
        .catch(() => undefined);
      toast.error(detail || "Couldn't add the admin — try again.");
    } else {
      await loadAdmins();
      setSearchResults((prev) => prev.filter((p) => p.user_id !== profile.user_id));
    }
    setAdding(null);
  };

  const removeAdmin = async (admin: { user_id: string; role_id: string; name: string }) => {
    // Get current user to prevent self-removal
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id === admin.user_id) {
      toast.error("You can't remove yourself as admin.");
      return;
    }

    // Face ID / Touch ID gate: stripping admin is the lock-everyone-out half
    // of the same privilege primitive as addAdmin. Runs after the
    // self-removal guard so a blocked action never raises an OS prompt.
    const ok = await requireBiometric("Confirm removing this admin");
    if (!ok) {
      setConfirmRemove(null);
      return;
    }

    setRemoving(admin.role_id);
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", admin.role_id);

    if (error) toast.error(error.message);
    else {
      await logAdminAction("remove_admin", "user", admin.user_id, { name: admin.name });
      await loadAdmins();
    }
    setRemoving(null);
    setConfirmRemove(null);
  };

  if (loading) return <p className="text-muted-foreground">Loading settings…</p>;

  return (
    <AdminViewShell>
      {/* ── Fee model — READ ONLY ──
          This was two number inputs and a "Total platform take: 20%" calculator
          with a Save button, and every part of it was wrong. The platform has
          not charged one flat rate since the tier ladder shipped: a poster pays
          their own tier's service fee and a Helpr pays their own tier's
          commission, resolved per job by `tierFeePercent()` from the same
          TIER_PERKS table read below. So the console let an admin type a number
          that would never be charged, then added two unrelated percentages
          together and called the sum the platform's take — arithmetic that has
          never described a single real job. Owner: "the 10% payout fee … also
          not correct."

          The platform_settings COLUMNS stay exactly where they are. The payout
          edge functions read customer_fee_percent / helper_fee_percent as a
          fail-safe when a tier cannot be resolved, and release-payout 500s
          without them — so the row is load-bearing infrastructure even though
          it is not a control. It is shown here as what it is: a fallback, with
          its live values, and no way to edit it by accident. */}
      <AdminCard
        className="max-w-md"
        title={<span className="flex items-center gap-2"><Percent className="w-4 h-4 text-primary" /> Fee Model</span>}
        subtitle="Set by subscription tier, not by this screen."
        contentClassName="space-y-4"
      >
        {/* The ladder speaks for itself — the paragraph that used to sit above
            it ("each job resolves its own rates from the tier ladder…") said
            what the card's own subtitle already says. */}
        <ul className="rounded-ds-sm bg-primary/5 p-3 space-y-1">
          {FEE_LADDER.map((t) => (
            <li key={t.id} className="flex items-center justify-between text-ds-11">
              <span className="text-muted-foreground">{t.name}</span>
              <span className="font-semibold text-foreground tabular-nums">{t.percent}%</span>
            </li>
          ))}
        </ul>

        {/* Absorbed from the separate "How the split fee model works" card that
            used to sit at the bottom of this screen. Two cards explaining one
            fee model, a page apart, is the duplication itself — not just the
            prose inside them. */}
        <ul className="text-ds-11 text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Poster pays: job budget + their tier service fee + sales tax, floored at Stripe's cost</li>
          <li>Helpr receives: job budget − their tier commission + urgent bonus</li>
          <li>Platform keeps both — each at that party's own tier rate, so the take differs job to job</li>
        </ul>

        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <p className="text-ds-11 font-semibold text-foreground">Fallback rates</p>
          <p className="text-ds-11 text-muted-foreground">
            Used only when a tier can't be read at payout time. Stored in{" "}
            <code className="text-foreground">platform_settings</code>, where the payout edge functions read them.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-ds-11">
            <span className="text-muted-foreground">
              Poster service fee <span className="font-semibold text-foreground tabular-nums">{customerFee || "—"}%</span>
            </span>
            <span className="text-muted-foreground">
              Helpr commission <span className="font-semibold text-foreground tabular-nums">{helperFee || "—"}%</span>
            </span>
          </div>
        </div>
      </AdminCard>

      {/* Social Webhook URL */}
      <AdminCard
        className="max-w-md"
        title="Social Webhook URL"
        subtitle={`Where the Facebook Post Generator's "Send to Social" posts go for scheduling.`}
        contentClassName="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="socialWebhook">Make.com webhook URL</Label>
          <Input
            id="socialWebhook"
            type="url"
            value={socialWebhookUrl}
            onChange={(e) => setSocialWebhookUrl(e.target.value)}
            autoComplete="off"
          />
          <p className="text-ds-11 text-muted-foreground">
            Payload sent: <code className="text-foreground">{`{ post_text, image_url, timing_priority }`}</code>
          </p>
        </div>
        <Button onClick={handleSaveWebhook} disabled={savingWebhook}>
          {savingWebhook ? "Saving…" : "Save Webhook URL"}
        </Button>
      </AdminCard>

      {/* Feature Flags */}
      <AdminCard
        className="max-w-lg"
        title={<span className="flex items-center gap-2"><Flag className="w-4 h-4 text-primary" /> Feature Flags</span>}
        subtitle="Emergency controls. Off is the normal state — leave them off unless you are working an incident."
      >
        {/* Live-state banner, shown only while the requirement is actually
            paused. The card carried a permanent "these are not wired up"
            warning between 2026-08-25 and this change, which was true then:
            five toggles wrote to feature_flags and nothing read any of them.
            Four were deleted and the fifth is now read on every post and every
            accept, so a standing warning would be the new lie. It fires on
            state instead — silent when safe, loud when a gate is down. */}
        {!!featureFlags["idv_requirement_paused"] && (
          <div className="rounded-ds-md border-2 border-destructive/40 bg-destructive/10 p-4 mb-3">
            <div className="flex items-start gap-3">
              <Flag className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-ds-13 font-bold text-foreground">
                  ⚠️ Identity verification is currently PAUSED
                </p>
                <p className="text-ds-11 text-muted-foreground leading-relaxed">
                  Helprs can post and accept jobs without passing Stripe
                  Identity right now. This is an outage measure — turn it back
                  off as soon as Stripe Identity recovers.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="space-y-2.5">
          {KNOWN_FEATURE_FLAGS.map((flag) => {
            const value = !!featureFlags[flag.id];
            return (
              <div key={flag.id} className="flex items-start justify-between gap-3 rounded-ds-sm border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="text-ds-13 font-semibold text-foreground">{flag.label}</p>
                  <p className="text-ds-11 text-muted-foreground leading-tight">{flag.description}</p>
                  {/* No opacity here. --stormy-sky was set to 36% specifically to
                      clear AA for small muted text (see the token comment in
                      index.css); opacity-70 composited it against the card to
                      #859095 = 3.27:1 at 10px, quietly undoing that tuning. The
                      id stays de-emphasised by size + font-mono instead, which
                      costs no contrast. */}
                  <p className="text-ds-10 text-muted-foreground mt-0.5 font-mono">{flag.id}</p>
                </div>
                <Switch
                  checked={value}
                  onCheckedChange={(next) => toggleFlag(flag.id, next)}
                  disabled={savingFlag === flag.id}
                  aria-label={`${flag.label} feature flag`}
                />
              </div>
            );
          })}
        </div>
      </AdminCard>

      {/* Min Supported Build */}
      <AdminCard
        className="max-w-md"
        title={<span className="flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary" /> Minimum Supported Build</span>}
        subtitle={
          <>
            Binaries below this build code are forced to update on next launch; <code className="text-foreground">0</code>{" "}
            disables the check.
          </>
        }
      >
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="minBuild">Build code</Label>
            <Input
              id="minBuild"
              type="number"
              min={0}
              max={999_999}
              step={1}
              value={minBuild}
              onChange={(e) => setMinBuild(e.target.value)}
              className="max-w-[160px] font-mono tabular-nums"
            />
          </div>
          <Button onClick={saveMinBuild} disabled={savingMinBuild}>
            {savingMinBuild ? "Saving…" : "Save"}
          </Button>
        </div>
      </AdminCard>

      {/* Admin Management */}
      <AdminCard
        className="max-w-lg"
        title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Admin Users</span>}
        subtitle={adminsLoading ? undefined : `${admins.length} ${admins.length === 1 ? "account holds" : "accounts hold"} the admin role`}
        action={
          <Button size="sm" onClick={() => { setShowAddDialog(true); setSearchQuery(""); setSearchResults([]); }}>
            <UserPlus className="w-4 h-4 mr-1" /> Add Admin
          </Button>
        }
      >
        {adminsLoading ? (
          <p className="text-ds-11 text-muted-foreground">Loading admins…</p>
        ) : admins.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={Shield}
            title="No admins found"
            body="No accounts currently hold the admin role."
          />
        ) : (
          <div className="space-y-2">
            {admins.map((admin) => (
              <div key={admin.role_id} className="rounded-ds-md liquid-glass p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-ds-13">{admin.name}</p>
                    <Badge className="bg-primary/10 text-primary text-ds-11">Admin</Badge>
                  </div>
                  <p className="text-ds-11 text-muted-foreground mt-0.5">{admin.email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 shrink-0"
                  disabled={removing === admin.role_id}
                  onClick={() => setConfirmRemove(admin)}
                  aria-label="Remove admin"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* The "How the split fee model works" card that used to live here is
          gone — its three bullets moved into the Fee Model card at the top of
          this screen, beside the ladder they describe. Its "Total platform
          take: 20%" row is gone for good: there is no single such number, since
          a job's take is the poster's tier rate plus the Helpr's, independently
          resolved. */}

      {/* Add Admin Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHero title="Add Admin User" />
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="search"
                aria-label="Search users by name or email"
                placeholder="Search by name or email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchUsers()}
              />
              <Button
                onClick={searchUsers}
                disabled={searching}
                size="icon"
                className="shrink-0"
                aria-label="Search users"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {searching && <p className="text-ds-11 text-muted-foreground">Searching…</p>}

            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {searchResults.map((profile) => (
                  <div key={profile.id} className="rounded-ds-sm border border-border bg-secondary/20 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground text-ds-13">{formatName(profile.full_name, "—")}</p>
                      <p className="text-ds-11 text-muted-foreground">{profile.email || "—"}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={adding === profile.user_id}
                      onClick={() => addAdmin(profile)}
                    >
                      {adding === profile.user_id ? "Adding…" : <><Plus className="w-3 h-3 mr-1" /> Add</>}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {!searching && searchResults.length === 0 && searchQuery.trim() && (
              <p className="text-ds-11 text-muted-foreground text-center py-4">No users found. Try a different search.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BrandConfirmDialog
        open={!!confirmRemove}
        onOpenChange={(open) => { if (!open) setConfirmRemove(null); }}
        title="Remove This Admin?"
        description={`This revokes admin access for ${confirmRemove?.name || "this user"}. They'll lose access to the admin dashboard immediately.`}
        primaryLabel={confirmRemove && removing === confirmRemove.role_id ? "Removing…" : "Remove Admin"}
        primaryTone="sienna"
        primaryHaptic="error"
        primaryDisabled={!!removing}
        onPrimary={(e) => {
          e.preventDefault();
          if (!confirmRemove) return;
          removeAdmin(confirmRemove);
        }}
        secondaryLabel="Cancel"
      />
    </AdminViewShell>
  );
};

export default AdminSettings;
