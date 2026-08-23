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
import { ShieldCheck, Trash2, Plus, Search, UserPlus, Flag, Smartphone } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { logAdminAction } from "@/lib/adminAudit";
import { Switch } from "@/components/ui/switch";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";

// The fee-ladder rungs an admin is shown. Business (6%) is only named while
// the Business product is switched on — with `BUSINESS_ENABLED` false there
// is no Business plan anyone can hold, so listing it in the console describes
// a rate that can never apply. Same treatment as legal/TermsSection and the
// Help Center fee answers.
const FEE_LADDER_LABEL = BUSINESS_ENABLED
  ? "Free 12 / Basic 11 / Pro 10 / Elite 8 / Business 6"
  : "Free 12 / Basic 11 / Pro 10 / Elite 8";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Known feature flags. Keeping this as a constants list (vs reading
// every key found in the JSONB blob) means the UI surface is
// deterministic — a stray key written by some other tool can't show
// up here as a mystery toggle. New flags need a line here + a usage
// site reading from `feature_flags[<id>]`.
const KNOWN_FEATURE_FLAGS: { id: string; label: string; description: string }[] = [
  { id: "subscriptions_enabled", label: "Subscriptions", description: "Show the Pro / Elite subscription upsell + flows." },
  { id: "referrals_enabled", label: "Referrals", description: "Surface the referral programme in profile + invites." },
  { id: "ai_helpr_assistant", label: "AI Helpr assistant", description: "Show the AI-assisted job-post draft flow." },
  { id: "boosts_enabled", label: "Job boosts", description: "Allow posters to pay to boost their job to the top." },
  { id: "stripe_idv_required", label: "Stripe IDV required", description: "Force every helper through Stripe Identity before accepting jobs." },
];

const AdminSettings = () => {
  const [customerFee, setCustomerFee] = useState("");
  const [helperFee, setHelperFee] = useState("");
  const [socialWebhookUrl, setSocialWebhookUrl] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      toast.error("Couldn't load platform settings — refresh to retry");
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
      toast.error("Min build must be a non-negative integer");
      return;
    }
    if (n > 999_999) {
      toast.error("Min build must be no greater than 999,999");
      return;
    }
    setSavingMinBuild(true);
    const { error } = await (supabase.from as any)("platform_settings")
      .update({ min_supported_build: n })
      .eq("id", settingsId);
    setSavingMinBuild(false);
    if (error) {
      if (error.code === "42703") {
        toast.error("min_supported_build column not yet deployed — run `supabase db push`");
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success(`Minimum supported build set to ${n}`);
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
    const { error } = await (supabase.from as any)("platform_settings")
      .update({ feature_flags: nextFlags })
      .eq("id", settingsId);
    setSavingFlag(null);
    if (error) {
      // Roll back optimistic change on failure.
      setFeatureFlags(featureFlags);
      if (error.code === "42703") {
        toast.error("feature_flags column not yet deployed — run `supabase db push`");
      } else {
        toast.error(error.message);
      }
      return;
    }
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
    const { error } = await supabase
      .from("platform_settings")
      .update({ social_webhook_url: url || null })
      .eq("id", settingsId);
    setSavingWebhook(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Webhook URL saved");
      await logAdminAction("update_settings", "platform_settings", settingsId, { social_webhook_url: url ? "set" : "cleared" });
    }
  };

  const loadAdmins = async () => {
    setAdminsLoading(true);
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("id, user_id, role")
      .eq("role", "admin");

    if (rolesError) {
      console.error("[AdminSettings] loadAdmins roles:", rolesError);
      toast.error("Couldn't load admin list — refresh to retry");
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

  const handleSave = async () => {
    if (!settingsId) return;
    const custVal = parseFloat(customerFee);
    const helpVal = parseFloat(helperFee);
    if (isNaN(custVal) || custVal < 0 || custVal > 100 || isNaN(helpVal) || helpVal < 0 || helpVal > 100) {
      toast.error("Fees must be between 0 and 100");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({
        platform_fee_percent: custVal,
        customer_fee_percent: custVal,
        helper_fee_percent: helpVal,
      })
      .eq("id", settingsId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Fee settings updated");
      await logAdminAction("update_settings", "platform_settings", settingsId, { customer_fee_percent: custVal, helper_fee_percent: helpVal });
    }
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
    setAdding(profile.user_id);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: profile.user_id, role: "admin" });

    if (error) {
      if (error.code === "23505") toast.error("User is already an admin");
      else toast.error(error.message);
    } else {
      toast.success(`${formatName(profile.full_name)} added as admin`);
      await logAdminAction("add_admin", "user", profile.user_id, { name: profile.full_name });
      await loadAdmins();
      setSearchResults((prev) => prev.filter((p) => p.user_id !== profile.user_id));
    }
    setAdding(null);
  };

  const removeAdmin = async (admin: { user_id: string; role_id: string; name: string }) => {
    // Get current user to prevent self-removal
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id === admin.user_id) {
      toast.error("You can't remove yourself as admin");
      return;
    }

    setRemoving(admin.role_id);
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", admin.role_id);

    if (error) toast.error(error.message);
    else {
      toast.success(`${admin.name} removed from admins`);
      await logAdminAction("remove_admin", "user", admin.user_id, { name: admin.name });
      await loadAdmins();
    }
    setRemoving(null);
    setConfirmRemove(null);
  };

  if (loading) return <p className="text-muted-foreground">Loading settings…</p>;

  return (
    <div className="space-y-6">
      

      {/* Split Fee Settings */}
      <div className="max-w-md rounded-ds-md liquid-glass p-6 space-y-5">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-foreground">Split Fee Model</h3>
          <p className="text-ds-11 text-muted-foreground">
            The platform earns from both sides: a service fee from customers and a platform fee from Helprs.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custFee">Customer service fee (%) — fallback</Label>
            <p className="text-ds-11 text-muted-foreground">Fallback only. Each poster is charged their own tier rate ({FEE_LADDER_LABEL}), floored at Stripe's cost. This value is used only when a poster's tier can't be read.</p>
            <Input
              id="custFee"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={customerFee}
              onChange={(e) => setCustomerFee(e.target.value)}
              className="max-w-[120px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="helpFee">Helpr platform fee (%)</Label>
            <p className="text-ds-11 text-muted-foreground">Deducted from the Helpr's payout (e.g. 10% on a $100 job = $10 deducted)</p>
            <Input
              id="helpFee"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={helperFee}
              onChange={(e) => setHelperFee(e.target.value)}
              className="max-w-[120px]"
            />
          </div>
          <div className="rounded-ds-sm bg-primary/5 p-3">
            <p className="text-ds-11 text-muted-foreground">
              <strong>Total platform take:</strong> {(parseFloat(customerFee) || 0) + (parseFloat(helperFee) || 0)}% — 
              On a $100 job: ${((parseFloat(customerFee) || 0)).toFixed(2)} from customer + ${((parseFloat(helperFee) || 0)).toFixed(2)} from Helpr = ${((parseFloat(customerFee) || 0) + (parseFloat(helperFee) || 0)).toFixed(2)} total
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Fee Settings"}
        </Button>
      </div>

      {/* Social Webhook URL */}
      <div className="max-w-md rounded-ds-md liquid-glass p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-foreground">Social Webhook URL</h3>
          <p className="text-ds-11 text-muted-foreground">
            Paste the Make.com webhook URL here. The "Send to Social" button on the Facebook Post Generator will send each post (text + image + timing) to this URL for scheduling.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="socialWebhook">Webhook URL</Label>
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
      </div>

      {/* Feature Flags */}
      <div className="max-w-lg rounded-ds-md liquid-glass p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <Flag className="w-4 h-4 text-primary" /> Feature Flags
          </h3>
          <p className="text-ds-11 text-muted-foreground">
            Server-side toggles for major user-facing surfaces. Off-state
            should always be a safe fallback (hide UI, no-op handlers).
            Persists immediately when toggled.
          </p>
        </div>
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
      </div>

      {/* Min Supported Build */}
      <div className="max-w-md rounded-ds-md liquid-glass p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-primary" /> Minimum Supported Build
          </h3>
          <p className="text-ds-11 text-muted-foreground">
            Native binaries with a build code lower than this are forced
            to update via the in-app ForceUpdate blocker. Set to{" "}
            <code className="text-foreground">0</code> to disable the
            check. Bumps take effect on the next app launch — no binary
            release required.
          </p>
        </div>
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
      </div>

      {/* Admin Management */}
      <div className="max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-ds-20 font-display font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Admin Users
          </h3>
          <Button size="sm" onClick={() => { setShowAddDialog(true); setSearchQuery(""); setSearchResults([]); }}>
            <UserPlus className="w-4 h-4 mr-1" /> Add Admin
          </Button>
        </div>

        {adminsLoading ? (
          <p className="text-ds-11 text-muted-foreground">Loading admins…</p>
        ) : admins.length === 0 ? (
          <div className="rounded-ds-md liquid-glass p-6 text-center">
            <p className="text-ds-11 text-muted-foreground">No admins found</p>
          </div>
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
      </div>

      {/* How fees work */}
      <div className="max-w-md rounded-ds-md liquid-glass p-6 space-y-3">
        <h3 className="font-semibold text-foreground">How the split fee model works</h3>
        <ul className="text-ds-11 text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Customer pays: job budget + their tier service fee ({FEE_LADDER_LABEL}; <strong className="text-foreground">{customerFee}%</strong> fallback) + sales tax, floored at Stripe's cost</li>
          <li>Helpr receives: job budget − their tier platform fee (<strong className="text-foreground">{helperFee}%</strong> fallback) + urgent bonus</li>
          <li>Platform keeps: service fee from customer + platform fee from Helpr</li>
          <li>Total platform take: <strong className="text-foreground">{(parseFloat(customerFee) || 0) + (parseFloat(helperFee) || 0)}%</strong></li>
        </ul>
      </div>

      {/* Add Admin Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHero eyebrow="Admin access" title="Add Admin User" />
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
        primaryLabel={confirmRemove && removing === confirmRemove.role_id ? "Removing…" : "Remove admin"}
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
    </div>
  );
};

export default AdminSettings;
