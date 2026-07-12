/**
 * Family & care dashboard — document-scroll page at /family.
 *
 * Two views:
 *  1. Caregiver view — the adult child sees all care recipients they manage,
 *     with quick links to view/post jobs on their behalf.
 *  2. Care-recipient view — the senior sees who manages their jobs and can
 *     revoke access.
 *
 * Layout: PageHeader + min-h-screen bg-premium-page pb-safe-nav.
 * Not in AppShell — long-form content, document-scroll.
 */

import { useState } from "react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { unwrap } from "@/lib/supabaseResult";
import { hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Shield,
  MessageSquare,
} from "lucide-react";
import { fetchCareRelationships, fetchProfileStubs } from "./familyDashboard/queries";
import { CareRecipientCard } from "./familyDashboard/CareRecipientCard";
import { CaregiverCard } from "./familyDashboard/CaregiverCard";
import { InviteForm } from "./familyDashboard/InviteForm";

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function FamilyDashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  usePageTitle("Family & care — Helpr");

  const userId = user?.id ?? null;

  const relQuery = useQuery({
    queryKey: ["care_relationships", userId],
    queryFn: () => fetchCareRelationships(userId!),
    enabled: !!userId,
  });

  // Collect all counterpart user IDs to batch-fetch profile stubs
  const counterpartIds = [
    ...(relQuery.data?.asCaregiver.map((r) => r.care_recipient_id) ?? []),
    ...(relQuery.data?.asRecipient.map((r) => r.caregiver_id) ?? []),
  ];

  const profilesQuery = useQuery({
    queryKey: ["care_profile_stubs", counterpartIds],
    queryFn: () => fetchProfileStubs(counterpartIds),
    enabled: counterpartIds.length > 0,
  });

  const profileMap = Object.fromEntries(
    (profilesQuery.data ?? []).map((p) => [p.user_id, p])
  );

  const qc = useQueryClient();

  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  const revokeMut = useMutation({
    mutationFn: async (relationshipId: string) => {
      const res = unwrap(
        await supabase
          .from("care_relationships")
          .update({ status: "revoked" })
          .eq("id", relationshipId)
      );
      return res;
    },
    onSuccess: () => {
      setPendingRevokeId(null);
      hapticSuccess();
      toast.success("Access removed.");
      void qc.invalidateQueries({ queryKey: ["care_relationships", userId] });
    },
    onError: (err: Error) => {
      report(err, { severity: "warning", tags: { source: "FamilyDashboard.revoke" } });
      toast.error("Couldn't remove access — try again.");
    },
  });

  const asCaregiver = relQuery.data?.asCaregiver ?? [];
  const asRecipient = relQuery.data?.asRecipient ?? [];

  // Resolve the display name for the confirm-dialog without re-fetching.
  // profileMap only contains counterpart profiles (never self), so
  // whichever of the two ID slots isn't the current user will have a hit.
  const pendingRevokeRel = pendingRevokeId
    ? [...asCaregiver, ...asRecipient].find((r) => r.id === pendingRevokeId)
    : null;
  const pendingRevokeName =
    (pendingRevokeRel
      ? (profileMap[pendingRevokeRel.care_recipient_id]?.full_name ??
         profileMap[pendingRevokeRel.caregiver_id]?.full_name)
      : null) ?? "this person";

  return (
    <>
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Family & care" onBack={() => navigate(-1)} width="lg" showBrand rightSlot={<NotificationPanel />} />

      {/* Split-column desktop layout: on mobile/tablet this stacks as a
          single column exactly as before. At lg+ it becomes a two-column
          grid — the members lists take the wide reading column on the
          left, and the invite form + about-panel are pulled into a
          sticky action pane on the right. Outer container widens to
          max-w-5xl/6xl to give the two columns real breathing room. */}
      <div className="max-w-lg lg:max-w-5xl xl:max-w-6xl mx-auto px-4 pt-4 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 xl:gap-12 items-start">

        {/* ── LEFT COLUMN — members lists ──
            Primary reading content: who you manage, and (if applicable)
            who manages jobs on your behalf. */}
        <div className="lg:col-span-7 space-y-6 min-w-0">

          {/* ── Caregiver section — always shown so the user can see the
              empty state even if they aren't managing anyone yet. The
              invite affordance itself moved to the right column at lg+;
              on mobile it renders inline at the bottom of this section
              so the single-column flow is unchanged. ── */}
          <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
                <h2 className="font-display italic font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
                  Managing jobs for
                </h2>
              </div>

              {relQuery.isLoading && (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-24 rounded-ds-md" />
                  ))}
                </div>
              )}

              {!relQuery.isLoading && relQuery.isError && (
                <ErrorState
                  variant="inline"
                  title="Couldn't load your family connections."
                  body="Tap Try again to reload who you're managing jobs for."
                  onRetry={() => relQuery.refetch()}
                />
              )}

              {!relQuery.isLoading && !relQuery.isError && asCaregiver.length === 0 && (
                <p className="text-ds-13 font-serif italic px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  You're not managing jobs for anyone yet.
                </p>
              )}

              {asCaregiver.map((rel) => (
                <CareRecipientCard
                  key={rel.id}
                  relationship={rel}
                  recipientProfile={profileMap[rel.care_recipient_id]}
                  onRevokeAccess={setPendingRevokeId}
                />
              ))}

              {/* Invite form — mobile/tablet only. At lg+ this component
                  is rendered in the sticky right column instead so the
                  action pane always has a send-invite affordance in view. */}
              {userId && (
                <div className="lg:hidden">
                  <InviteForm myUserId={userId} />
                </div>
              )}
          </section>

          {/* ── Recipient section — who manages my jobs ── */}
          {asRecipient.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" style={{ color: "hsl(var(--sage))" }} />
                <h2 className="font-display italic font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
                  Your family helper
                </h2>
              </div>
              <p className="text-ds-12 font-serif italic -mt-1 px-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                These people can view and post jobs on your behalf.
              </p>
              {asRecipient.map((rel) => (
                <CaregiverCard
                  key={rel.id}
                  relationship={rel}
                  caregiverProfile={profileMap[rel.caregiver_id]}
                  onRevokeAccess={setPendingRevokeId}
                />
              ))}
            </section>
          )}

          {/* ── About section — mobile/tablet only. Duplicated in the
              right column at lg+ where it sits below the invite form. ── */}
          <div
            className="lg:hidden rounded-ds-md p-4 flex gap-3"
            style={{
              background: "hsl(var(--bark) / 0.04)",
              border: "0.5px solid hsl(var(--bark) / 0.1)",
            }}
          >
            <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(var(--bark) / 0.5)" }} />
            <p className="text-ds-12 font-serif italic leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Family members you invite can view jobs, post new jobs, and message helpers on your behalf.
              You can remove their access at any time.
            </p>
          </div>

        </div>

        {/* ── RIGHT COLUMN — sticky action pane (lg+ only) ──
            Invite form and the about/help snippet. Sticky so the primary
            call-to-action stays in view as the members list scrolls. The
            column itself is hidden below lg — its contents render inline
            in the left column at those breakpoints. */}
        <aside className="hidden lg:block lg:col-span-5 space-y-5 lg:sticky lg:top-6 lg:self-start">
          {userId && <InviteForm myUserId={userId} />}

          <div
            className="rounded-ds-md p-4 flex gap-3"
            style={{
              background: "hsl(var(--bark) / 0.04)",
              border: "0.5px solid hsl(var(--bark) / 0.1)",
            }}
          >
            <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(var(--bark) / 0.5)" }} />
            <p className="text-ds-12 font-serif italic leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Family members you invite can view jobs, post new jobs, and message helpers on your behalf.
              You can remove their access at any time.
            </p>
          </div>
        </aside>

      </div>
    </div>

    <BrandConfirmDialog
      open={pendingRevokeId !== null}
      onOpenChange={(open) => { if (!open) setPendingRevokeId(null); }}
      title="Remove access?"
      description={`${pendingRevokeName} will no longer be able to view or post jobs on your behalf.`}
      primaryLabel={revokeMut.isPending ? "Removing…" : "Remove access"}
      primaryTone="sienna"
      primaryHaptic="warning"
      primaryDisabled={revokeMut.isPending}
      onPrimary={(e) => {
        e.preventDefault();
        if (pendingRevokeId) revokeMut.mutate(pendingRevokeId);
      }}
      secondaryLabel="Keep access"
    />
    </>
  );
}
