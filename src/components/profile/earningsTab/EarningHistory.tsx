import { Gift, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { formatPrice, formatShortDate } from "@/lib/format";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
import type { Job } from "./types";

interface EarningHistoryProps {
  earningsJobs: Job[];
  tips: { amount: number; job_id: string; created_at: string }[];
  loading: boolean;
  historyVisible: number;
  page: number;
  onLoadMore: () => void;
  onBrowseJobs: () => void;
}

export function EarningHistory({
  earningsJobs,
  tips,
  loading,
  historyVisible,
  page,
  onLoadMore,
  onBrowseJobs,
}: EarningHistoryProps) {
  if (loading) {
    // Content-shaped skeleton: section eyebrow + heading, plus three
    // job-row placeholders matching the eventual `.rounded-ds-md
    // liquid-glass p-3.5` row geometry below (title row, status chip,
    // meta line, right-aligned amount). Keeps the page from collapsing
    // to a single line of "Loading…" text mid-fetch.
    return (
      <div>
        <Skeleton className="h-2.5 w-14 mb-1" />
        <Skeleton className="h-6 w-40 mb-3" />
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ds-md liquid-glass p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <div className="text-right shrink-0 space-y-1.5">
                  <Skeleton className="h-4 w-16 ml-auto" />
                  <Skeleton className="h-2.5 w-12 ml-auto" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="font-serif italic uppercase mb-1" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
        History
      </p>
      <h2 className="font-display italic font-bold leading-tight mb-3 text-headline-section" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
        Earning history
      </h2>
      {earningsJobs.length === 0 ? (
        <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-12">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: "hsla(0, 0%, 100%, 0.55)",
              border: "1px solid hsl(var(--olivewood) / 0.10)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
            }}
          >
            <Briefcase className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
          </div>
          <div className="space-y-1.5">
            <span className="text-display-eyebrow">Quiet ledger</span>
            <p
              className="font-display italic font-bold leading-tight"
              style={{
                fontSize: "clamp(1.05rem, 1.5vw + 0.4rem, 1.35rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.02em",
              }}
            >
              No earnings yet.
            </p>
            <p
              className="font-serif italic text-ds-13 leading-relaxed max-w-sm mx-auto"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Apply to a job and your earnings will land here.
            </p>
          </div>
          <Button onClick={onBrowseJobs} className="rounded-ds-md mt-1">Browse jobs</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {earningsJobs.slice(0, historyVisible).map((job) => {
            const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
            const perHelper = job.budget / helpers;
            const commissionPercent = job.helper_fee_percent ?? 10;
            const commission = (perHelper * commissionPercent) / 100;
            const payout = job.status === "completed" ? perHelper - commission + netUrgentFeeDollars(job.urgent_fee) : null;
            const jobTips = tips.filter((t) => t.job_id === job.id);
            const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);
            return (
              <div key={job.id} className="rounded-ds-md liquid-glass p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                        {job.title}
                      </h3>
                      <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium ${jobStatusColorClasses(job.status)}`}>{jobStatusLabel(job.status)}</span>
                    </div>
                    <p className="font-serif italic" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                      {job.location} <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span> {formatShortDate(job.date_needed)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {payout !== null && (
                      <p className="font-display italic font-bold tabular-nums" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}>
                        ${formatPrice(payout)}
                      </p>
                    )}
                    {tipTotal > 0 && <p className="text-ds-11 text-primary flex items-center gap-1 justify-end"><Gift className="w-3 h-3" /> +${formatPrice(tipTotal)}</p>}
                    {job.status === "in_progress" && (
                      <p className="font-serif italic" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                          ${formatPrice(job.budget)} budget
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {earningsJobs.length > historyVisible && (
            <Button
              variant="outline"
              className="w-full rounded-ds-md"
              onClick={onLoadMore}
            >
              Load {Math.min(page, earningsJobs.length - historyVisible)} more · {earningsJobs.length - historyVisible} remaining
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
