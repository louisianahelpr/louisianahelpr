import { Link } from "react-router-dom";

/**
 * Open-job limit notice — surfaced BEFORE the poster starts writing, not after.
 *
 * The cap is enforced in three places and they must agree: the
 * `enforce_open_job_limit` trigger (the real one), `runPreSubmitChecks` in
 * useJobSubmit (a friendlier message on the same rule at submit), and this,
 * which is the only one that fires before any work is done. It used to render
 * only on the form step, so a poster arriving at /post-job picked an intent,
 * opened the wizard and only then learned the answer was no.
 *
 * It says WHICH jobs are in the way by linking to My Posts, because "you have
 * 5 open jobs" without a route to them is a refusal with no next step.
 */
export function OpenJobLimitNotice({ count = 5 }: { count?: number }) {
  return (
    <div
      className="rounded-ds-md p-4 flex items-start gap-3"
      style={{
        background: "hsl(var(--destructive) / 0.07)",
        border: "1px solid hsl(var(--destructive) / 0.35)",
      }}
      role="alert"
    >
      <div className="flex-1 min-w-0">
        <p className="text-ds-13 font-semibold" style={{ color: "hsl(var(--destructive))" }}>
          You have {count} open jobs
        </p>
        <p className="text-ds-11 text-muted-foreground mt-0.5">
          Helpr allows a maximum of 5 open jobs at a time. Close or complete an existing job before posting a new one.
        </p>
        <Link
          to="/my-posts"
          className="inline-flex items-center mt-2 text-ds-11 font-semibold underline underline-offset-2 min-h-[32px]"
          style={{ color: "hsl(var(--destructive))" }}
        >
          Go to My Posts
        </Link>
      </div>
    </div>
  );
}
