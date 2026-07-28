import { AlertCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { type Job } from "../../activityConstants";

/**
 * Loading skeleton for the applicants list — two cards matching the real
 * card height. Static, no props. Extracted verbatim from ApplicantsPanel.
 */
export function ApplicantsLoadingState() {
  return (
    <div className="space-y-3" aria-label="Loading applicants" aria-busy="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-ds-md p-3.5 flex items-start gap-3"
          style={{
            background: "var(--surface-premium)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <Skeleton className="w-11 h-11 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-9 w-16 rounded-ds-sm shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Error state for the applicants list — retry re-runs the parent's load.
 * Pure presentational. Extracted verbatim from ApplicantsPanel.
 */
export function ApplicantsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
      <AlertCircle className="w-8 h-8 text-destructive" />
      <div className="space-y-1">
        <p className="font-semibold text-foreground text-ds-15">Couldn't load applicants</p>
        {/* Deliberately NOT "check your connection" — most failures here are
            server-side, and blaming the user's wifi is a false diagnosis.
            Matches the shared ErrorState's default copy. */}
        <p className="text-ds-13 text-muted-foreground">
          Tap Try again. If it sticks, our end is having a hiccup — not yours.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="rounded-ds-md btn-press"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

/**
 * Empty state — warmer copy when no one has applied yet, with a share CTA.
 * Pure presentational (share payload derived from the passed job). Extracted
 * verbatim from ApplicantsPanel.
 */
export function ApplicantsEmptyState({ selectedJob }: { selectedJob: Job }) {
  return (
    <div className="flex flex-col items-center text-center gap-5 pt-12 pb-6 px-6">
      <div
        className="w-14 h-14 rounded-full inline-flex items-center justify-center"
        style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
      >
        <Users className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p
          className="font-display italic font-bold"
          style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          No one has applied yet
        </p>
        <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.80)" }}>
          Your job was just posted! Sharing it reaches more Helprs nearby.
        </p>
      </div>
      <ShareJobButton
        job={{ id: selectedJob.id, title: selectedJob.title, budget: selectedJob.budget, pricingMode: selectedJob.pricing_mode, category: selectedJob.category }}
      />
    </div>
  );
}
