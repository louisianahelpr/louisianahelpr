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
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { unwrap } from "@/lib/supabaseResult";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserPlus,
  ChevronRight,
  Shield,
  Briefcase,
  MessageSquare,
  CheckCircle2,
  Clock,
  X,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CareRelationship {
  id: string;
  caregiver_id: string;
  care_recipient_id: string;
  relationship: string;
  permissions: string[];
  status: string;
  invite_token: string | null;
  created_at: string;
}

interface ProfileStub {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

async function fetchCareRelationships(userId: string): Promise<{
  asCaregiver: CareRelationship[];
  asRecipient: CareRelationship[];
}> {
  const [cgRes, crRes] = await Promise.all([
    supabase
      .from("care_relationships")
      .select("*")
      .eq("caregiver_id", userId)
      .neq("status", "revoked"),
    supabase
      .from("care_relationships")
      .select("*")
      .eq("care_recipient_id", userId)
      .neq("status", "revoked"),
  ]);
  // CLAUDE.md: never drop the Supabase error
  if (cgRes.error) throw cgRes.error;
  if (crRes.error) throw crRes.error;
  return {
    asCaregiver: (cgRes.data ?? []) as CareRelationship[],
    asRecipient: (crRes.data ?? []) as CareRelationship[],
  };
}

async function fetchProfileStubs(userIds: string[]): Promise<ProfileStub[]> {
  if (!userIds.length) return [];
  const res = await supabase
    .from("profiles")
    .select("user_id, full_name, avatar_url")
    .in("user_id", userIds);
  if (res.error) throw res.error;
  return (res.data ?? []) as ProfileStub[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** A single card for one care-recipient that this caregiver manages. */
function CareRecipientCard({
  relationship,
  recipientProfile,
  onRevokeAccess,
}: {
  relationship: CareRelationship;
  recipientProfile: ProfileStub | undefined;
  onRevokeAccess: (id: string) => void;
}) {
  const navigate = useNavigate();
  const name = recipientProfile?.full_name ?? "Your family member";
  const isPending = relationship.status === "pending";

  return (
    <div
      className="rounded-ds-md overflow-hidden"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
        boxShadow: "0 1px 4px hsl(var(--olivewood) / 0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 text-ds-14 font-display italic font-bold"
          style={{
            background: "hsl(var(--bark) / 0.12)",
            color: "hsl(var(--bark))",
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display italic font-semibold text-ds-15 truncate" style={{ color: "hsl(var(--ink-deep))" }}>
            {name}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            {isPending ? (
              <>
                <Clock className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} />
                <span className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--gold-warm))" }}>
                  Invite pending
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" style={{ color: "hsl(var(--sage))" }} />
                <span className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--sage))" }}>
                  Active
                </span>
              </>
            )}
          </div>
        </div>
        <button
          aria-label="Remove access"
          onClick={() => onRevokeAccess(relationship.id)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-50 active:scale-95 transition-all"
          style={{ color: "hsl(var(--destructive))" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Actions — only shown when relationship is active */}
      {!isPending && (
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={() => {
              hapticLight();
              navigate(`/my-posts?for=${relationship.care_recipient_id}`);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-ds-sm text-ds-12 font-sans font-medium transition-all active:scale-[0.98]"
            style={{
              background: "hsl(var(--bark) / 0.08)",
              color: "hsl(var(--bark))",
            }}
          >
            <Briefcase className="w-3.5 h-3.5" />
            View jobs
          </button>
          <button
            onClick={() => {
              hapticLight();
              navigate(`/post-job?for=${relationship.care_recipient_id}`);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-ds-sm text-ds-12 font-sans font-medium transition-all active:scale-[0.98]"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.1)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Post job
          </button>
        </div>
      )}

      {/* Pending — show invite copy link */}
      {isPending && relationship.invite_token && (
        <div className="px-4 pb-4">
          <button
            onClick={() => {
              hapticLight();
              const url = `${window.location.origin}/family/accept/${relationship.invite_token}`;
              void navigator.clipboard.writeText(url).then(() => {
                toast.success("Invite link copied!");
              });
            }}
            className="w-full flex items-center justify-center gap-1.5 h-9 rounded-ds-sm text-ds-12 font-sans font-medium transition-all active:scale-[0.98]"
            style={{
              background: "hsl(var(--gold-warm) / 0.1)",
              color: "hsl(var(--gold-warm))",
            }}
          >
            Copy invite link
          </button>
        </div>
      )}
    </div>
  );
}

/** Card shown to the senior (care recipient) listing their caregivers. */
function CaregiverCard({
  relationship,
  caregiverProfile,
  onRevokeAccess,
}: {
  relationship: CareRelationship;
  caregiverProfile: ProfileStub | undefined;
  onRevokeAccess: (id: string) => void;
}) {
  const name = caregiverProfile?.full_name ?? "A family member";
  const isPending = relationship.status === "pending";

  return (
    <div
      className="rounded-ds-md p-4"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
        boxShadow: "0 1px 4px hsl(var(--olivewood) / 0.06)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 text-ds-14 font-display italic font-bold"
          style={{ background: "hsl(var(--sage) / 0.14)", color: "hsl(var(--sage))" }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display italic font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
            {name}
          </p>
          <p className="text-ds-12 font-serif italic mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {isPending ? "Invite sent — waiting for your approval" : "Manages your jobs"}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {relationship.permissions.map((p) => (
              <span
                key={p}
                className="text-ds-10 font-sans px-2 py-0.5 rounded-full"
                style={{
                  background: "hsl(var(--bark) / 0.08)",
                  color: "hsl(var(--bark))",
                }}
              >
                {p.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
        <button
          aria-label="Remove access"
          onClick={() => onRevokeAccess(relationship.id)}
          className="mt-0.5 flex items-center gap-1 h-8 px-2.5 rounded-full text-ds-12 font-sans font-medium active:scale-95 transition-all"
          style={{
            background: "hsl(var(--destructive) / 0.08)",
            color: "hsl(var(--destructive))",
          }}
        >
          <X className="w-3.5 h-3.5" />
          Remove
        </button>
      </div>
    </div>
  );
}

// ─── Invite form ─────────────────────────────────────────────────────────────

function InviteForm({ myUserId }: { myUserId: string }) {
  const [contact, setContact] = useState("");
  const [relationship, setRelationship] = useState("child");
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();

  const inviteMut = useMutation({
    mutationFn: async () => {
      const token = crypto.randomUUID();
      // Look up the care recipient by email (case-insensitive)
      const lookupRes = await supabase
        .from("profiles")
        .select("user_id")
        .ilike("email", contact.trim())
        .maybeSingle();
      if (lookupRes.error) throw lookupRes.error;

      if (!lookupRes.data) {
        // No existing account — store a pending invite with token only;
        // when they sign up and visit the link, they can accept.
        throw new Error(
          "No account found for that email. Ask them to sign up first, then share the invite link."
        );
      }

      const recipientId = lookupRes.data.user_id;
      const res = await supabase.from("care_relationships").insert({
        caregiver_id: myUserId,
        care_recipient_id: recipientId,
        relationship,
        permissions: ["view_jobs", "post_jobs", "message_helpers"],
        status: "pending",
        invite_token: token,
      });
      if (res.error) throw res.error;
      return token;
    },
    onSuccess: (token) => {
      hapticSuccess();
      const url = `${window.location.origin}/family/accept/${token}`;
      void navigator.clipboard.writeText(url).then(() => {
        toast.success("Invite sent — link copied to clipboard!");
      });
      setContact("");
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: ["care_relationships", myUserId] });
    },
    onError: (err: Error) => {
      report(err, { severity: "warning", tags: { source: "FamilyDashboard.invite" } });
      toast.error(err.message || "Couldn't send invite — try again.");
    },
  });

  if (!showForm) {
    return (
      <button
        onClick={() => { hapticLight(); setShowForm(true); }}
        className="w-full flex items-center gap-2.5 h-12 px-4 rounded-ds-md text-ds-14 font-sans font-medium active:scale-[0.98] transition-all"
        style={{
          background: "hsl(var(--bark) / 0.06)",
          border: "0.5px dashed hsl(var(--bark) / 0.3)",
          color: "hsl(var(--bark))",
        }}
      >
        <UserPlus className="w-4 h-4" />
        Add a family member
        <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
      </button>
    );
  }

  return (
    <div
      className="rounded-ds-md p-4 space-y-3"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
      }}
    >
      <p className="font-display italic font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
        Invite a family member
      </p>
      <p className="text-ds-12 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Enter their email. They'll get an invite link to approve your access.
      </p>
      <Input
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder="Email address"
        type="email"
        inputMode="email"
        autoComplete="email"
        className="h-11"
        aria-label="Family member email address"
      />
      <div className="flex gap-2">
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          aria-label="Relationship to family member"
          className="flex-1 h-11 rounded-ds-sm px-3 text-ds-13 font-sans border"
          style={{
            background: "hsl(var(--ivory-sand))",
            borderColor: "hsl(var(--sand))",
            color: "hsl(var(--ink-deep))",
          }}
        >
          <option value="child">Child</option>
          <option value="spouse">Spouse</option>
          <option value="sibling">Sibling</option>
          <option value="friend">Friend</option>
          <option value="professional_caregiver">Professional caregiver</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 h-11"
          onClick={() => setShowForm(false)}
          disabled={inviteMut.isPending}
        >
          Cancel
        </Button>
        <Button
          className="flex-1 h-11"
          onClick={() => inviteMut.mutate()}
          disabled={!contact.trim() || inviteMut.isPending}
        >
          {inviteMut.isPending ? "Sending…" : "Send invite"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function FamilyDashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  usePageTitle("Family & care");

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

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Family & care" onBack={() => navigate(-1)} showBrand rightSlot={<NotificationPanel />} />

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-6">

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
                onRevokeAccess={(id) => revokeMut.mutate(id)}
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
                onRevokeAccess={(id) => revokeMut.mutate(id)}
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
  );
}
