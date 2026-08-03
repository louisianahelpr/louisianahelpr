import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, AlertTriangle, Scale } from "lucide-react";
import { slaBadge } from "./adminDisputesHelpers";
import type { DisputedJob, DisputeRecord, FilterTab } from "./types";
import { formatShortDate } from "@/lib/format";

interface DisputeCardProps {
  job: DisputedJob;
  filter: FilterTab;
  disputeRecords: Record<string, DisputeRecord>;
  profiles: Record<string, string>;
  tiers: Record<string, string | null>;
  activePanelJobId: string | null;
  resolving: string | null;
  decisionText: string;
  helperShare: number;
  submittingDecision: boolean;
  openDecisionPanel: (job: DisputedJob) => void;
  setConfirm: (confirm: { job: DisputedJob; action: "release" | "refund" }) => void;
  setDecisionText: (text: string) => void;
  setHelperShare: (share: number) => void;
  setActivePanelJobId: (id: string | null) => void;
  decide: (job: DisputedJob) => void;
}

// Renders one card. Shared between Open and Decided so the visual
// layout stays consistent; resolution actions only appear for Open.
export const DisputeCard = ({
  job,
  filter,
  disputeRecords,
  profiles,
  tiers,
  activePanelJobId,
  resolving,
  decisionText,
  helperShare,
  submittingDecision,
  openDecisionPanel,
  setConfirm,
  setDecisionText,
  setHelperShare,
  setActivePanelJobId,
  decide,
}: DisputeCardProps) => {
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
              Disputed {formatShortDate(job.disputed_at)} by {profiles[job.disputed_by || ""] || "Unknown"}
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
              aria-label="Decision note (recorded for both parties)"
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
