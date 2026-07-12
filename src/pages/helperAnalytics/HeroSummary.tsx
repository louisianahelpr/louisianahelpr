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
            className="font-display italic font-bold"
            style={{ fontSize: "1.8rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            {analytics ? fmtDollars(analytics.totalEarnings) : "$0"}
            <span className="text-ds-14 font-normal ml-2 text-muted-foreground">gross earned</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-ds-13">
            <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {analytics?.completedCount ?? 0}
              </span>{" "}
              {(analytics?.completedCount ?? 0) === 1 ? "job completed" : "jobs completed"}
            </span>
            {analytics && analytics.netEarnings > 0 && (
              <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <span className="font-semibold" style={{ color: "hsl(var(--bark))" }}>
                  {fmtDollars(analytics.netEarnings)}
                </span>{" "}
                after Helpr fee
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HeroSummary;
