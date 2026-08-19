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
// The Members tab UI, the seat-tier table, the members query, and the
// shared types now live under src/pages/businessTeam/ (behavior-
// preserving split); this file owns state, effects, and handlers.
//
// All new schema bits ship in migration 20260609170000_business_team_roles.sql.
// Migrations don't auto-deploy on prod, so every new RPC / column has a
// PGRST202 / PGRST204 fallback inline.

import { useEffect, useState, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BusinessLayout from "@/components/business/BusinessLayout";
import { Sparkles, ShieldAlert } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticError } from "@/lib/haptics";
import { useMyBusiness, type SeatTier, type ExtendedRole } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import BusinessVerificationCard from "@/components/business/BusinessVerificationCard";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import BusinessNoAccountState from "@/components/business/BusinessNoAccountState";
import { queryKeys } from "@/lib/queryKeys";
import BulkInviteDialog from "@/components/business/BulkInviteDialog";
// SpendDashboardTab statically imports recharts (~267 kB raw / 83 kB gzip).
// The "Spend" tab is not the default view, so defer the chunk until the
// user actually clicks it — matching the pattern used for ProfileStatsTrend,
// KpiSparkline, and AdminAnalyticsCharts.
const SpendDashboardTab = lazy(() => import("@/components/business/SpendDashboardTab"));
import ApprovalsTab from "@/components/business/ApprovalsTab";
import ActivityFeedTab from "@/components/business/ActivityFeedTab";
import SettingsTab from "@/components/business/SettingsTab";
import ReassignMemberDialog, { type ReassignTarget } from "@/components/business/ReassignMemberDialog";
import { ROLE_LABEL, canApprove, canManageTeam } from "@/components/business/roles";
import { TIERS } from "./businessTeam/businessTeamHelpers";
import { useTeamMembers } from "./businessTeam/useTeamMembers";
import MembersTab from "./businessTeam/MembersTab";
import type { Member, TabValue } from "./businessTeam/types";

const BusinessTeam = () => {
  usePageTitle("Manage Team — Helpr Business");
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

  // The seat-subscription sync that used to live here has moved up into
  // BusinessLayout, which wraps every /business/* page. Keeping it here as well
  // would fire it twice on this page, and leaving it ONLY here was the bug: an
  // owner who never opened Team never had their discounted fee tier applied.

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
  } = useTeamMembers(business);

  if (businessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <HelprSpinner size={32} />
      </div>
    );
  }

  if (!business) {
    return <BusinessNoAccountState title="Manage team" />;
  }

  const activeMembers = members?.filter((m) => m.status === "active") ?? [];
  const pendingMembers = members?.filter((m) => m.status === "pending") ?? [];
  // Already the EFFECTIVE cap — useMyBusiness folds `businesses.extra_seats`
  // (the negotiated "+" on Enterprise, migration 20260818150000) into
  // seat_limit, so the meter, `remainingSlots` and the invite gate below all
  // match what enforce_business_member_limit() will actually allow.
  const SEAT_LIMIT = business.seat_limit;
  const extraSeats = business.extra_seats;
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

  const handleUpgrade = async (tier: SeatTier, interval: "month" | "year" = "month") => {
    if (tier === "starter") {
      return handleManageBilling();
    }
    setUpgrading(tier);
    try {
      // `interval` reaches create-business-seat-checkout, which resolves the
      // annual Price separately per tier. It used to send `{ tier }` alone, so
      // the function always fell back to its "month" default and annual was
      // unreachable from the UI no matter what Prices existed in Stripe.
      const { data, error } = await supabase.functions.invoke("create-business-seat-checkout", {
        body: { tier, interval },
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
      meta={`${totalSlots} of ${SEAT_LIMIT} seats used`}
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Badge variant="sienna" className="text-ds-11 gap-1">
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
            <MembersTab
              businessName={business.business_name}
              isOwner={business.is_owner}
              isAdminOrOwner={isAdminOrOwner}
              currentTier={currentTier}
              SEAT_LIMIT={SEAT_LIMIT}
              extraSeats={extraSeats}
              totalSlots={totalSlots}
              remainingSlots={remainingSlots}
              activeMembers={activeMembers}
              pendingMembers={pendingMembers}
              membersLoading={membersLoading}
              membersError={membersError}
              refetchMembers={refetchMembers}
              inviteEmail={inviteEmail}
              setInviteEmail={setInviteEmail}
              inviteEmailValid={inviteEmailValid}
              inviting={inviting}
              openingPortal={openingPortal}
              upgrading={upgrading}
              savingRole={savingRole}
              onBulkOpen={() => setBulkOpen(true)}
              onInvite={handleInvite}
              onResendInvite={handleResendInvite}
              onChangeRole={handleChangeRole}
              onUpgrade={handleUpgrade}
              onManageBilling={handleManageBilling}
              onRemoveTarget={setRemoveTarget}
            />
          </TabsContent>

          <TabsContent value="approvals">
            <ApprovalsTab businessId={business.business_id} canApprove={canApproveTab} />
          </TabsContent>

          <TabsContent value="spend">
            <Suspense fallback={<div className="flex justify-center py-12"><HelprSpinner size={32} /></div>}>
              <SpendDashboardTab
                businessId={business.business_id}
                monthlyBudget={business.monthly_budget}
                monthlyBudgetAlertAt={business.monthly_budget_alert_at}
              />
            </Suspense>
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
