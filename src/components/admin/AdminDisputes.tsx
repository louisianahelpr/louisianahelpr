import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Clock, AlertTriangle, Flame, Scale, History } from "lucide-react";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";

interface DisputedJob {
  id: string;
  title: string;
  budget: number;
  status: string;
  dispute_reason: string | null;
  dispute_evidence_urls: string[];
  disputed_at: string | null;
  disputed_by: string | null;
  customer_id: string;
  helper_id: string | null;
  stripe_payment_intent_id: string | null;
}

/** Row in the formal `public.disputes` table — null when the dispute
 *  predates the migration and we're reading from jobs.dispute_*. */
interface DisputeRecord {
  id: string;
  job_id: string;
  opener_id: string;
  reason: string;
  evidence_urls: string[];
  status: "open" | "decided" | "withdrawn";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_text: string | null;
  payout_split: { poster?: number; helper?: number } | null;
}

type FilterTab = "open" | "decided";
type AgeFilter = "all" | "0-24h" | "1-7d" | "7-30d" | ">30d";
type PartyFilter = "all" | "poster" | "helper";
type CategoryFilter = "all" | string;

const AdminDisputes = () => {
  const [disputes, setDisputes] = useState<DisputedJob[]>([]);
  const [decidedJobs, setDecidedJobs] = useState<DisputedJob[]>([]);
  const [disputeRecords, setDisputeRecords] = useState<Record<string, DisputeRecord>>({});
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ job: DisputedJob; action: "release" | "refund" } | null>(null);

  // Filter tab — Open is the working queue; Decided is an audit log.
  const [filter, setFilter] = useState<FilterTab>("open");
  // Cross-cutting filters (only applied to Open; Decided audit isn't
  // filtered so the admin can scan the full recent history).
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [partyFilter, setPartyFilter] = useState<PartyFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  // Per-job decision panel state (key = job.id). Tracks decision text +
  // payout split slider position (0 = full poster, 100 = full helper).
  // Mounting one panel per visible row would be wasteful, so we lazily
  // expand a single job and store its draft state.
  const [activePanelJobId, setActivePanelJobId] = useState<string | null>(null);
  const [decisionText, setDecisionText] = useState("");
  // Slider position 0..100 represents the helper's share (the helper
  // is the side the slider points toward by convention — "in their
  // favour"). Poster share = 100 - helper share.
  const [helperShare, setHelperShare] = useState<number>(50);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  const loadDisputes = useCallback(async () => {
    setLoading(true);
    // Load both buckets in parallel — the queue stays responsive when
    // an admin switches tabs.
    const [openRes, decidedRes] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, title, budget, status, customer_id, helper_id, stripe_payment_intent_id, dispute_reason, dispute_evidence_urls, disputed_at, disputed_by")
        .eq("status", "disputed")
        .order("disputed_at", { ascending: false }),
      supabase
        .from("jobs")
        .select("id, title, budget, status, customer_id, helper_id, stripe_payment_intent_id, dispute_reason, dispute_evidence_urls, disputed_at, disputed_by, dispute_resolved_at")
        .not("dispute_resolved_at", "is", null)
        .order("dispute_resolved_at", { ascending: false })
        .limit(50),
    ]);

    if (openRes.error) {
      report(openRes.error, { tags: { source: "AdminDisputes.loadOpen" } });
      toast.error("Failed to load disputes");
      setLoading(false);
      return;
    }
    if (decidedRes.error) {
      // Decided list isn't blocking — surface the error but keep the
      // open queue rendering.
      report(decidedRes.error, { tags: { source: "AdminDisputes.loadDecided" } });
    }

    const openJobs = (openRes.data || []) as unknown as DisputedJob[];
    const decided = ((decidedRes.data || []) as unknown as DisputedJob[]);

    // Pull formal dispute records for every visible job in one query.
    // Falls back silently when the disputes table doesn't exist yet
    // (PGRST205 / 42P01) — the legacy jobs.dispute_* columns drive the
    // view in that case.
    const allJobIds = [...openJobs.map((j) => j.id), ...decided.map((j) => j.id)];
    const recordsMap: Record<string, DisputeRecord> = {};
    if (allJobIds.length > 0) {
      const { data: records, error: recordsErr } = await (supabase.from as any)("disputes")
        .select("id, job_id, opener_id, reason, evidence_urls, status, created_at, decided_at, decided_by, decision_text, payout_split")
        .in("job_id", allJobIds);
      if (recordsErr && recordsErr.code !== "PGRST205" && recordsErr.code !== "42P01") {
        report(recordsErr, { tags: { source: "AdminDisputes.loadRecords" } });
      }
      for (const r of (records as DisputeRecord[] | null) ?? []) {
        // One row per job — if multiple exist (re-files), keep the
        // most recent.
        if (!recordsMap[r.job_id] || new Date(r.created_at) > new Date(recordsMap[r.job_id].created_at)) {
          recordsMap[r.job_id] = r;
        }
      }
    }
    setDisputeRecords(recordsMap);

    // Load profile names and subscription tiers for priority sorting
    const userIds = [
      ...new Set(
        [...openJobs, ...decided].flatMap((j) => [j.customer_id, j.helper_id, j.disputed_by].filter(Boolean) as string[]),
      ),
    ];
    const tMap: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: profs, error: profsErr } = await supabase.from("profiles").select("user_id, full_name, subscription_tier").in("user_id", userIds);
      if (profsErr) report(profsErr, { tags: { source: "AdminDisputes.loadProfiles" } });
      const map: Record<string, string> = {};
      profs?.forEach((p) => {
        map[p.user_id] = formatName(p.full_name);
        tMap[p.user_id] = p.subscription_tier;
      });
      setProfiles(map);
      setTiers(tMap);
    }

    // Priority Dispute Resolution. Tiering rules (most important first):
    //   1. Chargeback-risk disputes (>5 days) — Stripe lets card issuers
    //      reverse the charge directly past this window, costing the
    //      platform the dispute fee + the original transaction. These
    //      MUST be at the top regardless of subscriber tier.
    //   2. Stale disputes (>48h) — about to become chargeback risk.
    //   3. Elite/Pro/Basic subscriber priority (the existing tier sort).
    //   4. Within each tier, oldest first.
    const tierPriority = (uid: string | null) => {
      if (!uid) return 0;
      const t = tMap[uid];
      return t === "elite" ? 3 : t === "pro" ? 2 : t === "basic" ? 1 : 0;
    };
    const ageHours = (j: DisputedJob): number => {
      if (!j.disputed_at) return 0;
      return (Date.now() - new Date(j.disputed_at).getTime()) / 3600_000;
    };
    const sorted = openJobs.sort((a, b) => {
      const aAge = ageHours(a);
      const bAge = ageHours(b);
      const aChargeback = aAge > 120; // 5 days
      const bChargeback = bAge > 120;
      if (aChargeback !== bChargeback) return aChargeback ? -1 : 1;
      const aStale = aAge > 48;
      const bStale = bAge > 48;
      if (aStale !== bStale) return aStale ? -1 : 1;
      const aMax = Math.max(tierPriority(a.customer_id), tierPriority(a.helper_id));
      const bMax = Math.max(tierPriority(b.customer_id), tierPriority(b.helper_id));
      if (aMax !== bMax) return bMax - aMax;
      return bAge - aAge; // older first within the same priority bucket
    });

    setDisputes(sorted);
    setDecidedJobs(decided);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDisputes();
  }, [loadDisputes]);

  // SLA badge — green/amber/red based on time since the dispute was filed.
  // Past 5 days the customer can chargeback through their card issuer
  // bypassing our resolution flow, so we surface that as a hot warning.
  const slaBadge = (disputedAt: string | null) => {
    if (!disputedAt) return null;
    const hours = (Date.now() - new Date(disputedAt).getTime()) / 3600_000;
    if (hours > 120) {
      return (
        <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold uppercase tracking-wide">
          <Flame className="w-3 h-3" /> Chargeback risk · {Math.floor(hours / 24)}d
        </span>
      );
    }
    if (hours > 48) {
      return (
        <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold uppercase tracking-wide">
          <AlertTriangle className="w-3 h-3" /> Stale · {Math.floor(hours / 24)}d
        </span>
      );
    }
    if (hours > 24) {
      return (
        <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium uppercase tracking-wide">
          <Clock className="w-3 h-3" /> {Math.floor(hours)}h
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase tracking-wide">
        <Clock className="w-3 h-3" /> Fresh · {Math.floor(hours)}h
      </span>
    );
  };

  const resolveDispute = async (job: DisputedJob, action: "release" | "refund") => {
    setResolving(job.id);
    try {
      if (action === "release") {
        // Release payment to helpr — invoke create-payment with release action
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_release_dispute", jobId: job.id },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success("Payment released to helpr. Dispute resolved.");
      } else {
        // Refund to customer — cancel the payment intent
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_refund_dispute", jobId: job.id },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success("Payment refunded to customer. Dispute resolved.");
      }
      loadDisputes();
    } catch (err: any) {
      toast.error(err.message || "Failed to resolve dispute");
    } finally {
      setResolving(null);
    }
  };

  // Record the formal decision (text + split). Optionally fire the
  // matching Stripe action when the split is 100/0 — anything in
  // between is recorded but the actual money split is admin-handled
  // out-of-band (Stripe's API doesn't natively model a partial-split
  // refund on a Connect destination charge; the platform doesn't have
  // a webhook for it either). We surface that in the toast.
  const decide = async (job: DisputedJob) => {
    if (!decisionText.trim()) {
      toast.error("Add a decision note first");
      return;
    }
    setSubmittingDecision(true);
    try {
      const payoutSplit = {
        poster: (100 - helperShare) / 100,
        helper: helperShare / 100,
      };

      // Try the formal RPC. Cast through `any` until `supabase gen
      // types` reflects the new migration. PGRST202 = not deployed
      // yet (migrations don't auto-deploy per CLAUDE.md), in which
      // case we fall back to a direct UPDATE that records the
      // decision on the legacy `dispute_resolved_at` column so this
      // works between merge and the manual `supabase db push`.
      const { error: rpcError } = await (supabase.rpc as any)(
        "rpc_decide_dispute",
        {
          _dispute_id: disputeRecords[job.id]?.id ?? null,
          _decision_text: decisionText.trim(),
          _payout_split: payoutSplit,
        },
      );

      if (rpcError && rpcError.code !== "PGRST202") {
        // The disputes table may not exist yet (PGRST205) — fall back
        // to writing dispute_resolved_at on the job row + nothing
        // else. The decision text isn't persisted in that case but
        // the dispute is at least marked closed.
        if (rpcError.code !== "PGRST205" && rpcError.code !== "42P01") {
          throw rpcError;
        }
      }

      if (rpcError) {
        // Legacy fallback — set the resolution timestamp + new job
        // status. payout split + decision text aren't surfaced
        // anywhere in this path, but the dispute is at least closed.
        const newStatus = helperShare === 0 ? "cancelled" : "completed";
        const { error } = await supabase
          .from("jobs")
          .update({ status: newStatus, dispute_resolved_at: new Date().toISOString() })
          .eq("id", job.id);
        if (error) throw error;
      }

      // Optionally trigger the matching Stripe action for the
      // unambiguous 100/0 cases. Splits are recorded but not
      // auto-executed.
      if (helperShare === 100) {
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_release_dispute", jobId: job.id },
        });
        if (error || data?.error) {
          // Surfacing the Stripe failure but the decision is already
          // recorded — surface as a warning so the admin can retry the
          // payout out-of-band.
          toast.warning("Decision recorded, but Stripe payout failed — retry manually.");
        } else {
          toast.success("Decision recorded. Payment released to helpr.");
        }
      } else if (helperShare === 0) {
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_refund_dispute", jobId: job.id },
        });
        if (error || data?.error) {
          toast.warning("Decision recorded, but Stripe refund failed — retry manually.");
        } else {
          toast.success("Decision recorded. Payment refunded to poster.");
        }
      } else {
        toast.success(`Decision recorded. Move the ${helperShare}/${100 - helperShare} split in Stripe manually.`);
      }

      // Reset the panel + reload list.
      setActivePanelJobId(null);
      setDecisionText("");
      setHelperShare(50);
      loadDisputes();
    } catch (err: any) {
      toast.error(err.message || "Failed to record decision");
    } finally {
      setSubmittingDecision(false);
    }
  };

  const openDecisionPanel = (job: DisputedJob) => {
    setActivePanelJobId(job.id);
    setDecisionText("");
    setHelperShare(50);
  };

  if (loading) return <p className="text-muted-foreground">Loading disputes…</p>;

  // Categorise the dispute reason into rough buckets driven by the
  // keywords each helpr / poster types when filing. Cheap heuristic —
  // it's better than nothing for triaging the queue but should be
  // replaced with a structured `dispute_category` column long-term.
  const categoriseReason = (reason: string | null | undefined): string => {
    const r = (reason || "").toLowerCase();
    if (!r) return "other";
    if (/no[-\s]?show|didn'?t show|didnt show|never arrived/.test(r)) return "no_show";
    if (/quality|incomplete|sloppy|poor|bad job|not done/.test(r)) return "quality";
    if (/payment|charge|refund|money|paid/.test(r)) return "payment";
    if (/damage|broke|broken|stained|ruined/.test(r)) return "damage";
    if (/abusive|harass|rude|threat|safety/.test(r)) return "behaviour";
    if (/late|delay|arrived/.test(r)) return "timing";
    return "other";
  };
  const CATEGORY_LABELS: Record<string, string> = {
    no_show: "No-show",
    quality: "Work quality",
    payment: "Payment",
    damage: "Damage",
    behaviour: "Behaviour",
    timing: "Timing",
    other: "Other",
  };

  const passesAge = (j: DisputedJob): boolean => {
    if (ageFilter === "all" || !j.disputed_at) return true;
    const hours = (Date.now() - new Date(j.disputed_at).getTime()) / 3600_000;
    if (ageFilter === "0-24h") return hours < 24;
    if (ageFilter === "1-7d") return hours >= 24 && hours < 24 * 7;
    if (ageFilter === "7-30d") return hours >= 24 * 7 && hours < 24 * 30;
    if (ageFilter === ">30d") return hours >= 24 * 30;
    return true;
  };
  const passesParty = (j: DisputedJob): boolean => {
    if (partyFilter === "all" || !j.disputed_by) return true;
    if (partyFilter === "poster") return j.disputed_by === j.customer_id;
    if (partyFilter === "helper") return !!j.helper_id && j.disputed_by === j.helper_id;
    return true;
  };
  const passesCategory = (j: DisputedJob): boolean => {
    if (categoryFilter === "all") return true;
    const reason = disputeRecords[j.id]?.reason ?? j.dispute_reason;
    return categoriseReason(reason) === categoryFilter;
  };

  const baseList = filter === "open" ? disputes : decidedJobs;
  const filteredList = filter === "open"
    ? baseList.filter((j) => passesAge(j) && passesParty(j) && passesCategory(j))
    : baseList;
  const list = filteredList;

  // Renders one card. Shared between Open and Decided so the visual
  // layout stays consistent; resolution actions only appear for Open.
  const renderCard = (job: DisputedJob) => {
    const record = disputeRecords[job.id];
    const isActivePanel = activePanelJobId === job.id;
    const helperName = job.helper_id ? profiles[job.helper_id] || "Unknown" : null;
    const posterName = profiles[job.customer_id] || "Unknown";

    return (
      <div key={job.id} className="rounded-ds-md border border-destructive/30 bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground">{job.title}</h3>
              {filter === "open" && slaBadge(job.disputed_at)}
              {filter === "decided" && (
                <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wide">
                  <CheckCircle2 className="w-3 h-3" /> Decided
                </span>
              )}
              {[job.customer_id, job.helper_id].some((id) => id && tiers[id] === "elite") && (
                <span className="text-ds-10 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">💎 Priority</span>
              )}
            </div>
            <p className="text-ds-11 text-muted-foreground">${job.budget}</p>
            <p className="text-ds-11 text-muted-foreground mt-1">
              Customer: <span className="font-medium text-foreground">{posterName}</span>
              {helperName && <> · Helpr: <span className="font-medium text-foreground">{helperName}</span></>}
            </p>
            {job.disputed_at && (
              <p className="text-ds-11 text-muted-foreground">
                Disputed {new Date(job.disputed_at).toLocaleDateString()} by {profiles[job.disputed_by || ""] || "Unknown"}
              </p>
            )}
          </div>
        </div>

        {/* Timeline — keeps both parties' contributions visible in one place. */}
        <div className="space-y-2">
          <div className="p-3 rounded-ds-sm bg-destructive/5 border border-destructive/20">
            <p className="text-ds-13 text-foreground font-medium flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Filed
              {record && (
                <span className="ml-1 text-ds-10 text-muted-foreground">
                  · {new Date(record.created_at).toLocaleString()}
                </span>
              )}
            </p>
            {(record?.reason ?? job.dispute_reason) && (
              <p className="text-ds-11 text-muted-foreground mt-1 italic">
                "{record?.reason ?? job.dispute_reason}"
              </p>
            )}
          </div>

          {(record?.evidence_urls?.length ?? job.dispute_evidence_urls?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <p className="text-ds-11 font-medium text-muted-foreground">Evidence photos:</p>
              <div className="flex gap-2 flex-wrap">
                {(record?.evidence_urls ?? job.dispute_evidence_urls ?? []).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-ds-sm overflow-hidden border border-border hover:border-primary transition-colors">
                    <img loading="lazy" decoding="async" src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {record?.decided_at && (
            <div className="p-3 rounded-ds-sm bg-primary/5 border border-primary/20">
              <p className="text-ds-13 text-foreground font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Decided
                <span className="ml-1 text-ds-10 text-muted-foreground">
                  · {new Date(record.decided_at).toLocaleString()}
                </span>
              </p>
              {record.decision_text && (
                <p className="text-ds-11 text-muted-foreground mt-1 italic">"{record.decision_text}"</p>
              )}
              {record.payout_split && (
                <p className="text-ds-11 text-muted-foreground mt-1">
                  Split: poster <span className="font-semibold text-foreground tabular-nums">{Math.round((record.payout_split.poster ?? 0) * 100)}%</span>
                  {" · "}
                  helper <span className="font-semibold text-foreground tabular-nums">{Math.round((record.payout_split.helper ?? 0) * 100)}%</span>
                </p>
              )}
            </div>
          )}
        </div>

        {filter === "open" && !isActivePanel && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button size="sm" onClick={() => openDecisionPanel(job)}>
              <Scale className="w-4 h-4 mr-1" /> Decide…
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm({ job, action: "release" })} disabled={resolving === job.id}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Quick: Release to Helpr
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm({ job, action: "refund" })} disabled={resolving === job.id}>
              <XCircle className="w-4 h-4 mr-1" /> Quick: Refund Customer
            </Button>
          </div>
        )}

        {filter === "open" && isActivePanel && (
          <div className="pt-2 border-t border-border space-y-3">
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-medium">Decision note (recorded for both parties)</Label>
              <Textarea
                value={decisionText}
                onChange={(e) => setDecisionText(e.target.value)}
                placeholder="Explain the outcome — what tipped the call, what each party should expect."
                rows={3}
                maxLength={1000}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-ds-11 font-medium">Payout split</Label>
              {/* Range input — 0 = 100% poster (full refund), 100 = 100% helper (full release). */}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={helperShare}
                onChange={(e) => setHelperShare(Number(e.target.value))}
                className="w-full accent-primary"
                aria-label="Helper's share of the payout"
              />
              <div className="flex justify-between text-ds-11 tabular-nums">
                <span className="text-muted-foreground">
                  Poster <span className="font-semibold text-foreground">{100 - helperShare}%</span>
                  <span className="ml-1 text-muted-foreground">(${((job.budget * (100 - helperShare)) / 100).toFixed(2)})</span>
                </span>
                <span className="text-muted-foreground">
                  Helper <span className="font-semibold text-foreground">{helperShare}%</span>
                  <span className="ml-1 text-muted-foreground">(${((job.budget * helperShare) / 100).toFixed(2)})</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHelperShare(0)}
                disabled={submittingDecision}
              >
                Resolve for poster (0/100)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHelperShare(50)}
                disabled={submittingDecision}
              >
                Split 50/50
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHelperShare(100)}
                disabled={submittingDecision}
              >
                Resolve for helper (100/0)
              </Button>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => decide(job)}
                disabled={submittingDecision || !decisionText.trim()}
              >
                {submittingDecision ? "Recording…" : "Record decision"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setActivePanelJobId(null);
                  setDecisionText("");
                  setHelperShare(50);
                }}
                disabled={submittingDecision}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filter tabs — Open queue vs. Decided audit log. */}
      <div className="flex gap-1.5 border-b border-border">
        <button
          type="button"
          onClick={() => setFilter("open")}
          className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
            filter === "open" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Open
            <span className="text-ds-11 tabular-nums">({disputes.length})</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setFilter("decided")}
          className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
            filter === "decided" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Decided
            <span className="text-ds-11 tabular-nums">({decidedJobs.length})</span>
          </span>
        </button>
      </div>

      {/* Cross-cutting filters — only meaningful on the Open queue. */}
      {filter === "open" && disputes.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap text-ds-11">
          <FilterChipGroup
            label="Age"
            value={ageFilter}
            onChange={(v) => setAgeFilter(v as AgeFilter)}
            options={[
              { id: "all", label: "All" },
              { id: "0-24h", label: "0–24h" },
              { id: "1-7d", label: "1–7d" },
              { id: "7-30d", label: "7–30d" },
              { id: ">30d", label: ">30d" },
            ]}
          />
          <FilterChipGroup
            label="Filed by"
            value={partyFilter}
            onChange={(v) => setPartyFilter(v as PartyFilter)}
            options={[
              { id: "all", label: "Both" },
              { id: "poster", label: "Poster" },
              { id: "helper", label: "Helper" },
            ]}
          />
          <FilterChipGroup
            label="Category"
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v)}
            options={[
              { id: "all", label: "All" },
              ...Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
            ]}
          />
          {(ageFilter !== "all" || partyFilter !== "all" || categoryFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setAgeFilter("all");
                setPartyFilter("all");
                setCategoryFilter("all");
              }}
              className="text-ds-11 text-primary hover:underline px-2 self-center"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground">
            {filter === "open" ? "No active disputes" : "No decided disputes in the last 50."}
          </p>
        </div>
      ) : (
        list.map(renderCard)
      )}

      <BrandConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.action === "release" ? "Release payment to helpr?" : "Refund the customer?"}
        description={
          confirm?.action === "release"
            ? `This releases the escrowed $${confirm?.job.budget} to ${profiles[confirm?.job.helper_id || ""] || "the helpr"} and closes the dispute. This moves real money and can't be undone here.`
            : `This refunds $${confirm?.job.budget} to ${profiles[confirm?.job.customer_id || ""] || "the customer"} and closes the dispute. This moves real money and can't be undone here.`
        }
        primaryLabel={confirm && resolving === confirm.job.id ? "Working…" : (confirm?.action === "release" ? "Release payment" : "Refund customer")}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={!!resolving}
        onPrimary={(e) => {
          e.preventDefault();
          if (!confirm) return;
          const { job, action } = confirm;
          setConfirm(null);
          resolveDispute(job, action);
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
};

/**
 * FilterChipGroup — labelled segmented pill group used by the
 * disputes filters. Kept inline to avoid spawning yet another shared
 * component that nothing else uses.
 */
const FilterChipGroup = ({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
}) => (
  <div className="flex items-center gap-1.5 flex-wrap">
    <span className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">
      {label}
    </span>
    <div className="inline-flex items-center rounded-md bg-muted/60 p-0.5 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={`px-2 h-6 rounded-sm text-ds-10 font-semibold transition-colors ${
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  </div>
);

export default AdminDisputes;
