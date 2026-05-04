import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, UserPlus, Trash2, Loader2, ArrowLeft, Crown, Mail, Sparkles, CreditCard } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness, type SeatTier } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import BusinessVerificationCard from "@/components/business/BusinessVerificationCard";

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

const TIERS: Array<{ id: SeatTier; name: string; seats: number; price: string; priceCents: number }> = [
  { id: "starter", name: "Starter", seats: 2, price: "Free", priceCents: 0 },
  { id: "crew", name: "Crew", seats: 5, price: "$10/mo", priceCents: 1000 },
  { id: "team", name: "Team", seats: 10, price: "$20/mo", priceCents: 2000 },
  { id: "enterprise", name: "Enterprise", seats: 15, price: "$40/mo", priceCents: 4000 },
];

const TIER_RANK: Record<SeatTier, number> = { starter: 0, crew: 1, team: 2, enterprise: 3 };

const BusinessTeam = () => {
  usePageTitle("Manage Team — Helpr Business");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { business, isLoading: businessLoading } = useMyBusiness();
  const { user } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [upgrading, setUpgrading] = useState<SeatTier | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Sync seat subscription on mount + after Stripe checkout return
  useEffect(() => {
    if (!business?.is_owner) return;
    let cancelled = false;
    (async () => {
      try {
        await supabase.functions.invoke("check-business-seat-subscription");
        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: ["myBusiness"] });
        }
      } catch (err) {
        console.warn("Seat subscription sync failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [business?.is_owner, business?.business_id, queryClient]);

  // Toast on Stripe return
  useEffect(() => {
    const seats = searchParams.get("seats");
    if (seats === "success") {
      toast.success("Plan upgraded! Your new seats are ready.");
      searchParams.delete("seats");
      setSearchParams(searchParams, { replace: true });
    } else if (seats === "cancel") {
      toast.info("Upgrade cancelled.");
      searchParams.delete("seats");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
          <p className="text-xs text-muted-foreground mb-6">
            You're not part of a business. Sign up as a business to manage a team.
          </p>
          <Button onClick={() => navigate("/for-business")}>Learn more</Button>
        </Card>
      </div>
    );
  }

  const activeMembers = members?.filter((m) => m.status === "active") ?? [];
  const pendingMembers = members?.filter((m) => m.status === "pending") ?? [];
  const SEAT_LIMIT = business.seat_limit;
  const currentTier = business.seat_tier;
  const totalSlots = activeMembers.length + pendingMembers.length;
  const remainingSlots = Math.max(0, SEAT_LIMIT - totalSlots);
  const currentTierMeta = TIERS.find((t) => t.id === currentTier) ?? TIERS[0];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!business.is_owner) {
      toast.error("Only the owner can invite members");
      return;
    }
    if (remainingSlots <= 0) {
      toast.error(`Team is full (${SEAT_LIMIT} seats). Upgrade your plan to add more.`);
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

  const handleUpgrade = async (tier: SeatTier) => {
    if (tier === "starter") {
      // Downgrades happen via the customer portal
      return handleManageBilling();
    }
    setUpgrading(tier);
    try {
      const { data, error } = await supabase.functions.invoke("create-business-seat-checkout", {
        body: { tier },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("No checkout URL returned");
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
      setUpgrading(null);
    }
  };

  const handleManageBilling = async () => {
    setOpeningPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("business-seat-portal");
      if (error) throw error;
      if (!data?.url) throw new Error("No portal URL returned");
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to open billing portal");
      setOpeningPortal(false);
    }
  };

  return (
    <div className="min-h-screen bg-premium-page">
      <div className="container mx-auto px-5 py-6 max-w-3xl">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <span
              className="font-serif italic uppercase text-[0.62rem] block"
              style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              Your team
            </span>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <h1 className="font-display italic font-bold leading-tight" style={{ fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}>{business.business_name}</h1>
              <Badge variant="secondary" className="text-xs gap-1">
                <Sparkles className="w-3 h-3" /> {currentTierMeta.name} · {currentTierMeta.price}
              </Badge>
            </div>
            <p className="font-serif italic mt-0.5 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              {totalSlots} of {SEAT_LIMIT} seats used{" "}
              <span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
              {remainingSlots} remaining
            </p>
          </div>
        </div>

        <div className="mb-5">
          <BusinessVerificationCard />
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
                You've reached your {SEAT_LIMIT}-seat limit. Upgrade your plan below to add more members.
              </p>
            )}
          </Card>
        )}

        {business.is_owner && (
          <Card className="p-5 mb-5">
            <div className="flex items-start justify-between mb-3 gap-3">
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Seat plan
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Upgrade or downgrade anytime. Changes apply to your next billing cycle.
                </p>
              </div>
              {currentTier !== "starter" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManageBilling}
                  disabled={openingPortal}
                  className="shrink-0"
                >
                  {openingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (<><CreditCard className="w-3.5 h-3.5 mr-1.5" /> Manage</>)}
                </Button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              {TIERS.map((tier) => {
                const isCurrent = tier.id === currentTier;
                const isUpgrade = TIER_RANK[tier.id] > TIER_RANK[currentTier];
                const isDowngrade = TIER_RANK[tier.id] < TIER_RANK[currentTier];
                const wouldFitCurrent = tier.seats >= totalSlots;

                return (
                  <div
                    key={tier.id}
                    className={`rounded-lg border p-3 ${isCurrent ? "border-primary/50 bg-primary/5" : "border-border/60 bg-background/50"}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{tier.name}</p>
                        <p className="text-xs text-muted-foreground">{tier.seats} seats · {tier.price}</p>
                      </div>
                      {isCurrent && (
                        <Badge className="text-[10px] h-5">Current</Badge>
                      )}
                    </div>
                    {!isCurrent && (
                      <Button
                        variant={isUpgrade ? "default" : "outline"}
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={() => handleUpgrade(tier.id)}
                        disabled={
                          upgrading !== null ||
                          openingPortal ||
                          (isDowngrade && !wouldFitCurrent)
                        }
                      >
                        {upgrading === tier.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isUpgrade ? (
                          "Upgrade"
                        ) : isDowngrade && !wouldFitCurrent ? (
                          `Remove ${totalSlots - tier.seats} seat${totalSlots - tier.seats === 1 ? "" : "s"} first`
                        ) : (
                          "Switch via portal"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
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
