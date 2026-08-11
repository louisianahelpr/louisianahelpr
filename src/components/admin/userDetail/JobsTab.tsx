import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { jobStatusLabel, paymentStatusLabel } from "@/lib/statusLabels";
import { formatTimestamp } from "@/lib/format";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import type { Profile } from "../adminUserHelpers";

interface JobsTabProps {
  viewProfile: Profile;
  profileJobs: any[];
}

export function JobsTab({ viewProfile, profileJobs }: JobsTabProps) {
  // `jobsSort` is currently fixed to "recent" (no UI control yet) but kept as
  // state so a sort control can be wired up later without re-threading props.
  const [jobsRole, setJobsRole] = useState<"all" | "worked" | "posted">("all");
  const [jobsSort] = useState<"recent" | "earnings_desc" | "earnings_asc">("recent");

  const calcEarning = (j: any) => {
    const isHelper = j.helper_id === viewProfile.user_id;
    const isCustomer = j.customer_id === viewProfile.user_id;
    const budget = Number(j.budget) || 0;
    if (isHelper) {
      const fee = (Number(j.helper_fee_percent) || HELPER_FEE_LEGACY_FALLBACK_PERCENT) / 100;
      // Group jobs split the budget across the roster (mirrors computeNet):
      // this helper's net is on their per-helper share, not the whole budget.
      const helpers = Number(j.helpers_needed) > 0 ? Number(j.helpers_needed) : 1;
      return (budget / helpers) * (1 - fee); // net payout to this helper
    }
    if (isCustomer) {
      // total paid by poster
      return budget + (Number(j.customer_fee_amount) || 0) + (Number(j.sales_tax_amount) || 0);
    }
    return 0;
  };

  const filtered = profileJobs.filter((j: any) => {
    if (jobsRole === "worked") return j.helper_id === viewProfile.user_id;
    if (jobsRole === "posted") return j.customer_id === viewProfile.user_id;
    return true;
  });

  const sorted = [...filtered].sort((a: any, b: any) => {
    if (jobsSort === "earnings_desc") return calcEarning(b) - calcEarning(a);
    if (jobsSort === "earnings_asc") return calcEarning(a) - calcEarning(b);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const workedCompleted = profileJobs.filter((j: any) => j.helper_id === viewProfile.user_id && j.status === "completed");
  const postedCompleted = profileJobs.filter((j: any) => j.customer_id === viewProfile.user_id && j.status === "completed");
  const totalEarned = workedCompleted.reduce((s, j) => s + calcEarning(j), 0);
  const totalSpent = postedCompleted.reduce((s, j) => s + calcEarning(j), 0);

  const hasStripe = !!viewProfile.stripe_account_id;

  return (
    <TabsContent value="jobs" className="space-y-4 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* Stripe payout connection status */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-ds-11 font-medium ${
        hasStripe
          ? "bg-primary/5 border-primary/20 text-primary"
          : "bg-muted/50 border-border text-muted-foreground"
      }`}>
        {hasStripe ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : (
          <XCircle className="w-3.5 h-3.5" />
        )}
        {hasStripe ? "Stripe payout connected" : "Stripe payout not connected"}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-ds-md bg-secondary/30 border border-border p-3">
          <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Earned (Worked)</p>
          <p className="text-ds-17 font-semibold text-foreground">${totalEarned.toFixed(2)}</p>
          <p className="text-muted-foreground text-ds-11">{workedCompleted.length} completed</p>
        </div>
        <div className="rounded-ds-md bg-secondary/30 border border-border p-3">
          <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Spent (Posted)</p>
          <p className="text-ds-17 font-semibold text-foreground">${totalSpent.toFixed(2)}</p>
          <p className="text-muted-foreground text-ds-11">{postedCompleted.length} completed</p>
        </div>
      </div>

      {/* Filters */}
      <div className="w-full">
        <Select value={jobsRole} onValueChange={(v: any) => setJobsRole(v)}>
          <SelectTrigger aria-label="Job role filter" className="h-9 text-ds-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Jobs</SelectItem>
            <SelectItem value="worked">Worked (Helpr)</SelectItem>
            <SelectItem value="posted">Posted (Customer)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground italic">No jobs found.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((j: any) => {
            const isHelper = j.helper_id === viewProfile.user_id;
            const earning = calcEarning(j);
            const dateRef = j.poster_completed_at || j.helper_completed_at || j.created_at;
            return (
              <div key={j.id} className="p-3 rounded-lg bg-secondary/30 border border-border">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-ds-13 font-medium text-foreground line-clamp-1">{j.title}</p>
                  <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${jobStatusColorClasses(j.status)}`}>{jobStatusLabel(j.status)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-ds-11 text-muted-foreground">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-ds-10 h-5">{isHelper ? "Worked" : "Posted"}</Badge>
                    {j.parish && <span>{j.parish}</span>}
                    <span>·</span>
                    <span>{formatTimestamp(dateRef)}</span>
                    {j.payment_status && (
                      <>
                        <span>·</span>
                        <span>{paymentStatusLabel(j.payment_status)}</span>
                      </>
                    )}
                  </div>
                  <span className="text-ds-13 font-semibold text-foreground">
                    {isHelper ? "+" : "-"}${earning.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </TabsContent>
  );
}
