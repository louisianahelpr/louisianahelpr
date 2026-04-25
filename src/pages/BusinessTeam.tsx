import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, UserPlus, Trash2, Loader2, ArrowLeft, Crown, Mail } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface Member {
  id: string;
  user_id: string | null;
  invited_email: string | null;
  role: "owner" | "member";
  status: "pending" | "active" | "removed";
  invited_at: string;
  joined_at: string | null;
  full_name?: string;
  email?: string;
}

const BusinessTeam = () => {
  usePageTitle("Manage Team — Helpr Business");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { business, isLoading: businessLoading } = useMyBusiness();
  const { user } = useCurrentUser();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["businessMembers", business?.business_id],
    queryFn: async (): Promise<Member[]> => {
      if (!business) return [];
      const { data, error } = await supabase
        .from("business_members")
        .select("id, user_id, invited_email, role, status, invited_at, joined_at")
        .eq("business_id", business.business_id)
        .neq("status", "removed")
        .order("invited_at", { ascending: true });
      if (error) throw error;

      const userIds = (data ?? []).map((m: any) => m.user_id).filter(Boolean);
      let profiles: any[] = [];
      if (userIds.length > 0) {
        const { data: p } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
        profiles = p ?? [];
      }

      return (data ?? []).map((m: any) => {
        const profile = profiles.find((p) => p.user_id === m.user_id);
        return { ...m, full_name: profile?.full_name, email: profile?.email };
      });
    },
    enabled: !!business,
  });

  if (businessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5">
        <Card className="p-8 max-w-md text-center">
          <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-xl font-bold mb-2">No business account</h1>
          <p className="text-sm text-muted-foreground mb-6">
            You're not part of a business. Sign up as a business to manage a team.
          </p>
          <Button onClick={() => navigate("/for-business")}>Learn more</Button>
        </Card>
      </div>
    );
  }

  const activeMembers = members?.filter((m) => m.status === "active") ?? [];
  const pendingMembers = members?.filter((m) => m.status === "pending") ?? [];
  const totalSlots = activeMembers.length + pendingMembers.length;
  const remainingSlots = Math.max(0, 5 - totalSlots);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!business.is_owner) {
      toast.error("Only the owner can invite members");
      return;
    }
    if (remainingSlots <= 0) {
      toast.error("Team is full (5 members). Upgrade required for more.");
      return;
    }

    setInviting(true);
    try {
      const { error } = await supabase.from("business_members").insert({
        business_id: business.business_id,
        invited_email: email,
        role: "member",
        status: "pending",
        invited_by: user?.id,
      });
      if (error) throw error;
      toast.success(`Invite sent to ${email}. They'll join when they sign up.`);
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["businessMembers", business.business_id] });
    } catch (err: any) {
      toast.error(err.message || "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm("Remove this team member?")) return;
    try {
      const { error } = await supabase
        .from("business_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["businessMembers", business.business_id] });
    } catch (err: any) {
      toast.error(err.message || "Failed to remove member");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-5 py-6 max-w-3xl">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">{business.business_name}</h1>
            <p className="text-sm text-muted-foreground">
              {totalSlots} of 5 seats used · {remainingSlots} remaining
            </p>
          </div>
        </div>

        {business.is_owner && (
          <Card className="p-5 mb-5">
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Invite a team member
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              They'll get full access to post and manage jobs on behalf of {business.business_name}. All jobs are billed to your card on file.
            </p>
            <form onSubmit={handleInvite} className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="invite-email" className="sr-only">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={remainingSlots <= 0}
                />
              </div>
              <Button type="submit" disabled={inviting || remainingSlots <= 0}>
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Invite"}
              </Button>
            </form>
            {remainingSlots <= 0 && (
              <p className="text-xs text-destructive mt-2">
                You've reached the 5-seat limit. Contact support to upgrade.
              </p>
            )}
          </Card>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground px-1">
            Team ({activeMembers.length})
          </h3>
          {membersLoading ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto my-8 text-muted-foreground" />
          ) : (
            <>
              {activeMembers.map((m) => (
                <Card key={m.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{m.full_name || m.email || "Team member"}</p>
                      {m.role === "owner" && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Crown className="w-3 h-3" /> Owner
                        </Badge>
                      )}
                    </div>
                    {m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
                  </div>
                  {business.is_owner && m.role !== "owner" && (
                    <Button variant="ghost" size="icon" onClick={() => handleRemove(m.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </Card>
              ))}

              {pendingMembers.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-muted-foreground px-1 pt-4">
                    Pending invites ({pendingMembers.length})
                  </h3>
                  {pendingMembers.map((m) => (
                    <Card key={m.id} className="p-4 flex items-center justify-between bg-muted/30">
                      <div>
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <p className="font-medium">{m.invited_email}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Will join when they sign up with this email
                        </p>
                      </div>
                      {business.is_owner && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(m.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </Card>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessTeam;
