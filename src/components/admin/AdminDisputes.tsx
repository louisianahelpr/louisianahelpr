import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { formatPriceExact } from "@/lib/format";
import { CheckCircle2, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { categoriseReason, CATEGORY_LABELS } from "./adminDisputes/adminDisputesHelpers";
import { FilterChipGroup } from "./adminDisputes/FilterChipGroup";
import { DisputeCard } from "./adminDisputes/DisputeCard";
import type {
  DisputedJob,
  DisputeRecord,
  FilterTab,
  AgeFilter,
  PartyFilter,
  CategoryFilter,
} from "./adminDisputes/types";
import { EmptyState } from "@/components/ui/EmptyState";

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
      toast.error("Couldn't load disputes — refresh to retry.");
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
      const BASE_COLUMNS =
        "id, job_id, opener_id, reason, evidence_urls, status, created_at, decided_at, decided_by, decision_text, payout_split";
      const EXECUTION_COLUMNS =
        "execution_status, executed_at, execution_transfer_id, execution_refund_id, execution_helper_cents, execution_refund_cents, execution_error";
      const readRecords = (columns: string) =>
        (supabase.from as any)("disputes").select(columns).in("job_id", allJobIds);

      let { data: records, error: recordsErr } = await readRecords(
        `${BASE_COLUMNS}, ${EXECUTION_COLUMNS}`,
      );
      // 42703 = undefined_column: the execution-state migration hasn't finished
      // deploying yet. Postgres rejects the WHOLE select for one unknown column,
      // which would blank the entire dispute queue during that window — so drop
      // back to the columns that have always existed rather than showing the
      // admin an empty screen.
      if (recordsErr?.code === "42703") {
        ({ data: records, error: recordsErr } = await readRecords(BASE_COLUMNS));
      }
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
      } else {
        // Refund to customer — cancel the payment intent
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_refund_dispute", jobId: job.id },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
      loadDisputes();
    } catch (err: any) {
      toast.error(err.message || "Couldn't resolve that dispute — try again");
    } finally {
      setResolving(null);
    }
  };

  // Record the formal decision (text + split), then EXECUTE it: the recorded
  // split now moves real money via the `execute-dispute-split` edge function —
  // one Stripe transfer for the Helpr's share, one refund for the poster's.
  //
  // Every position on the slider goes through the same function, endpoints
  // included. The old code fired create-payment's `admin_release_dispute` /
  // `admin_refund_dispute` for the 100/0 and 0/100 cases, but it fired them
  // AFTER rpc_decide_dispute had already flipped jobs.status off 'disputed' —
  // and both of those branches refuse a job that isn't 'disputed'. So the two
  // endpoints failed every time and fell into the "retry manually" warning.
  // One execution path, invoked after the decision is on record, fixes that as
  // a side effect of building the partial-split path.
  //
  // The Quick Release / Quick Refund buttons still call create-payment
  // directly — they don't pre-record a decision, so the job is genuinely still
  // 'disputed' when they run.
  const decide = async (job: DisputedJob) => {
    if (!decisionText.trim()) {
      toast.error("Add a decision note first.");
      return;
    }
    setSubmittingDecision(true);
    try {
      const payoutSplit = {
        poster: (100 - helperShare) / 100,
        helper: helperShare / 100,
      };
      const disputeId = disputeRecords[job.id]?.id ?? null;

      // Try the formal RPC. Cast through `any` until `supabase gen
      // types` reflects the new migration. PGRST202 = not deployed
      // yet (there's a short window between merge and the auto-deploy
      // finishing, per CLAUDE.md), in which case we fall back to a
      // direct UPDATE that records the decision on the legacy
      // `dispute_resolved_at` column.
      const { error: rpcError } = await (supabase.rpc as any)(
        "rpc_decide_dispute",
        {
          _dispute_id: disputeId,
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

      // ── Execute the split ──────────────────────────────────────────
      if (!disputeId) {
        // No row in `disputes` — a dispute filed before that table existed, or
        // the RPC/table isn't deployed yet. There's nothing for the executor to
        // key off, so say exactly that rather than implying money moved.
        toast.warning(
          "Decision recorded. This dispute has no formal record to settle against — move the escrow with Quick Release or Quick Refund.",
        );
      } else {
        const { data, error } = await supabase.functions.invoke(
          "execute-dispute-split",
          { body: { dispute_id: disputeId } },
        );
        // NEVER drop the error half: a settlement that silently failed would
        // leave the admin believing the money moved.
        const invokeError = error ?? (data?.error ? new Error(String(data.error)) : null);
        if (invokeError) {
          const ctx = (invokeError as { context?: unknown }).context;
          const response = ctx instanceof Response ? ctx : null;
          // A 404 has two very different causes and only one of them is worth
          // waiting out. The GATEWAY returns a bodyless 404 while the function
          // is still deploying; the DEPLOYED function returns 404 with our own
          // `{ error }` envelope for "dispute not found" / "job not found".
          // Reading the body is the only way to tell them apart — without it an
          // admin chasing genuinely missing data is told "still deploying,
          // retry in a minute" forever.
          let stillDeploying = false;
          if (response?.status === 404) {
            let hasErrorEnvelope = false;
            try {
              const parsed = await response.clone().json();
              hasErrorEnvelope =
                typeof parsed?.error === "string" && parsed.error.trim().length > 0;
            } catch {
              // Not JSON at all — the gateway's own 404.
              hasErrorEnvelope = false;
            }
            stillDeploying = !hasErrorEnvelope;
          }
          if (stillDeploying) {
            // The function landed on main but hasn't finished deploying. The
            // decision IS recorded; only the settlement is late.
            toast.warning(
              "Decision recorded. The settlement service is still deploying — reopen this dispute in a minute to move the money.",
            );
          } else {
            const message = await functionErrorMessage(
              invokeError,
              "Decision recorded, but the settlement failed — retry from this dispute.",
            );
            report(invokeError, { tags: { source: "AdminDisputes.executeSplit" } });
            toast.error(`Decision recorded, but the money didn't move: ${message}`);
          }
        } else {
          const moved = data as {
            helper_cents?: number;
            refund_cents?: number;
          } | null;
          const helperPaid = (moved?.helper_cents ?? 0) / 100;
          const posterRefunded = (moved?.refund_cents ?? 0) / 100;
          const parts = [
            helperPaid > 0 ? `$${formatPriceExact(helperPaid)} to the Helpr` : null,
            posterRefunded > 0 ? `$${formatPriceExact(posterRefunded)} back to the customer` : null,
          ].filter(Boolean);
          toast.success(`Dispute settled — ${parts.join(", ")}.`);
        }
      }

      // Reset the panel + reload list.
      setActivePanelJobId(null);
      setDecisionText("");
      setHelperShare(50);
      loadDisputes();
    } catch (err: any) {
      toast.error(err.message || "Couldn't record that decision — try again");
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

  return (
    <div className="space-y-6">
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
              { id: "helper", label: "Helpr" },
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
              Reset Filters
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={CheckCircle2}
          title={filter === "open" ? "No active disputes" : "No decided disputes"}
          body={
            filter === "open"
              ? "Nothing is contested right now."
              : "Nothing has been decided in the last 50 jobs."
          }
        />
      ) : (
        list.map((job) => (
          <DisputeCard
            key={job.id}
            job={job}
            filter={filter}
            disputeRecords={disputeRecords}
            profiles={profiles}
            tiers={tiers}
            activePanelJobId={activePanelJobId}
            resolving={resolving}
            decisionText={decisionText}
            helperShare={helperShare}
            submittingDecision={submittingDecision}
            openDecisionPanel={openDecisionPanel}
            setConfirm={setConfirm}
            setDecisionText={setDecisionText}
            setHelperShare={setHelperShare}
            setActivePanelJobId={setActivePanelJobId}
            decide={decide}
          />
        ))
      )}

      <BrandConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.action === "release" ? "Release Payment to Helpr?" : "Refund the Customer?"}
        description={
          confirm?.action === "release"
            // formatPriceExact, not raw interpolation: this dialog states the
            // amount of real escrow about to move, so it has to reconcile to
            // the cent. Raw `${budget}` rendered a $1,200.40 job as "$1200.4"
            // — no thousands separator, a truncated cent — on the one screen
            // where an admin is asked to confirm moving that exact sum.
            ? `This releases the escrowed $${formatPriceExact(confirm?.job.budget ?? 0)} to ${profiles[confirm?.job.helper_id || ""] || "the Helpr"} and closes the dispute. This moves real money and can't be undone here.`
            : `This refunds $${formatPriceExact(confirm?.job.budget ?? 0)} to ${profiles[confirm?.job.customer_id || ""] || "the customer"} and closes the dispute. This moves real money and can't be undone here.`
        }
        primaryLabel={confirm && resolving === confirm.job.id ? "Working…" : (confirm?.action === "release" ? "Release Payment" : "Refund Customer")}
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

export default AdminDisputes;
