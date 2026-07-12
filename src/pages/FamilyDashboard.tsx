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

      <div className="max-w-lg lg:max-w-4xl mx-auto px-4 pt-4 space-y-6">

        {/* ── Caregiver section — always shown so the user can add a
            family member even if they aren't managing anyone yet. ── */}
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

            {/* Invite form — always shown in caregiver section */}
            {userId && <InviteForm myUserId={userId} />}
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

        {/* ── About section ── */}
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
