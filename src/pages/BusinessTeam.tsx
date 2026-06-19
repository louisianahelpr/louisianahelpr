// BusinessTeam — the B2B workspace shell.
//
// Originally a one-shot seat manager; now a tabbed workspace covering
// Members, Approvals, Spend, Activity, and Settings. The Members tab
// retains the original invite + seat-plan flow and adds the role grid
// + bulk CSV invite + reassign-on-removal. Spend/Approvals/Activity
// live in extracted components under src/components/business/. Settings
// owns the new team-level toggles (approval threshold, 2FA, default
// payment method, monthly budget).
//
// All new schema bits ship in migration 20260609170000_business_team_roles.sql.
// Migrations don't auto-deploy on prod, so every new RPC / column has a
// PGRST202 / PGRST204 fallback inline.

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BusinessLayout from "@/components/business/BusinessLayout";
import {
  Building2,
  UserPlus,
  Trash2,
  Loader2,
  Crown,
  Mail,
  Sparkles,
  CreditCard,
  Send,
  Check,
  FileSpreadsheet,
  ShieldAlert,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticError } from "@/lib/haptics";
import { useMyBusiness, type SeatTier, type ExtendedRole } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import BusinessVerificationCard from "@/components/business/BusinessVerificationCard";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { queryKeys } from "@/lib/queryKeys";
import BulkInviteDialog from "@/components/business/BulkInviteDialog";
import SpendDashboardTab from "@/components/business/SpendDashboardTab";
import ApprovalsTab from "@/components/business/ApprovalsTab";
import ActivityFeedTab from "@/components/business/ActivityFeedTab";
import SettingsTab from "@/components/business/SettingsTab";
import ReassignMemberDialog, { type ReassignTarget } from "@/components/business/ReassignMemberDialog";
import { ROLE_LABEL, ROLE_SPECS, canApprove, canManageTeam } from "@/components/business/roles";

interface Member {
  id: string;
  user_id: string | null;
  invited_email: string | null;
  role: "owner" | "member";
  extended_role: ExtendedRole;
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

type TabValue = "members" | "approvals" | "spend" | "activity" | "settings";

const BusinessTeam = () => {
  usePageTitle("Manage Team — Helpr Business");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { business, isLoading: businessLoading } = useMyBusiness();
  const { user } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = (searchParams.get("tab") as TabValue | null) ?? "members";
  const [tab, setTab] = useState<TabValue>(tabParam);
  useEffect(() => {
    setTab(tabParam);
  }, [tabParam]);
  const onTabChange = (next: string) => {
    setTab(next as TabValue);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [upgrading, setUpgrading] = useState<SeatTier | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const inviteEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  // Sync seat subscription on mount + after Stripe checkout return
  useEffect(() => {
    if (!business?.is_owner) return;
    let cancelled = false;
    (async () => {
      try {
        await supabase.functions.invoke("check-business-seat-subscription");
        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: queryKeys.business.allMine });
        }
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "BusinessTeam.seatSubscriptionSync" } });
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: queryKeys.business.members(business?.business_id),
    queryFn: async (): Promise<Member[]> => {
      if (!business) return [];
      // Try the wide select with extended_role; fall back to the
      // pre-migration column set when the column doesn't exist yet.
      const wide = await supabase
        .from("business_members")
        .select(
          "id, user_id, invited_email, role, extended_role, status, invited_at, joined_at" as any,
        )
        .eq("business_id", business.business_id)
        .neq("status", "removed")
        .order("invited_at", { ascending: true });

      let rows: any[] | null = wide.data as any[] | null;
      if (wide.error) {
        const code = (wide.error as { code?: string }).code;
        if (code !== "42703" && code !== "PGRST204") throw wide.error;
        const narrow = await supabase
          .from("business_members")
          .select("id, user_id, invited_email, role, status, invited_at, joined_at")
          .eq("business_id", business.business_id)
          .neq("status", "removed")
          .order("invited_at", { ascending: true });
        if (narrow.error) throw narrow.error;
        rows = narrow.data;
      }

      const userIds = (rows ?? []).map((m: any) => m.user_id).filter(Boolean);
      let profiles: any[] = [];
      if (userIds.length > 0) {
        const { data: p, error: pErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
        if (pErr) throw pErr;
        profiles = p ?? [];
      }

      return (rows ?? []).map((m: any) => {
        const profile = profiles.find((p) => p.user_id === m.user_id);
        const isOwnerRole = m.role === "owner";
        const ext: ExtendedRole = m.extended_role
          ? (m.extended_role as ExtendedRole)
          : isOwnerRole
            ? "owner"
            : "poster";
        return {
          ...m,
          extended_role: ext,
          full_name: profile?.full_name,
          email: profile?.email,
        };
      });
    },
    enabled: !!business,
  });

  if (businessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <HelprSpinner size={32} />
      </div>
    );
  }

  if (!business) {
    return (
      <BusinessLayout eyebrow="Helpr Business" title="Manage team">
        <EmptyState
          variant="inline"
          icon={Building2}
          eyebrow="No business account"
          title="You're not part of a business"
          body="Sign up as a business to add teammates and manage jobs together under one account."
          action={<Button onClick={() => navigate("/for-business")}>Learn more</Button>}
        />
      </BusinessLayout>
    );
  }

  const activeMembers = members?.filter((m) => m.status === "active") ?? [];
  const pendingMembers = members?.filter((m) => m.status === "pending") ?? [];
  const SEAT_LIMIT = business.seat_limit;
  const currentTier = business.seat_tier;
  const totalSlots = activeMembers.length + pendingMembers.length;
  const remainingSlots = Math.max(0, SEAT_LIMIT - totalSlots);
  const currentTierMeta = TIERS.find((t) => t.id === currentTier) ?? TIERS[0];
  const myExtendedRole = business.extended_role;
  const isAdminOrOwner = canManageTeam(myExtendedRole);
  const canApproveTab = canApprove(myExtendedRole);

  const reassignCandidates: ReassignTarget[] = activeMembers
    .filter((m) => m.user_id && m.user_id !== removeTarget?.user_id)
    .map((m) => ({
      member_id: m.id,
      user_id: m.user_id!,
      display: m.full_name || m.email || "Team member",
    }));

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!isAdminOrOwner) {
      hapticError();
      toast.error("Only the owner or an admin can invite teammates.");
      return;
    }
    if (remainingSlots <= 0) {
      hapticError();
      toast.error(`Your team is full at ${SEAT_LIMIT} seats — upgrade your plan to add more.`);
      return;
    }

    setInviting(true);
    try {
      const payload: any = {
        business_id: business.business_id,
        invited_email: email,
        role: "member",
        extended_role: "poster",
        status: "pending",
        invited_by: user?.id,
      };
      let { error } = await supabase.from("business_members").insert(payload);
      if (error) {
        // Column might not exist yet on prod; retry without extended_role.
        const code = (error as { code?: string }).code;
        if (code === "42703" || code === "PGRST204") {
          delete payload.extended_role;
          ({ error } = await supabase.from("business_members").insert(payload));
        }
      }
      if (error) throw error;

      const { error: emailErr } = await supabase.functions.invoke("send-business-invite-email", {
        body: { businessId: business.business_id, invitedEmail: email },
      });
      if (emailErr) {
        toast.warning(
          `Invite saved, but email failed to send. Share this link manually: louisianahelpr.com/signup?invite=${encodeURIComponent(email)}`,
        );
      } else {
        toast.success(`Invite emailed to ${email}.`);
      }
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: queryKeys.business.members(business.business_id) });
    } catch (err: any) {
      hapticError();
      toast.error(err.message || "We couldn't send that invite — try again in a moment.");
    } finally {
      setInviting(false);
    }
  };

  const handleResendInvite = async (memberEmail: string) => {
    if (!business) return;
    const { error } = await supabase.functions.invoke("send-business-invite-email", {
      body: { businessId: business.business_id, invitedEmail: memberEmail },
    });
    if (error) {
      hapticError();
      // One-shot operation with stable inputs — exactly the kind of
      // transient failure that justifies an inline Retry button instead
      // of forcing the user to find the row in the list again.
      errorToast("We couldn't resend that invite", {
        description: "Tap retry — or report if it keeps happening.",
        onRetry: () => handleResendInvite(memberEmail),
      });
    } else {
      toast.success(`Invite resent to ${memberEmail}.`);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    const { error } = await supabase
      .from("business_members")
      .delete()
      .eq("id", removeTarget.id);
    if (error) {
      hapticError();
      toast.error(error.message || "We couldn't remove that teammate — try again in a moment.");
      return;
    }
    toast.success(
      removeTarget.status === "pending" ? "Invite cancelled" : "Member removed",
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.business.members(business.business_id) });
    setRemoveTarget(null);
  };

  const handleChangeRole = async (memberId: string, nextRole: Exclude<ExtendedRole, "owner">) => {
    setSavingRole(memberId);
    const { error } = await supabase.rpc("update_business_member_role" as any, {
      p_member_id: memberId,
      p_role: nextRole,
    } as any);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST202") {
        // RPC missing — write directly as a degraded fallback. The
        // CHECK constraint still enforces valid values.
        const { error: writeErr } = await supabase
          .from("business_members")
          .update({ extended_role: nextRole } as any)
          .eq("id", memberId);
        setSavingRole(null);
        if (writeErr) {
          const writeCode = (writeErr as { code?: string }).code;
          if (writeCode === "42703" || writeCode === "PGRST204") {
            toast.error("Roles aren't live yet — the platform update is finishing deploying.");
            return;
          }
          hapticError();
          toast.error("Couldn't change role — try again.");
          return;
        }
        toast.success(`Role updated to ${ROLE_LABEL[nextRole]}.`);
        queryClient.invalidateQueries({ queryKey: queryKeys.business.members(business.business_id) });
        return;
      }
      setSavingRole(null);
      hapticError();
      toast.error(error.message || "Couldn't change role — try again.");
      return;
    }
    setSavingRole(null);
    toast.success(`Role updated to ${ROLE_LABEL[nextRole]}.`);
    queryClient.invalidateQueries({ queryKey: queryKeys.business.members(business.business_id) });
  };

  const handleUpgrade = async (tier: SeatTier) => {
    if (tier === "starter") {
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
      hapticError();
      toast.error(err.message || "We couldn't open checkout — try again in a moment.");
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
      hapticError();
      toast.error(err.message || "We couldn't open your billing portal — try again in a moment.");
      setOpeningPortal(false);
    }
  };

  const showMFABanner = business.require_2fa;

  return (
    <BusinessLayout
      eyebrow="Your team"
      title={business.business_name}
      meta={`${totalSlots} of ${SEAT_LIMIT} seats used · ${remainingSlots} remaining`}
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Badge variant="secondary" className="text-ds-11 gap-1">
            <Sparkles className="w-3 h-3" /> {currentTierMeta.name} · {currentTierMeta.price}
          </Badge>
          <Badge variant="outline" className="text-ds-11">
            {ROLE_LABEL[myExtendedRole]}
          </Badge>
        </div>

        {showMFABanner && (
          <Card
            className="p-4 mb-4 flex items-start gap-3"
            style={{
              background: "hsl(var(--gold-warm) / 0.08)",
              borderColor: "hsl(var(--gold-warm) / 0.35)",
            }}
          >
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} />
            <div>
              <p className="font-medium">2FA required to post</p>
              <p className="text-ds-11 text-muted-foreground mt-0.5">
                Your team requires two-factor auth. Enroll from your profile's security settings to
                keep posting jobs.
              </p>
            </div>
          </Card>
        )}

        <div className="mb-5">
          <BusinessVerificationCard />
        </div>

        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList className="grid grid-cols-5 w-full mb-4">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
            <TabsTrigger value="spend">Spend</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-5">
            {isAdminOrOwner && (
              <Card className="p-5">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <h2 className="font-semibold flex items-center gap-2">
                    <UserPlus className="w-4 h-4" /> Invite a team member
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkOpen(true)}
                    disabled={remainingSlots <= 0}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Bulk CSV
                  </Button>
                </div>
                <p className="text-ds-11 text-muted-foreground mb-4">
                  They'll get full access to post and manage jobs on behalf of {business.business_name}.
                  All jobs are billed to your card on file.
                </p>
                <form onSubmit={handleInvite} className="flex gap-2">
                  <div className="flex-1 relative">
                    <Label htmlFor="invite-email" className="sr-only">
                      Email
                    </Label>
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="teammate@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      disabled={remainingSlots <= 0}
                      className={inviteEmailValid ? "pr-10" : undefined}
                    />
                    {inviteEmailValid && (
                      <Check
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    )}
                  </div>
                  <Button type="submit" disabled={inviting || remainingSlots <= 0 || !inviteEmailValid}>
                    {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Invite"}
                  </Button>
                </form>
                {remainingSlots <= 0 && (
                  <p className="text-ds-11 text-destructive mt-2">
                    You've reached your {SEAT_LIMIT}-seat limit. Upgrade your plan below to add more
                    members.
                  </p>
                )}
              </Card>
            )}

            {business.is_owner && (
              <Card className="p-5">
                <div className="flex items-start justify-between mb-3 gap-3">
                  <div>
                    <h2 className="font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> Seat plan
                    </h2>
                    <p className="text-ds-11 text-muted-foreground mt-1">
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
                      {openingPortal ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Manage
                        </>
                      )}
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
                        className={`rounded-ds-sm border p-3 ${
                          isCurrent ? "border-primary/50 bg-primary/5" : "border-border/60 bg-background/50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-medium text-ds-13">{tier.name}</p>
                            <p className="text-ds-11 text-muted-foreground">
                              {tier.seats} seats · {tier.price}
                            </p>
                          </div>
                          {isCurrent && <Badge className="text-ds-10 h-5">Current</Badge>}
                        </div>
                        {!isCurrent && (
                          <Button
                            variant={isUpgrade ? "default" : "outline"}
                            size="sm"
                            className="w-full h-8 text-ds-11"
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
              <h3 className="text-ds-13 font-semibold text-muted-foreground px-1">
                Team ({activeMembers.length})
              </h3>
              {membersLoading ? (
                <div className="flex justify-center my-8">
                  <HelprSpinner size={20} />
                </div>
              ) : membersError ? (
                <ErrorState
                  variant="inline"
                  title="Couldn't load your team."
                  body="Tap Try again to reload your team members."
                  onRetry={() => refetchMembers()}
                />
              ) : (
                <>
                  {activeMembers.map((m) => (
                    <Card key={m.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium truncate">{m.full_name || m.email || "Team member"}</p>
                            {m.role === "owner" && (
                              <Badge variant="secondary" className="text-ds-11 gap-1">
                                <Crown className="w-3 h-3" /> Owner
                              </Badge>
                            )}
                          </div>
                          {m.email && (
                            <p className="text-ds-11 text-muted-foreground truncate">{m.email}</p>
                          )}
                          {m.role !== "owner" && isAdminOrOwner ? (
                            <div className="mt-2 flex items-center gap-2">
                              <label
                                htmlFor={`role-${m.id}`}
                                className="text-ds-11 text-muted-foreground"
                              >
                                Role
                              </label>
                              <select
                                id={`role-${m.id}`}
                                value={m.extended_role}
                                onChange={(e) =>
                                  handleChangeRole(
                                    m.id,
                                    e.target.value as Exclude<ExtendedRole, "owner">,
                                  )
                                }
                                disabled={savingRole === m.id}
                                className="rounded-ds-sm border border-input bg-background px-2 py-1 text-ds-11"
                              >
                                {ROLE_SPECS.map((spec) => (
                                  <option key={spec.id} value={spec.id}>
                                    {spec.label}
                                  </option>
                                ))}
                              </select>
                              {savingRole === m.id && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                              )}
                            </div>
                          ) : (
                            m.role !== "owner" && (
                              <Badge variant="outline" className="mt-2 text-ds-10">
                                {ROLE_LABEL[m.extended_role]}
                              </Badge>
                            )
                          )}
                        </div>
                        {isAdminOrOwner && m.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRemoveTarget(m)}
                            aria-label="Remove team member"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}

                  {pendingMembers.length > 0 && (
                    <>
                      <h3 className="text-ds-13 font-semibold text-muted-foreground px-1 pt-4">
                        Pending invites ({pendingMembers.length})
                      </h3>
                      {pendingMembers.map((m) => (
                        <Card key={m.id} className="p-4 flex items-center justify-between bg-muted/30">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              <p className="font-medium truncate">{m.invited_email}</p>
                              <Badge variant="outline" className="text-ds-10">
                                {ROLE_LABEL[m.extended_role]}
                              </Badge>
                            </div>
                            <p className="text-ds-11 text-muted-foreground mt-0.5">
                              Will join when they sign up with this email
                            </p>
                          </div>
                          {isAdminOrOwner && (
                            <div className="flex items-center gap-1 shrink-0">
                              {m.invited_email && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleResendInvite(m.invited_email!)}
                                  aria-label="Resend invite email"
                                  title="Resend invite email"
                                >
                                  <Send className="w-4 h-4 text-muted-foreground" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setRemoveTarget(m)}
                                aria-label="Cancel pending invite"
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </Card>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="approvals">
            <ApprovalsTab businessId={business.business_id} canApprove={canApproveTab} />
          </TabsContent>

          <TabsContent value="spend">
            <SpendDashboardTab
              businessId={business.business_id}
              monthlyBudget={business.monthly_budget}
              monthlyBudgetAlertAt={business.monthly_budget_alert_at}
            />
          </TabsContent>

          <TabsContent value="activity">
            <ActivityFeedTab businessId={business.business_id} />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsTab
              businessId={business.business_id}
              isOwner={business.is_owner}
              initial={{
                require_approval_above: business.require_approval_above,
                require_2fa: business.require_2fa,
                default_payment_method_id: business.default_payment_method_id,
                monthly_budget: business.monthly_budget,
                monthly_budget_alert_at: business.monthly_budget_alert_at,
              }}
            />
          </TabsContent>
        </Tabs>

      <BulkInviteDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        businessId={business.business_id}
        invitedBy={user?.id ?? ""}
        remainingSlots={remainingSlots}
        onComplete={() => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.business.members(business.business_id),
          });
        }}
      />

      {removeTarget && (
        <ReassignMemberDialog
          open={!!removeTarget}
          onOpenChange={(o) => !o && setRemoveTarget(null)}
          businessId={business.business_id}
          fromUserId={removeTarget.user_id}
          fromDisplay={removeTarget.full_name || removeTarget.email || removeTarget.invited_email || "this teammate"}
          candidates={reassignCandidates}
          onConfirm={handleRemove}
        />
      )}
      </div>
    </BusinessLayout>
  );
};

export default BusinessTeam;
