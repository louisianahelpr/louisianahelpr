import { StepTracker } from "@/components/tracker/StepTracker";
import { JOB_PROGRESS_STEPS, type JobProgressState } from "@/lib/jobProgress";

/**
 * THE job tracker (owner, 2026-10-21: "we need 1 tracker"): Posted · Hired · Working · Done, then one line
 * saying what happens next. Chat, the job page and both job cards render this and nothing else; the state
 * comes from `jobProgress` (src/lib/jobProgress.ts). Off the path (cancelled, under review) it is the line
 * alone. Guard: src/test/oneJobTracker.test.ts.
 */
export function JobProgress({ progress, compact = false }: { progress: JobProgressState; compact?: boolean }) {
  const line = progress.next || (progress.step === null ? progress.word : "");
  return (
    <div data-job-progress="" className="space-y-1.5">
      {progress.step !== null && <StepTracker steps={JOB_PROGRESS_STEPS} at={progress.step - 1} />}
      {line && (
        <p data-job-progress-next="" className={`${compact ? "text-ds-12" : "text-ds-13"} text-muted-foreground`}>
          {progress.step === null && progress.word && progress.next ? (
            <>
              <span className="font-semibold text-foreground">{progress.word}</span> · {progress.next}
            </>
          ) : (
            line
          )}
        </p>
      )}
    </div>
  );
}
