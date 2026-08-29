import { MapPin, Briefcase, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCategory, formatPrice, formatShortDate } from "@/lib/format";
import { helperTakeHomeDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface JobListTabProps {
  variant: "posted" | "completed";
  jobs: Job[];
  onBack: () => void;
}

export function JobListTab({ variant, jobs, onBack }: JobListTabProps) {
  const navigate = useNavigate();
  const isPosted = variant === "posted";

  // "Completed Jobs" is the one list that mixes both roles: its query is
  // `.or(customer_id.eq.me, helper_id.eq.me)`, so a row here may be work you
  // PAID for or work you WERE PAID for. Those are different quantities, and
  // the list used to print the raw budget for both — so a job you worked read
  // $140 here and $123 on the job card, in identical type.
  //
  // Whose money it is decides which number is right: on a job you posted the
  // budget is what you paid; on a job you worked your take-home is the budget
  // minus the platform fee, which is what My Jobs, Earnings & Payouts and Work
  // Record all show. The whole job row is passed to the helper so
  // `payment_status` travels with it and the fee-precedence rule applies.
  const { user, profile: viewerProfile } = useCurrentUser();
  const viewerFeePercent = tierFeePercent(
    viewerProfile?.subscription_tier,
    viewerProfile?.subscription_expires_at ?? null,
  );
  const amountFor = (job: Job) =>
    !isPosted && job.helper_id && job.helper_id === user?.id
      ? helperTakeHomeDollars(job, viewerFeePercent)
      : job.budget ?? 0;

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title={isPosted ? "Posted Jobs" : "Completed Jobs"}
        onBack={onBack}
      />
      {jobs.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={isPosted ? Briefcase : Star}
          title={isPosted ? "No posts yet" : "No history yet"}
          body={
            isPosted
              ? "Tell a neighbor what you need done — they'll see it within minutes."
              : "Every job you complete builds your record. Apply to one to get started."
          }
          action={
            isPosted ? (
              <Button onClick={() => navigate("/post-job")}>Post Your First Job</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-ds-md liquid-glass p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display italic font-bold leading-tight truncate text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                    {job.title}
                  </p>
                  <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 font-serif italic flex-wrap text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)",}}>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                    <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                    <span>{formatShortDate(job.date_needed)}</span>
                    <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                    <span>{formatCategory(job.category)}</span>
                  </div>
                </div>
                {isPosted ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-ds-15 font-bold text-primary tabular-nums">${formatPrice(amountFor(job))}</span>
                    <StatusBadge status={job.status} className="text-ds-10" />
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-ds-15 font-bold text-primary tabular-nums">${formatPrice(amountFor(job))}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default JobListTab;
