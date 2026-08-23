import { Skeleton } from "@/components/ui/skeleton";
import { fmtDollars } from "./analyticsUtils";
import type { Analytics } from "./fetchAnalytics";

interface HeroSummaryProps {
  analytics: Analytics | undefined;
  isLoading: boolean;
}

const HeroSummary = ({ analytics, isLoading }: HeroSummaryProps) => {
  return (
    <div
      className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
          "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
      }}
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-36 rounded" />
          <Skeleton className="h-4 w-48 rounded" />
        </div>
      ) : (
        <>
          <p
            className="font-display italic font-bold text-ds-28"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            {analytics ? fmtDollars(analytics.totalEarnings) : "$0"}
            {/* A real space, not just `ml-2`. The margin gives visual air but
                leaves nothing between the two tokens in the accessibility tree
                or on copy-paste, so the line read "$260gross earned". */}{" "}
            <span className="text-ds-14 font-normal ml-2 text-muted-foreground">gross earned</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-ds-13">
            <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {analytics?.completedCount ?? 0}
              </span>{" "}
              {(analytics?.completedCount ?? 0) === 1 ? "job completed" : "jobs completed"}
            </span>
            {/* NO "$X after Helpr fee" HERE.
                This line was the third statement of one number on one screen.
                The Earnings tab already shows the helpr's take-home twice from
                the real money: the "Net" tile, and "TOTAL EARNED" in the payout
                section, both reading the actual $228.80. This one was an
                ESTIMATE — gross budgets × the helpr's CURRENT tier percentage —
                so it could not agree with them and did not, printing "$229"
                three inches above "$228.80" (owner: "needs a full upgrade and
                polish alot of the same info").

                It is also the wrong place for it. This hero belongs to the
                analytics section, whose subject is volume and performance;
                what the helpr actually banked is the payout section's subject,
                and that section reads the ledger rather than guessing from a
                budget column. Gross earned and jobs completed stay, because
                those ARE analytics figures and nothing else on the page states
                them. */}
          </div>
        </>
      )}
    </div>
  );
};

export default HeroSummary;
