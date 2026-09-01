import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, LifeBuoy, CheckCircle2, Clock, Crown, Mail } from "lucide-react";
import { toast } from "sonner";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { formatShortDate } from "@/lib/format";
import { report } from "@/lib/errorLogger";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminViewShell, AdminFilterStrip } from "@/components/admin/AdminViewShell";
import { TIER_PERKS, toSubscriptionTier, type SubscriptionTier } from "@/lib/subscriptionTiers";

type Ticket = {
  id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  reporter_name?: string;
  reporter_email?: string;
  /** Effective tier NOW, expiry folded in — never the raw column. */
  support_tier: SubscriptionTier;
};

/* ───────────────────────── Priority Support ─────────────────────────────
 *
 * "Priority Support" is a bullet on the $20 Elite card. Until now it was sold
 * and not built: neither this file nor `supabase/functions/contact-support`
 * contained a single tier, priority or SLA reference. This is the
 * implementation the owner chose — QUEUE ORDERING in this inbox, with the tier
 * on the row so an admin can see *why* something is at the top.
 *
 * It is deliberately NOT a stated response time. A published SLA you miss is
 * worse than no SLA, so nothing here — and nothing on the pricing card —
 * promises one. The perk is "you are seen first", not "you are answered by
 * 5pm".
 */

/**
 * Which tiers get the perk, DERIVED from `TIER_PERKS.dedicatedSupport` rather
 * than hardcoded to `"elite"`. The perk flag and the behaviour that satisfies
 * it then cannot drift: move `dedicatedSupport` to another tier and the queue
 * follows on the next render, with no second edit to remember.
 */
export const PRIORITY_SUPPORT_TIERS = (Object.keys(TIER_PERKS) as SubscriptionTier[])
  .filter(tier => TIER_PERKS[tier].dedicatedSupport);

/**
 * How much of a head start a priority ticket gets, in minutes (48h).
 *
 * THE ANTI-STARVATION DECISION. Sorting purely by tier starves free users
 * indefinitely: while any Elite ticket is open, no free ticket is ever the top
 * of the queue, and the person who has waited longest is the person least
 * likely to be helped. That is a support failure first and a trust problem
 * second, and it is worth deciding now rather than discovering at volume.
 *
 * So the rule is not a bucket, it is an EFFECTIVE ARRIVAL TIME: a priority
 * ticket sorts as though it had arrived 48h before it did. Consequences, all
 * intentional:
 *   • A fresh Elite ticket outranks every non-priority ticket younger than 48h
 *     — the perk is real and immediately visible.
 *   • A free ticket older than 48h outranks a fresh Elite one — nobody can be
 *     overtaken forever, and the bound is exact: no ticket is ever delayed by
 *     more than 48h beyond plain FIFO, however many Elite tickets arrive.
 *   • Within a tier it degenerates to FIFO, oldest first.
 *
 * 48h is chosen as "long enough that the perk matters over a normal weekday,
 * short enough that nothing rots over a weekend."
 */
export const PRIORITY_HEAD_START_MINUTES = 48 * 60;

/**
 * The effective tier of a support ticket's reporter, RIGHT NOW.
 *
 * Mirrors `tierFeePercent` (subscriptionTiers.ts) and `resolveEarlyAccessTier`
 * (earlyAccess.ts) exactly, including their shared convention that a NULL
 * `subscription_expires_at` means ACTIVE — the `expire-subscriptions` cron
 * nulls the TIER on lapse, so only a stamped PAST date means expired. An
 * expired Elite therefore sorts, and renders, as free: someone whose card
 * stopped clearing last month does not keep the perk. A stray legacy
 * `'business'` (tier retired 2026-09-01) falls to free through
 * `toSubscriptionTier` — the safe direction, since an unrecognised tier loses
 * a perk rather than being handed one.
 */
export function resolveSupportTier(
  rawTier: string | null | undefined,
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): SubscriptionTier {
  const expired = expiresAt ? new Date(expiresAt).getTime() < now : false;
  return toSubscriptionTier(expired ? "free" : (rawTier ?? "").toLowerCase());
}

export const hasPrioritySupport = (tier: SubscriptionTier) => TIER_PERKS[tier].dedicatedSupport;

/** Effective arrival time in ms — the single sort key. See the head-start note. */
export function supportPriorityAt(createdAt: string, tier: SubscriptionTier): number {
  const arrived = new Date(createdAt).getTime();
  if (Number.isNaN(arrived)) return Number.MAX_SAFE_INTEGER; // unparseable → sort last, never first
  return hasPrioritySupport(tier) ? arrived - PRIORITY_HEAD_START_MINUTES * 60_000 : arrived;
}

/**
 * The client-side twin of the `admin_support_queue` RPC's ORDER BY. Used on the
 * PGRST202 fallback path below; kept here (and unit-tested) so the two
 * definitions of "queue order" sit next to each other and can be compared.
 *
 * Open work above closed history; open ordered by effective arrival, oldest
 * first; closed ordered newest-first, because that list is history, not a
 * queue. `id` is the final tiebreak so identical timestamps cannot reshuffle
 * between refetches.
 */
export function sortSupportQueue(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const aOpen = a.status === "pending";
    const bOpen = b.status === "pending";
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) {
      const delta = supportPriorityAt(a.created_at, a.support_tier) - supportPriorityAt(b.created_at, b.support_tier);
      if (delta !== 0) return delta;
    } else {
      const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (delta !== 0) return delta;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * How long this ticket has been waiting, in the shortest honest unit.
 *
 * The row printed only `formatShortDate` ("Sep 1"), which cannot distinguish
 * two tickets that arrived nine hours apart — so with the queue now ordered by
 * age, the row gave the admin no way to see why one sat above the other. This
 * is the other half of "show why it is at the top": the gold badge explains a
 * priority row, this explains an old free one.
 *
 * It is a MEASUREMENT of elapsed time, not a promise about response time.
 */
export function waitingLabel(createdAt: string, now: number = Date.now()): string {
  const ms = now - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `waiting ${Math.max(minutes, 0)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `waiting ${hours}h`;
  return `waiting ${Math.floor(hours / 24)}d`;
}

/**
 * `reports.reason` → the topic chip on the row.
 *
 * There must be ONE branch per label that can actually be written, and the
 * fallback must mean only "this row's tag is not one we know". `[Other]` had
 * no branch, so every Other ticket fell to the generic "Support"/Mail
 * fallback — visually identical to a row whose prefix failed to parse. An
 * admin scanning the queue could not tell a topic the user deliberately chose
 * from a row the code did not understand, which is the one distinction this
 * function exists to make.
 *
 * The four labels a person can produce today come from `SUPPORT_TOPICS`
 * (`src/lib/supportTopics.ts`) — Admin Message / Suggestion / Issue Report /
 * Other. `Other` converges with `Admin Message` on the server (same
 * `messageLabel`, same `submitLabel`, same `reports` row), and the owner was
 * asked on 2026-08-31 whether to drop it and chose to KEEP all four. It is
 * staying by decision, so it has to be legible here.
 *
 * `[Help Request]` is the fifth and is legacy: the `help` topic was merged
 * into `message` in the UI long ago, but `supabase/functions/contact-support`
 * still maps a `help` payload to that label and still INSERTs a `reports` row
 * for a signed-in sender, so a bookmarked/in-flight guest submission can
 * genuinely land one. It keeps a branch, on `LifeBuoy` rather than
 * `HelpCircle` — `HelpCircle` is the icon `SupportInline`'s picker shows
 * beside "Other", so it belongs to the topic a person actually chose today,
 * not to the one nobody can choose any more. Two topics sharing one glyph is
 * the same illegibility as no branch at all.
 */
const categoryFromReason = (reason: string) => {
  if (reason.includes("[Admin Message]")) return { label: "Message", icon: <MessageSquarePlus className="w-4 h-4" /> };
  if (reason.includes("[Suggestion]")) return { label: "Suggestion", icon: <Lightbulb className="w-4 h-4" /> };
  if (reason.includes("[Issue Report]")) return { label: "Issue", icon: <AlertTriangle className="w-4 h-4" /> };
  if (reason.includes("[Other]")) return { label: "Other", icon: <HelpCircle className="w-4 h-4" /> };
  if (reason.includes("[Help Request]")) return { label: "Help", icon: <LifeBuoy className="w-4 h-4" /> };
  return { label: "Support", icon: <Mail className="w-4 h-4" /> };
};

const subjectFromReason = (reason: string) => reason.replace(/^\[.*?\]\s*/, "");

/** One row of `admin_support_queue`. Mirrors the RPC's RETURNS TABLE. */
type QueueRow = {
  id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  reporter_name: string | null;
  reporter_email: string | null;
  support_tier: string;
  priority_support: boolean;
  priority_at: string;
};

/** PostgREST's "function not found" — the migration hasn't reached this env yet. */
const isMissingRpc = (error: { code?: string | null } | null | undefined) => error?.code === "PGRST202";

type QueueFilter = "pending" | "resolved" | "all";

const AdminSupport = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [updating, setUpdating] = useState<string | null>(null);

  const queryKey = ["admin-support", filter];
  const { data: tickets, isInitialLoading, isError, refetch } = useInstantQuery<Ticket[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      /* WHY THE ORDER IS COMPUTED ON THE SERVER.
       *
       * This list has no `.limit()`, which makes a client-side sort look safe.
       * It is not. This project's PostgREST enforces db-max-rows = 1000
       * (measured on prod 2026-09-01: `notifications` holds 1619 rows and a
       * bare select returns `content-range: 0-999/1619`). An unbounded select
       * is therefore a SILENT `LIMIT 1000` applied AFTER the ORDER BY — so a
       * client sort would only have ordered the newest 1000 tickets, and the
       * rows it never saw are the OLDEST ones, i.e. exactly the tickets the
       * anti-starvation rule exists to rescue. The perk would have looked
       * broken precisely when the queue got busy, which is when it is sold.
       *
       * Ordering in SQL means the cap truncates the BOTTOM of the priority
       * queue — the only correct place to lose rows — and it keeps holding if
       * this list ever grows a `.range()`.
       *
       * The tier also cannot be sorted on from here without the join: it lives
       * on `profiles`, and `reports.reporter_id` has no FK to it, so there is
       * no PostgREST embed to order through. The RPC does the join, which also
       * collapses the old two-round-trip name hydration into one read.
       */
      // Cast through `never`: src/integrations/supabase/types.ts is a SNAPSHOT
      // regenerated from the database, and this RPC ships in the same commit as
      // the code calling it, so the snapshot cannot know it yet. Same pattern
      // and same reason as AdminPayoutBatches' get_payout_batch_job_ids call.
      // Drop the cast once types.ts is regenerated.
      const rpc = (await supabase.rpc("admin_support_queue" as never, {
        p_status: filter,
        p_priority_tiers: PRIORITY_SUPPORT_TIERS,
        p_head_start_minutes: PRIORITY_HEAD_START_MINUTES,
      } as never)) as { data: QueueRow[] | null; error: { message: string; code?: string } | null };

      if (!isMissingRpc(rpc.error)) {
        // unwrap() rather than `if (error) return []`: swallowing here made an
        // outage render as "No support tickets — Nobody has written in. That
        // is the good outcome." on a trust-and-safety queue — the one screen
        // where a silent empty list is indistinguishable from a healthy one.
        // Throwing flips React Query's isError, which the ErrorState branch
        // below renders.
        const rows = unwrap(rpc) ?? [];
        return rows.map(row => ({
          id: row.id,
          reporter_id: row.reporter_id,
          reason: row.reason,
          description: row.description,
          status: row.status,
          created_at: row.created_at,
          reporter_name: formatName(row.reporter_name, "Unknown"),
          reporter_email: row.reporter_email || "",
          support_tier: toSubscriptionTier(row.support_tier),
        }));
      }

      /* Deploy-lag fallback. Migrations land on merge to main via db-deploy.yml,
       * so between a deploy of this bundle and the migration reaching the DB the
       * RPC genuinely does not exist. PGRST202 is that window and only that
       * window — every other error still throws above. The fallback reads the
       * same two tables the old code did and applies `sortSupportQueue`, the
       * client twin of the RPC's ORDER BY, so the ordering is correct at any
       * queue size below the 1000-row cap. */
      report(rpc.error, { severity: "warning", tags: { source: "AdminSupport.rpcMissing" } });

      let query = supabase
        .from("reports")
        .select("*")
        .eq("reported_type", "support")
        .order("created_at", { ascending: false });
      if (filter === "pending") query = query.eq("status", "pending");
      if (filter === "resolved") query = query.neq("status", "pending");
      const data = unwrap(await query) ?? [];

      const userIds = [...new Set(data.map(r => r.reporter_id))];
      let profileMap = new Map<string, { full_name: string | null; email: string | null; subscription_tier: string | null; subscription_expires_at: string | null }>();
      if (userIds.length > 0) {
        // Secondary hydration read. Don't drop the error: on failure every row
        // silently renders the "Unknown" name AND the free tier — which would
        // look like real data (a queue with no Elite in it) rather than a
        // failed lookup. Report it, then still render the list; a missing
        // display name must not blank the whole surface.
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
          .in("user_id", userIds);
        if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminSupport.hydrateNames" } });
        profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
      }

      return sortSupportQueue(data.map(r => {
        const p = profileMap.get(r.reporter_id);
        return {
          ...r,
          reporter_name: formatName(p?.full_name, "Unknown"),
          reporter_email: p?.email || "",
          support_tier: resolveSupportTier(p?.subscription_tier, p?.subscription_expires_at),
        };
      }));
    },
  });

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    // .select("id"): a zero-row update returns error === null, and the ticket
    // would re-render as resolved while the row stayed open.
    let updated = true;
    try {
      unwrapMutation(
        await supabase.from("reports").update({ status }).eq("id", id).select("id"),
        {
          action: "update this ticket",
          rejectedMessage: "This ticket wasn't updated — someone else may have handled it. Refresh the queue.",
          context: { ticketId: id, status },
        },
      );
    } catch (err) {
      updated = false;
      toast.error(mutationErrorMessage(err, "Couldn't update that ticket — try again?"));
    }
    if (updated) {
      qc.invalidateQueries({ queryKey });
    }
    setUpdating(null);
  };

  return (
    <AdminViewShell>
      {/* Real Title Case text rather than CSS `capitalize` over the lowercase
          status key: `capitalize` only paints, so the accessible name stayed
          "pending"/"resolved" — the lowercase twins of the per-ticket
          "Resolve"/"Dismiss" action buttons below. Same fix as AdminReports. */}
      <AdminFilterStrip label="Filter tickets by status">
        {([
          { value: "pending", label: "Pending", icon: Clock },
          { value: "resolved", label: "Resolved", icon: CheckCircle2 },
          { value: "all", label: "All", icon: undefined },
        ] as const).map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className="shrink-0"
          >
            {Icon && <Icon className="w-3.5 h-3.5 mr-1" />}
            {label}
          </Button>
        ))}
      </AdminFilterStrip>

      {isInitialLoading ? (
        <p className="text-muted-foreground text-ds-11 py-8 text-center">Loading tickets…</p>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load the support queue."
          body="Tap Try again. No ticket is lost — this list is read straight from the reports table."
          onRetry={() => refetch()}
        />
      ) : tickets.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={Mail}
          title={filter !== "all" ? `No ${filter} tickets` : "No support tickets"}
          body={
            filter !== "all"
              ? "Nothing matches this filter — try All."
              : "Nobody has written in. That is the good outcome."
          }
        />
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const cat = categoryFromReason(ticket.reason);
            const subject = subjectFromReason(ticket.reason);
            const priority = hasPrioritySupport(ticket.support_tier);
            const waiting = ticket.status === "pending" ? waitingLabel(ticket.created_at) : "";
            return (
              <div key={ticket.id} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-ds-sm bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      {cat.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-ds-13 font-semibold text-foreground">{subject || "No subject"}</p>
                        <Badge variant="outline" className="text-ds-10 px-1.5 py-0">{cat.label}</Badge>
                        {/* WHY THIS ROW IS WHERE IT IS. The gold crown is the
                            same visual language the Elite `featuredBadge`
                            already uses elsewhere (JobPosterCard, HelperBadges),
                            so an admin reads "paying top tier" without a
                            legend. Deliberately says "Priority" and not a
                            duration: no response-time promise is made anywhere.
                            Decorative chip, not a control — no gloss owed. */}
                        {priority && (
                          <span
                            className="inline-flex items-center gap-1 shrink-0 rounded-full px-1.5 py-0.5 text-ds-10 font-semibold uppercase"
                            style={{
                              color: "hsl(var(--gold-ink))",
                              backgroundColor: "hsl(var(--gold-warm) / 0.14)",
                              letterSpacing: "0.06em",
                            }}
                          >
                            <Crown className="w-3 h-3" strokeWidth={2.25} aria-hidden="true" />
                            {TIER_PERKS[ticket.support_tier].name} · Priority
                          </span>
                        )}
                        {/* A paid tier WITHOUT the perk still shows, plainly.
                            Without it an admin cannot tell "not Elite" from
                            "not paying", and the gold chip's meaning is only
                            legible by contrast. An EXPIRED Elite resolves to
                            free above and so shows nothing here — correct: they
                            are not paying today. */}
                        {!priority && ticket.support_tier !== "free" && (
                          <Badge variant="outline" className="text-ds-10 px-1.5 py-0 shrink-0">
                            {TIER_PERKS[ticket.support_tier].name}
                          </Badge>
                        )}
                      </div>
                      <p className="text-ds-11 text-muted-foreground break-words">
                        {ticket.reporter_name}
                        {ticket.reporter_email && <span className="text-muted-foreground/60"> · {ticket.reporter_email}</span>}
                        {" · "}
                        {formatShortDate(ticket.created_at)}
                        {waiting && <span className="text-muted-foreground/60"> · {waiting}</span>}
                      </p>
                    </div>
                  </div>
                  {/* Calm "sienna" accent badge, not destructive: a pending
                      support ticket isn't a danger/delete action — the mauve
                      destructive color is reserved for genuinely destructive
                      controls. */}
                  <Badge variant={ticket.status === "pending" ? "sienna" : "secondary"} className="shrink-0 capitalize">
                    {ticket.status}
                  </Badge>
                </div>

                {ticket.description && (
                  <p className="text-ds-11 text-muted-foreground bg-muted/50 rounded-ds-sm p-3 whitespace-pre-wrap">{ticket.description}</p>
                )}

                {ticket.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => updateStatus(ticket.id, "resolved")}
                      disabled={updating === ticket.id}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatus(ticket.id, "dismissed")}
                      disabled={updating === ticket.id}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminViewShell>
  );
};

export default AdminSupport;
