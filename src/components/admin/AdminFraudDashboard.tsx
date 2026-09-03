import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { formatName } from "@/lib/utils";
import { formatCategory } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { logAdminAction } from "@/lib/adminAudit";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { unwrap } from "@/lib/supabaseResult";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";
import { report } from "@/lib/errorLogger";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import {
  Dialog,
  DialogPrimaryAction,
  DialogSecondaryAction,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";

interface FraudFlag {
  id: string;
  user_id: string;
  flag_type: string;
  details: string | null;
  job_id: string | null;
  resolved: boolean;
  created_at: string;
  user_name?: string;
}

// Only flag types SOMETHING ACTUALLY WRITES belong in this filter.
// `fast_completion` and `high_dispute_rate` were listed here and had zero
// writers anywhere in supabase/migrations or supabase/functions — so filtering
// to either always returned nothing, which on a fraud console reads as "no
// fast-completion fraud right now" rather than the truth, "this detector was
// never built". Re-add each the day a rule starts raising it.
const FLAG_TYPES = [
  { value: "all", label: "All Types" },
  { value: "off_platform_contact", label: "Off-Platform Contact" },
  { value: "referral_abuse", label: "Referral Abuse" },
  { value: "application_spam", label: "Application Spam" },
  { value: "review_manipulation", label: "Review Manipulation" },
  { value: "message_flooding", label: "Message Flooding" },
  { value: "scope_creep", label: "Scope Creep (3+ revisions)" },
  { value: "burst_job_posting", label: "Burst Job Posting" },
  { value: "multi_reporter_flag", label: "Multi-Reporter Pile-On" },
  { value: "rapid_cancellation_pattern", label: "Rapid Cancellation" },
  { value: "duplicate_content_posting", label: "Duplicate Content" },
];

const AdminFraudDashboard = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<FraudFlag | null>(null);

  const queryKey = ["admin-fraud-flags", filter, showResolved];
  const { data: flags, isInitialLoading, isError, refetch } = useInstantQuery<FraudFlag[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      let query = supabase.from("fraud_flags")
        .select("*")
        .eq("resolved", showResolved)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("flag_type", filter);

      const data = unwrap(await query);
      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((f: any) => f.user_id))];
      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminFraudDashboard.hydrateNames" } });

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      return data.map((f: any) => ({ ...f, user_name: formatName(nameMap.get(f.user_id), "Unknown") }));
    },
  });

  const resolveFlag = async (flag: FraudFlag) => {
    setResolving(flag.id);
    // .select("id"): a zero-row update returns error === null, and the flag
    // would vanish from the dashboard while staying unresolved in the table.
    let resolved = true;
    try {
      unwrapMutation(
        await supabase.from("fraud_flags").update({ resolved: true }).eq("id", flag.id).select("id"),
        {
          action: "resolve this fraud flag",
          rejectedMessage: "This flag wasn't resolved — it may have already been handled. Refresh the dashboard.",
          context: { flagId: flag.id, flagType: flag.flag_type },
        },
      );
    } catch (err) {
      resolved = false;
      toast.error(mutationErrorMessage(err, "Couldn't resolve that flag — try again."));
    }
    if (resolved) {
      await logAdminAction("resolve_fraud_flag", "fraud_flag", flag.id, { flag_type: flag.flag_type, user_id: flag.user_id });
      qc.invalidateQueries({ queryKey });
    }
    setResolving(null);
    setResolveTarget(null);
  };

  // Fraud flag types collapse to 3 severity tones — DANGER (money /
  // reputation risk), WARNING (behavior anomaly), INFO (informational
  // signal). Previously each flag hand-picked its own color from a
  // rainbow palette, producing 12 different shades for 12 flag types.
  // The audit's cohesion note was that "high_dispute_rate" (red-100
  // text-red-800) and "multi_reporter_flag" (also red-100 text-red-800)
  // were correctly the same color while "referral_abuse" (rose-100)
  // and "burst_job_posting" (rose-100) shared a fourth. Collapsed to
  // the shared tone map so all admin severity chips read the same.
  const flagTone: Record<string, Tone> = {
    off_platform_contact: "warning",
    fast_completion: "notice",
    high_dispute_rate: "danger",
    referral_abuse: "danger",
    application_spam: "info",
    review_manipulation: "danger",
    message_flooding: "warning",
    scope_creep: "warning",
    burst_job_posting: "warning",
    multi_reporter_flag: "danger",
    rapid_cancellation_pattern: "danger",
    duplicate_content_posting: "warning",
  };

  return (
    <AdminViewShell>
      {/* One card: the controls that scope the list sit in its header, the
          list is its body. Previously the type Select + Show-Resolved button
          floated right-aligned on a bare row of their own, so on a phone a
          lone pair of controls hung over a dead gutter with nothing tying
          them to the flags they filter. */}
      <AdminCard
        title={showResolved ? "Resolved Flags" : "Unresolved Flags"}
        subtitle="Automated risk signals raised against accounts."
        action={
          <>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger aria-label="Flag type" className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FLAG_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setShowResolved(!showResolved)}>
              {showResolved ? "Show Unresolved" : "Show Resolved"}
            </Button>
          </>
        }
      >
      {isInitialLoading ? (
        <p className="text-ds-11 text-muted-foreground">Loading flags…</p>
      ) : isError ? (
        /* A failed read must NOT fall through to the all-clear card below.
           Without this branch the fetcher's thrown error left the view showing
           "Nothing flagged — No unresolved fraud flags. That is the good
           outcome." on the platform's fraud console: the single most dangerous
           false reassurance in the admin surface. */
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the fraud flags."
          body="Tap Try again. Do not read this as all-clear — nothing was checked."
          onRetry={() => refetch()}
        />
      ) : flags.length === 0 ? (
        /* The shared EmptyState, like every other admin queue. This screen
           hand-rolled an icon-over-grey-line card, so the one view an admin
           most wants to read as "all clear" was the one that didn't look
           like its siblings. */
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={CheckCircle2}
          title={showResolved ? "No resolved flags" : "Nothing flagged"}
          body={
          showResolved
          ? "Nothing has been marked resolved yet — switch back to Show Unresolved."
          : "No unresolved fraud flags. That is the good outcome."
          }
        />
      ) : (
        <div className="space-y-2">
          {flags.map(flag => (
            <div key={flag.id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ds-13 text-foreground">{flag.user_name}</span>
                  <Badge className={toneBadgeClasses[flagTone[flag.flag_type] ?? "neutral"]}>
                    {formatCategory(flag.flag_type)}
                  </Badge>
                </div>
                {flag.details && (
                  <p className="text-ds-11 text-muted-foreground line-clamp-2">{flag.details}</p>
                )}
                <p className="text-ds-11 text-muted-foreground">
                  {formatDistanceToNow(new Date(flag.created_at), { addSuffix: true })}
                </p>
              </div>
              {!flag.resolved && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolving === flag.id}
                  onClick={() => setResolveTarget(flag)}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {resolving === flag.id ? "Resolving…" : "Resolve"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      </AdminCard>

      <Dialog open={!!resolveTarget} onOpenChange={(open) => { if (!open) setResolveTarget(null); }}>
        <DialogContent role="alertdialog">
          <DialogHero
            title="Mark This Flag Resolved?"
          />
          {/* WAS A `subtitle` PROP ON THE HERO — IT NEVER RENDERED.
              DialogHero has shown the title alone since the 2026-07-25 "one main
              title" decision, but it went on ACCEPTING `eyebrow`/`subtitle` and
              discarding them, so this sentence has been dead in the shipped bundle
              with no error, no warning and no type failure. Deleting the props from
              the type surfaced six of these in one compile. The copy is not
              decoration — it is the line that tells the reader what the button below
              is about to do — so it moves into the body, which is where the same
              decision already sent TipDialog's, ReviewForm's, InstantPayoutDialog's
              and W9CollectionDialog's. */}
          <DialogDescription>
            This clears it from the active queue. Use this once you've confirmed the flagged activity isn't fraud, or have already acted on it.
          </DialogDescription>
          <DialogFooter>
            <DialogSecondaryAction disabled={!!resolving}>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction onClick={() => resolveTarget && resolveFlag(resolveTarget)} disabled={!!resolving}>
              {resolving ? "Resolving…" : "Resolve"}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminViewShell>
  );
};

export default AdminFraudDashboard;
