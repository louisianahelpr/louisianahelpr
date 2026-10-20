/** Post a Job is five screens: What, Details, Price, When and where, Review. */
const POST_JOB_STEP_COUNT = 5;

interface Props {
  /** 1-based screen number. */
  step: number;
  /** The one question this screen asks (Bodoni: a flow question, spec §1.2). */
  question: string;
  /** One muted line under the question. */
  helper: string;
}

/**
 * The head of every Post a Job screen (boards 23, 44, 3, 45, 46): a segmented
 * progress bar with "n of 5", then the screen's question and one helper line.
 */
export function PostJobStepHeader({ step, question, helper }: Props) {
  return (
    <header className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Post a job progress"
          aria-valuemin={1}
          aria-valuemax={POST_JOB_STEP_COUNT}
          aria-valuenow={step}
          aria-valuetext={`Step ${step} of ${POST_JOB_STEP_COUNT}`}
          className="flex flex-1 gap-1.5"
        >
          {Array.from({ length: POST_JOB_STEP_COUNT }, (_, i) => (
            <span
              key={i}
              data-done={i < step ? "" : undefined}
              className={`h-1 flex-1 rounded-full ${i < step ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>
        <span className="shrink-0 font-sans text-ds-13 font-semibold tabular-nums text-muted-foreground" aria-hidden>
          {step} of {POST_JOB_STEP_COUNT}
        </span>
      </div>
      <div className="space-y-1.5">
        <h2 className="font-display font-moment text-ds-32 font-semibold text-foreground">{question}</h2>
        <p className="font-sans text-ds-15 text-muted-foreground">{helper}</p>
      </div>
    </header>
  );
}
