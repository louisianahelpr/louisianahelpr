import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, Trash2, Plus, Search, UserPlus } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { logAdminAction } from "@/lib/adminAudit";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const AdminSettings = () => {
  const [customerFee, setCustomerFee] = useState("");
  const [helperFee, setHelperFee] = useState("");
  const [socialWebhookUrl, setSocialWebhookUrl] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Admin management
  const [admins, setAdmins] = useState<{ user_id: string; role_id: string; name: string; email: string }[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    loadAdmins();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from("platform_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (data) {
      setCustomerFee(String((data as any).customer_fee_percent ?? 10));
      setHelperFee(String((data as any).helper_fee_percent ?? 10));
      setSocialWebhookUrl(String((data as any).social_webhook_url ?? ""));
      setSettingsId(data.id);
    }
    setLoading(false);
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
      .update({ social_webhook_url: url || null } as any)
      .eq("id", settingsId);
    setSavingWebhook(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Webhook URL saved!");
      await logAdminAction("update_settings", "platform_settings", settingsId, { social_webhook_url: url ? "set" : "cleared" });
    }
  };

  const loadAdmins = async () => {
    setAdminsLoading(true);
    const { data: roles } = await supabase
      .from("user_roles")
      .select("id, user_id, role")
      .eq("role", "admin");

    if (roles && roles.length > 0) {
      const userIds = roles.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);
      setAdmins(
        roles.map((r) => ({
          user_id: r.user_id,
          role_id: r.id,
          name: formatName(profileMap.get(r.user_id)?.full_name, "—"),
          email: (profileMap.get(r.user_id) as any)?.email || "—",
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
      } as any)
      .eq("id", settingsId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Fee settings updated!");
      await logAdminAction("update_settings", "platform_settings", settingsId, { customer_fee_percent: custVal, helper_fee_percent: helpVal });
    }
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const q = searchQuery.trim().toLowerCase();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);

    // Filter out users who are already admins
    const adminIds = new Set(admins.map((a) => a.user_id));
    setSearchResults((data || []).filter((p) => !adminIds.has(p.user_id)));
    setSearching(false);
  };

  const addAdmin = async (profile: Profile) => {
    setAdding(profile.user_id);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: profile.user_id, role: "admin" as any });

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
  };

  if (loading) return <p className="text-muted-foreground">Loading settings…</p>;

  return (
    <div className="space-y-8">
      

      {/* Split Fee Settings */}
      <div className="max-w-md rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-foreground">Split Fee Model</h3>
          <p className="text-xs text-muted-foreground">
            The platform earns from both sides: a service fee from customers and a commission from helpers.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custFee">Customer service fee (%)</Label>
            <p className="text-xs text-muted-foreground">Added as a line item at checkout (e.g. 5% on a $100 job = $5 fee)</p>
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
            <Label htmlFor="helpFee">Helpr commission (%)</Label>
            <p className="text-xs text-muted-foreground">Deducted from the helpr's payout (e.g. 10% on a $100 job = $10 deducted)</p>
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
          <div className="rounded-lg bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Total platform take:</strong> {(parseFloat(customerFee) || 0) + (parseFloat(helperFee) || 0)}% — 
              On a $100 job: ${((parseFloat(customerFee) || 0)).toFixed(2)} from customer + ${((parseFloat(helperFee) || 0)).toFixed(2)} from helper = ${((parseFloat(customerFee) || 0) + (parseFloat(helperFee) || 0)).toFixed(2)} total
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save fee settings"}
        </Button>
      </div>

      {/* Social Webhook URL */}
      <div className="max-w-md rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display font-semibold text-foreground">Social Webhook URL</h3>
          <p className="text-xs text-muted-foreground">
            Paste the Make.com webhook URL here. The "Send to Social" button on the Facebook Post Generator will send each post (text + image + timing) to this URL for scheduling.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="socialWebhook">Webhook URL</Label>
          <Input
            id="socialWebhook"
            type="url"
            placeholder="https://hook.us2.make.com/..."
            value={socialWebhookUrl}
            onChange={(e) => setSocialWebhookUrl(e.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Payload sent: <code className="text-foreground">{`{ post_text, image_url, timing_priority }`}</code>
          </p>
        </div>
        <Button onClick={handleSaveWebhook} disabled={savingWebhook}>
          {savingWebhook ? "Saving…" : "Save webhook URL"}
        </Button>
      </div>

      {/* Admin Management */}
      <div className="max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Admin Users
          </h3>
          <Button size="sm" onClick={() => { setShowAddDialog(true); setSearchQuery(""); setSearchResults([]); }}>
            <UserPlus className="w-4 h-4 mr-1" /> Add Admin
          </Button>
        </div>

        {adminsLoading ? (
          <p className="text-sm text-muted-foreground">Loading admins…</p>
        ) : admins.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">No admins found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {admins.map((admin) => (
              <div key={admin.role_id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-sm">{admin.name}</p>
                    <Badge className="bg-primary/10 text-primary text-xs">Admin</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{admin.email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 shrink-0"
                  disabled={removing === admin.role_id}
                  onClick={() => removeAdmin(admin)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How fees work */}
      <div className="max-w-md rounded-xl border border-border bg-card p-6 space-y-3">
        <h3 className="font-semibold text-foreground">How the split fee model works</h3>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Customer pays: task budget + <strong className="text-foreground">{customerFee}%</strong> service fee + sales tax</li>
          <li>Helpr receives: task budget − <strong className="text-foreground">{helperFee}%</strong> commission + urgent tip</li>
          <li>Platform keeps: service fee from customer + commission from helper</li>
          <li>Total platform take: <strong className="text-foreground">{(parseFloat(customerFee) || 0) + (parseFloat(helperFee) || 0)}%</strong></li>
        </ul>
      </div>

      {/* Add Admin Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Add Admin User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name or email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchUsers()}
              />
              <Button onClick={searchUsers} disabled={searching} size="icon" className="shrink-0">
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {searching && <p className="text-sm text-muted-foreground">Searching…</p>}

            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {searchResults.map((profile) => (
                  <div key={profile.id} className="rounded-lg border border-border bg-secondary/20 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground text-sm">{formatName(profile.full_name, "—")}</p>
                      <p className="text-xs text-muted-foreground">{(profile as any).email || "—"}</p>
                      <Badge variant="secondary" className="text-xs capitalize mt-1">{profile.role}</Badge>
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
              <p className="text-sm text-muted-foreground text-center py-4">No users found. Try a different search.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminSettings;
