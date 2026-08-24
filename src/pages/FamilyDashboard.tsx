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

import { useEffect, useState } from "react";
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
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserPlus,
  Shield,
  MessageSquare,
} from "lucide-react";
import { fetchCareRelationships, fetchProfileStubs } from "./familyDashboard/queries";
import { CareRecipientCard } from "./familyDashboard/CareRecipientCard";
import { CaregiverCard } from "./familyDashboard/CaregiverCard";
import { InviteForm } from "./familyDashboard/InviteForm";

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function FamilyDashboard() {
  const { user } = useCurrentUser();
  usePageTitle("Family & care — Helpr");

  const userId = user?.id ?? null;

  const relQuery = useQuery({
    queryKey: ["care_relationships", userId],
    queryFn: () => fetchCareRelationships(userId!),
    enabled: !!userId,
  });

  // Collect all counterpart user IDs to batch-fetch profile stubs.
  // Deduped: the same person can appear on both sides of a pair of
  // relationships, and a duplicate id would otherwise be sent twice in the
  // .in() filter AND change the React Query key — splitting the cache for
  // what is the same request.
  const counterpartIds = [
    ...new Set([
      ...(relQuery.data?.asCaregiver.map((r) => r.care_recipient_id) ?? []),
      ...(relQuery.data?.asRecipient.map((r) => r.caregiver_id) ?? []),
    ]),
  ];

  const profilesQuery = useQuery({
    queryKey: ["care_profile_stubs", counterpartIds],
    queryFn: () => fetchProfileStubs(counterpartIds),
    enabled: counterpartIds.length > 0,
  });

  const profileMap = Object.fromEntries(
    (profilesQuery.data ?? []).map((p) => [p.user_id, p])
  );

  // Never drop the Supabase error. On failure every card falls back to the
  // generic "Your family member" label — which looks like a profile with no
  // name rather than a lookup that failed. Report it, and (below) say so.
  useEffect(() => {
    if (profilesQuery.isError) {
      report(profilesQuery.error, {
        severity: "warning",
        tags: { source: "FamilyDashboard.profile_stubs" },
        context: { user_id: userId, counterpart_count: counterpartIds.length },
      });
    }
    // Report once per distinct failure, not on every render.
  }, [profilesQuery.isError, profilesQuery.error, userId, counterpartIds.length]);

  // Names are missing AND there are people whose names we should have shown.
  const namesFailed = profilesQuery.isError && counterpartIds.length > 0;

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

  // Nobody managed yet, and we know that for a fact — not mid-load, not a
  // failed fetch. Drives the whole empty treatment: the "Managing jobs for"
  // heading stands down (a section header over nothing reads as a rendering
  // fault), and the empty state takes over the invite call to action so the
  // page doesn't offer the same thing twice.
  const caregiverEmpty =
    !relQuery.isLoading && !relQuery.isError && asCaregiver.length === 0;

  // Lifted out of InviteForm so the empty state's CTA can open it. Shared by
  // the mobile-inline and desktop-aside instances — only one is ever visible.
  const [inviteOpen, setInviteOpen] = useState(false);

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
    {/* `/family` STAYS document-scroll and keeps its DOCUMENT_SCROLL_ROUTES
        entry. The deciding factor is the lg+ layout below: a two-column grid
        whose right pane is `lg:sticky lg:top-6`. Sticky positions against the
        nearest scrolling ancestor, so moving this page into AppShell's
        internal scroll container (which is what PageScaffold would do) would
        change what that pane sticks to, for no gain.

        Header + page structure match the other Profile sub-pages (/pets is
        the reference): a plain back-chevron + serif title on the page
        background via <PageHeader>, and the member/empty-state cards sitting
        directly on that background. The title-card + panel treatment this
        page used to carry wrapped the header in a card AND wrapped the
        content in a second one — the card-in-a-card the owner flagged.

        Geometry is the CANONICAL Profile sub-screen ladder, shared verbatim
        with the Profile tab bodies (Profile.tsx) and PageHeader's `default`
        width: max-w-5xl → lg:6xl → xl:7xl → 2xl:90rem on px-5 → lg:px-8 →
        xl:px-12. This page used to carry its own tighter ladder (a max-w-lg
        mobile cap on a px-4 gutter that NARROWED to lg:px-4 on desktop), so
        it sat in a visibly different column from every sibling. */}
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Family & Care"
        backTo="/profile"
      />

      <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8">
      {/* Split-column desktop layout: on mobile/tablet this stacks as a
          single column exactly as before. At lg+ it becomes a two-column
          grid — the members lists take the wide reading column on the
          left, and the invite form + about-panel are pulled into a
          sticky action pane on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 xl:gap-12 items-start">

        {/* ── LEFT COLUMN — members lists ──
            Primary reading content: who you manage, and (if applicable)
            who manages jobs on your behalf. */}
        <div className="lg:col-span-7 space-y-6 min-w-0">

          {/* Name lookup failed — the relationships below are real and intact,
              but every card is showing a placeholder label. Say that plainly
              rather than let "Your family member" read as a nameless profile. */}
          {namesFailed && (
            <p
              className="text-ds-12 font-serif italic px-1"
              style={{ color: "hsl(var(--burnt-sienna) / 0.85)" }}
            >
              Couldn't load names right now, so the cards below show a placeholder.
              Everyone's access is unchanged.{" "}
              <button
                type="button"
                onClick={() => void profilesQuery.refetch()}
                disabled={profilesQuery.isFetching}
                className="underline underline-offset-2 disabled:opacity-60"
              >
                Try Again
              </button>
            </p>
          )}

          {/* ── Caregiver section — always shown so the user can see the
              empty state even if they aren't managing anyone yet. The
              invite affordance itself moved to the right column at lg+;
              on mobile it renders inline at the bottom of this section
              so the single-column flow is unchanged. ── */}
          <section className="space-y-3">
              {/* Heading only when there IS a list to label — see caregiverEmpty. */}
              {!caregiverEmpty && (
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
                  <h2 className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
                    Managing jobs for
                  </h2>
                </div>
              )}

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
                  title="We couldn't load your family connections."
                  body="Tap Try again to reload who you're managing jobs for."
                  onRetry={() => void relQuery.refetch()}
                  retryDisabled={relQuery.isFetching}
                />
              )}

              {/* The old empty line just stated the absence and stopped, with
                  the explanation stranded in a grey box further down and the
                  invite affordance in between. One card now does all three:
                  what's missing, why the feature exists, and the way in.
                  At lg+ the invite form opens in the sticky aside, so this
                  card has to stay put or the left column goes blank; below lg
                  the form opens inline right here and this steps aside. */}
              {caregiverEmpty && (
                <div className={inviteOpen ? "hidden lg:block" : undefined}>
                  <EmptyState
                    variant="inline"
                    icon={Users}
                    eyebrow="Just you, so far"
                    title="No family members yet"
                    body="Invite someone you help look after — a parent, a grandparent, a neighbor. Once they approve, you can post jobs, message helpers, and follow the work on their behalf. You can remove your access any time."
                    action={
                      <BarkPillButton onClick={() => setInviteOpen(true)}>
                        <UserPlus className="w-4 h-4 mr-1.5" />
                        Add a family member
                      </BarkPillButton>
                    }
                  />
                </div>
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
                  action pane always has a send-invite affordance in view.
                  Its slot in the tree is deliberately fixed across the empty
                  and populated branches: creating an invite flips the list to
                  non-empty, and a moved slot would remount the form and lose
                  the one-time invite link it is holding. */}
              {userId && (
                <div className="lg:hidden">
                  <InviteForm
                    myUserId={userId}
                    open={inviteOpen}
                    onOpenChange={setInviteOpen}
                    showTrigger={!caregiverEmpty}
                  />
                </div>
              )}
          </section>

          {/* ── Recipient section — who manages my jobs ── */}
          {asRecipient.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" style={{ color: "hsl(var(--sage))" }} />
                <h2 className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
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

          {/* The mobile-only "about" box that used to sit here is gone: it
              described inviting someone, directly beneath a button that also
              described inviting someone. Its copy now lives inside the empty
              state above, where it does work instead of restating the button.
              (It also had the relationship backwards — inviting makes YOU the
              caregiver, so it is you who can act on their behalf, not them on
              yours.) The richer "What family accounts unlock" panel still runs
              in the desktop aside. */}

        </div>

        {/* ── RIGHT COLUMN — sticky action pane (lg+ only) ──
            Invite form and the about/help snippet. Sticky so the primary
            call-to-action stays in view as the members list scrolls. The
            column itself is hidden below lg — its contents render inline
            in the left column at those breakpoints. */}
        <aside className="hidden lg:block lg:col-span-5 space-y-5 lg:sticky lg:top-6 lg:self-start">
          {userId && (
            <InviteForm
              myUserId={userId}
              open={inviteOpen}
              onOpenChange={setInviteOpen}
              showTrigger={!caregiverEmpty}
            />
          )}

          {/* Educational panel — explains what family accounts unlock so
              the right pane isn't just an invite form + hint. Fills the
              empty-state real estate on a wide desktop when the user has
              no family members yet. Icons + short benefit lines. */}
          <div
            className="rounded-ds-md p-5 space-y-4"
            style={{
              background: "hsl(var(--bark) / 0.04)",
              border: "0.5px solid hsl(var(--bark) / 0.1)",
            }}
          >
            <h3
              className="font-display font-bold text-ds-15 leading-tight"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              What family accounts unlock
            </h3>
            <ul className="space-y-3">
              {[
                {
                  Icon: Users,
                  title: "Post & manage jobs on their behalf",
                  desc: "An adult child can hire a Helpr for an aging parent — same protected payment, same reviews, same trust.",
                },
                {
                  Icon: MessageSquare,
                  title: "Message helpers directly",
                  desc: "Coordinate arrivals and check on progress without handing off phone numbers.",
                },
                {
                  Icon: Shield,
                  title: "Full audit trail",
                  desc: "See every job, message, and payment. Revoke access anytime from this page.",
                },
              ].map(({ Icon, title, desc }) => (
                <li key={title} className="flex gap-3">
                  <Icon
                    className="w-4 h-4 mt-0.5 shrink-0"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0">
                    <p
                      className="font-sans font-semibold text-ds-13 leading-snug"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {title}
                    </p>
                    <p
                      className="mt-1 font-serif italic text-ds-12 leading-snug"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {desc}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>

      </div>
      </div>
    </div>

    <BrandConfirmDialog
      open={pendingRevokeId !== null}
      onOpenChange={(open) => { if (!open) setPendingRevokeId(null); }}
      title="Remove Access?"
      description={`${pendingRevokeName} will no longer be able to view or post jobs on your behalf. Jobs they already posted stay on your account exactly as they are — nothing is cancelled.`}
      primaryLabel={revokeMut.isPending ? "Removing…" : "Remove Access"}
      primaryTone="sienna"
      primaryHaptic="warning"
      primaryDisabled={revokeMut.isPending}
      onPrimary={(e) => {
        e.preventDefault();
        if (pendingRevokeId) revokeMut.mutate(pendingRevokeId);
      }}
      secondaryLabel="Keep Access"
    />
    </>
  );
}
