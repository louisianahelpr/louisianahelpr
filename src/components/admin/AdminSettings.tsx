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
      setCustomerFee(String((data as any).customer_fee_percent ?? 5));
      setHelperFee(String((data as any).helper_fee_percent ?? 10));
      setSettingsId(data.id);
    }
    setLoading(false);
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
    const value = parseFloat(feePercent);
    if (isNaN(value) || value < 0 || value > 100) {
      toast.error("Fee must be between 0 and 100");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({ platform_fee_percent: value })
      .eq("id", settingsId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Platform fee updated!");
      await logAdminAction("update_settings", "platform_settings", settingsId, { platform_fee_percent: value });
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
      

      {/* Platform Fee */}
      <div className="max-w-md rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="fee">Platform fee percentage (%)</Label>
          <p className="text-xs text-muted-foreground">
            This is the percentage Helpr takes from each job payment. Applied at time of escrow.
          </p>
          <Input
            id="fee"
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
            className="max-w-[120px]"
          />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
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
        <h3 className="font-semibold text-foreground">How fees work</h3>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Customer pays the full job budget at time of posting (escrow)</li>
          <li>When the job is completed, Helpr retains the platform fee</li>
          <li>The remaining amount goes to the helpr</li>
          <li>Current fee: <strong className="text-foreground">{feePercent}%</strong></li>
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
