import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { mutationErrorMessage } from "@/lib/mutationResult";
import { setProfileBanStatus } from "@/lib/adminBanStatus";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { toneBadgeClasses } from "@/components/admin/tones";

/**
 * Q1324 (owner, 2026-10-05): the two ban-evasion queues an admin decides.
 *
 * 1. BAN SETTLEMENT REVIEWS. A card / bank match bans an account at once, but
 *    its jobs are NOT settled until an admin decides ("ban now, admin
 *    settles"). Each review lists every job the settlement would act on
 *    (admin_ban_settlement_reviews), and the banned account's ban details the
 *    match points at. Confirm runs the normal settlement
 *    (admin_confirm_ban_settlement); Lift unbans through the one ban write path
 *    (admin-user-actions set_ban_status), which closes the review, releases the
 *    payout hold and clears the match server-side.
 * 2. POSSIBLE MATCHES. A new or changed account whose name, phone (same last
 *    7 digits, Q1416) or ID (same name + date of birth with another document,
 *    Q1416) matches a banned account's. A doubt check, never a ban. Kept in admin-only
 *    ban_evasion_matches, never in fraud_flags: those are exported to the
 *    person, and a flag appearing after they typed a name would tell them the
 *    name belongs to a banned account.
 */

/** The soft (doubt-check) match kinds and how each is named to an admin. */
const DOUBT_CHECK_LABEL = {
  name: "Same name",
  phone: "Same phone number",
  phone_near: "Same last 7 phone digits",
  identity_near: "Same name and date of birth on ID",
} as const;
const DOUBT_CHECK_KINDS = Object.keys(DOUBT_CHECK_LABEL) as Array<keyof typeof DOUBT_CHECK_LABEL>;

interface MatchRow {
  id: string;
  matched_on: string;
  original_ban_status: string | null;
  original_reason: string | null;
  original_recorded_at: string | null;
}
interface ReviewJob {
  id: string;
  title: string | null;
  status: string;
  payment_status: string | null;
  role: "poster" | "helpr";
}
interface Review {
  review_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  ban_status: string | null;
  matched_on: string;
  created_at: string;
  matches: MatchRow[];
  jobs: ReviewJob[];
  /** Q1413: the harshest standing a strike earned DURING the review would have set. */
  deferred_ban_status?: string | null;
  deferred_suspended_until?: string | null;
  /** Q1413: every strike recorded since the review opened. */
  strikes_during_review?: Array<{ id: string; violation_type: string; description: string | null; job_id: string | null; created_at: string }>;
}

/** Q1413: how a deferred standing reads to the admin deciding. */
const deferredLabel = (r: Review): string | null => {
  switch (r.deferred_ban_status) {
    case "final_warning":
      return "a final warning";
    case "temp_banned":
      return r.deferred_suspended_until
        ? `a suspension until ${new Date(r.deferred_suspended_until).toLocaleString()}`
        : "a suspension";
    case "banned":
    case "permanently_banned":
      return "a ban";
    default:
      return null;
  }
};
interface NameMatch extends MatchRow {
  user_id: string;
  created_at: string;
}

const REVIEWS_KEY = ["admin-ban-settlement-reviews"] as const;
const NAMES_KEY = ["admin-ban-evasion-name-matches"] as const;

function originalBan(m: MatchRow): string {
  const when = m.original_recorded_at ? ` (recorded ${new Date(m.original_recorded_at).toLocaleDateString()})` : "";
  return `${m.original_ban_status ?? "banned"}: ${m.original_reason ?? "no reason on file"}${when}`;
}

export function AdminBanEvasionReview() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ userId: string; action: "confirm" | "lift" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reviews = useQuery({
    queryKey: REVIEWS_KEY,
    meta: { persist: false },
    queryFn: async () => (unwrap(await supabase.rpc("admin_ban_settlement_reviews")) ?? []) as unknown as Review[],
  });
  const names = useQuery({
    queryKey: NAMES_KEY,
    meta: { persist: false },
    queryFn: async () =>
      unwrap(
        await supabase
          .from("ban_evasion_matches")
          .select("id, user_id, matched_on, original_ban_status, original_reason, original_recorded_at, created_at")
          // Q1416: every doubt-check kind (never the auto-ban kinds).
          .in("matched_on", [...DOUBT_CHECK_KINDS])
          // An auto-ban ('phone' at signup, card, bank) is a review above, not a doubt-check.
          .eq("auto_banned", false)
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(100),
      ) as NameMatch[],
  });

  const decide = async (review: Review, action: "confirm" | "lift") => {
    setBusy(review.user_id);
    try {
      if (action === "confirm") {
        unwrap(await supabase.rpc("admin_confirm_ban_settlement", { p_user_id: review.user_id }));
        toast.success("Ban confirmed. The account's jobs were settled.");
      } else {
        const applied = await setProfileBanStatus({
          userId: review.user_id,
          banStatus: "active",
          suspendedUntil: null,
          rejectedMessage: "This account wasn't unbanned — it may have changed. Refresh and try again.",
        });
        // Q1413: the lift keeps a standing earned during the review; say so.
        if (applied.appliedBanStatus === "temp_banned") {
          toast.success(
            `Review lifted. A suspension earned during the review applies${applied.appliedSuspendedUntil ? ` until ${new Date(applied.appliedSuspendedUntil).toLocaleString()}` : ""}; the account's jobs carry on and its payouts are released.`,
          );
        } else if (applied.appliedBanStatus === "final_warning") {
          toast.success("Ban lifted with the final warning earned during the review. The account's jobs carry on and its payouts are released.");
        } else {
          toast.success("Ban lifted. The account's jobs carry on and its payouts are released.");
        }
      }
      await qc.invalidateQueries({ queryKey: REVIEWS_KEY });
    } catch (err) {
      toast.error(
        action === "confirm"
          ? rpcErrorMessage("admin_confirm_ban_settlement", err) ?? mutationErrorMessage(err, "Couldn't confirm the ban — try again.")
          : mutationErrorMessage(err, "Couldn't lift the ban — try again."),
      );
    } finally {
      setBusy(null);
      setPending(null);
    }
  };

  const resolveName = async (m: NameMatch) => {
    setBusy(m.id);
    try {
      // Server-side and audited (admin_resolve_ban_evasion_match); false = an
      // admin already marked it, which is the end state asked for.
      unwrap(await supabase.rpc("admin_resolve_ban_evasion_match", { p_match_id: m.id }));
      await qc.invalidateQueries({ queryKey: NAMES_KEY });
    } catch (err) {
      toast.error(
        rpcErrorMessage("admin_resolve_ban_evasion_match", err) ?? mutationErrorMessage(err, "Couldn't mark that match checked — try again."),
      );
    } finally {
      setBusy(null);
    }
  };

  const rows = reviews.data ?? [];
  const nameRows = names.data ?? [];
  // One gate for both lists, so the two cards arrive in one paint.
  const listsLoading = reviews.isLoading || names.isLoading;

  return (
    <>
      <AdminCard
        title="Ban settlement reviews"
        subtitle="Accounts banned automatically on a banned person's card or bank. Their jobs wait for you: nothing is cancelled, charged or refunded until you decide."
      >
        {listsLoading ? (
          <p className="text-ds-11 text-muted-foreground">Loading reviews…</p>
        ) : reviews.isError ? (
          <ErrorState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            title="We couldn't load the ban settlement reviews."
            body={
              rpcErrorMessage("admin_ban_settlement_reviews", reviews.error) ??
              "Tap Try again. Do not read this as all-clear — nothing was checked."
            }
            onRetry={() => reviews.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-ds-11 text-muted-foreground">No accounts waiting for a decision.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.review_id} className="rounded-lg border border-border p-3 space-y-2" data-testid="ban-settlement-review">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ds-13">{r.full_name || r.email || r.user_id}</span>
                  <Badge className={toneBadgeClasses.danger}>Matched on {r.matched_on}</Badge>
                  <span className="text-ds-11 text-muted-foreground">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </span>
                </div>
                {r.matches.map((m) => (
                  <p key={m.id} className="text-ds-11 text-muted-foreground whitespace-pre-line">
                    Banned account it matched — {originalBan(m)}
                  </p>
                ))}
                {(r.strikes_during_review?.length ?? 0) > 0 && (
                  <div className="space-y-1" data-testid="ban-review-strikes">
                    <p className="text-ds-11 font-medium">Strikes recorded during this review ({r.strikes_during_review!.length})</p>
                    <ul className="text-ds-11 text-muted-foreground list-disc pl-4">
                      {r.strikes_during_review!.map((v) => (
                        <li key={v.id}>
                          {v.violation_type.replace(/_/g, " ")}
                          {v.description ? `: ${v.description}` : ""}
                          {v.job_id ? ` (job ${v.job_id})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {deferredLabel(r) && (
                  <p className="text-ds-11 text-muted-foreground" data-testid="ban-review-deferred">
                    Those strikes earned {deferredLabel(r)}. Lifting the ban applies it (the stricter of it and an unban); reverse a strike first if it was unfair, such as a no-show on a job that started while this account was banned.
                  </p>
                )}
                <p className="text-ds-11 font-medium">Jobs waiting ({r.jobs.length})</p>
                {r.jobs.length > 0 && (
                  <ul className="text-ds-11 text-muted-foreground list-disc pl-4">
                    {r.jobs.map((j) => (
                      <li key={j.id}>
                        {j.title || "Untitled job"} — {j.role === "poster" ? "they posted it" : "they are the Helpr"}, {j.status}
                        {j.payment_status ? `, ${j.payment_status}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {pending?.userId === r.user_id ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={pending.action === "confirm" ? "destructive" : "default"} disabled={busy === r.user_id} onClick={() => decide(r, pending.action)}>
                      {pending.action === "confirm" ? `Yes, settle ${r.jobs.length} job${r.jobs.length === 1 ? "" : "s"} now` : "Yes, lift the ban"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.user_id} onClick={() => setPending(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="destructive" onClick={() => setPending({ userId: r.user_id, action: "confirm" })}>
                      Confirm ban
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPending({ userId: r.user_id, action: "lift" })}>
                      Lift ban
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard
        title="Possible matches"
        subtitle="New or changed accounts whose name, phone (last 7 digits) or ID (name and date of birth) matches a banned person's. Not banned: check whether it is the same person."
      >
        {listsLoading ? (
          <p className="text-ds-11 text-muted-foreground">Loading matches…</p>
        ) : names.isError ? (
          <ErrorState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            title="We couldn't load the possible matches."
            body="Tap Try again. Do not read this as all-clear — nothing was checked."
            onRetry={() => names.refetch()}
          />
        ) : nameRows.length === 0 ? (
          <p className="text-ds-11 text-muted-foreground">No possible matches to check.</p>
        ) : (
          <ul className="space-y-2">
            {nameRows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3" data-testid="ban-evasion-name-match">
                <div className="space-y-1">
                  <p className="text-ds-12 font-medium">Account {m.user_id}</p>
                  <p className="text-ds-11 font-medium">
                    {DOUBT_CHECK_LABEL[m.matched_on as keyof typeof DOUBT_CHECK_LABEL] ?? m.matched_on}
                  </p>
                  <p className="text-ds-11 text-muted-foreground whitespace-pre-line">Banned account it matched — {originalBan(m)}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => resolveName(m)}>
                  Mark checked
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}
