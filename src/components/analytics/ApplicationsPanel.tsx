// Panel 3 — how often you get picked, and how your speed compares.
//
// THE FUNNEL HAS THREE STEPS, NOT FOUR. There is no "poster viewed your
// application" step, because `applications.poster_viewed_at` is NULL on every
// row in prod — the column has no writer. A step off it would have rendered
// "0% of your applications were seen", which is the absence of a measurement
// dressed up as one. See the migration header for the full list of columns
// rejected on those grounds.
//
// "Undecided" is shown as its own bucket rather than folded into losses. An
// application still pending on a still-open job is not a rejection, and a job
// that was cancelled before anyone was hired is nobody's loss. Hiding those in
// the denominator is how a working helper ends up looking like a bad one.

import { AnalyticsPanel, StatTile } from "@/components/analytics/AnalyticsPanel";
import { NotEnoughYet } from "@/components/analytics/NotEnoughYet";
import {
  applicationFunnel,
  formatMinutes,
  type AnalyticsApplication,
  type AnalyticsFloors,
  type AnalyticsHeadToHead,
} from "@/lib/helperAnalytics";

interface ApplicationsPanelProps {
  applications: AnalyticsApplication[];
  headToHead: AnalyticsHeadToHead | undefined;
  floors: AnalyticsFloors;
  windowLabel: string;
}

const STEP_COLORS = ["hsl(var(--bark) / 0.55)", "hsl(var(--bark))", "hsl(165, 18%, 42%)"];

export function ApplicationsPanel({
  applications,
  headToHead,
  floors,
  windowLabel,
}: ApplicationsPanelProps) {
  const f = applicationFunnel(applications, floors);

  if (f.applied === 0) {
    return (
      <AnalyticsPanel title="Getting picked" caption={`Your applications · last ${windowLabel}`}>
        <NotEnoughYet what="your application record" have={0} need={1} unit="applications" />
      </AnalyticsPanel>
    );
  }

  const steps = [
    { label: "Applied", value: f.applied },
    { label: "Decided", value: f.decided },
    { label: "Won", value: f.won },
  ];

  const yours = headToHead?.your_median_minutes ?? null;
  const winner = headToHead?.winner_median_minutes ?? null;
  const sample = headToHead?.sample ?? 0;
  // The count of jobs the caller genuinely applied to first, computed in SQL.
  // Two earlier drafts of this line were each wrong in a different way: the
  // first read `winner - yours < 0` as "you were faster" (sign inverted, so a
  // helper two hours behind was told speed was not their problem); the second
  // compared the two MEDIANS and reported the result as a per-job outcome ("you
  // got in first on those"), which a lower median does not establish. The only
  // honest version of that sentence is a count of the jobs it is about.
  const youWereFirst = headToHead?.you_were_first ?? 0;

  return (
    <AnalyticsPanel
      title="Getting picked"
      caption={`${f.applied} ${f.applied === 1 ? "application" : "applications"} · last ${windowLabel}`}
    >
      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className="text-ds-11 w-16 shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              {s.label}
            </span>
            <div
              className="flex-1 h-5 rounded-md overflow-hidden min-w-0"
              style={{ background: "hsl(var(--olivewood) / 0.07)" }}
            >
              <div
                className="h-full rounded-md"
                style={{
                  width: `${f.applied > 0 ? Math.max(2, (s.value / f.applied) * 100) : 0}%`,
                  background: STEP_COLORS[i],
                }}
              />
            </div>
            <span
              className="text-ds-12 font-semibold tabular-nums w-7 text-right shrink-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {f.undecided > 0 && (
        <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          {f.undecided} still open or cancelled before anyone was hired — not counted either way.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Win rate"
          value={f.winRate !== null ? `${f.winRate}%` : null}
          // The withheld hint says what is MISSING, not "2 of 5", which read
          // as "2 wins out of 5 decided" — the very number being withheld.
          hint={
            f.winRate !== null
              ? `${f.won} won of ${f.decided} decided`
              : `needs ${floors.decided_applications} decided · ${f.decided} so far`
          }
        />
        <StatTile
          label="You apply within"
          value={formatMinutes(f.medianMinutesToApply)}
          hint={
            f.medianMinutesToApply !== null
              ? "median, after the job is posted"
              : `needs ${floors.applications} applications · ${f.applied} so far`
          }
        />
      </div>

      {yours !== null && winner !== null ? (
        <div
          className="rounded-xl px-3 py-2.5 text-ds-12 leading-snug"
          style={{
            background: "hsl(var(--ivory-sand) / 0.7)",
            border: "0.5px solid hsl(var(--olivewood) / 0.10)",
            color: "hsl(var(--olivewood))",
          }}
        >
          On the {sample} {sample === 1 ? "job" : "jobs"} you applied for and someone else won,
          the winner applied a median of{" "}
          <span className="font-semibold tabular-nums">{formatMinutes(winner)}</span> after posting;
          your median was{" "}
          <span className="font-semibold tabular-nums">{formatMinutes(yours)}</span>.{" "}
          <span className="font-semibold tabular-nums">{youWereFirst}</span> of {sample} you got in
          first and still lost.{" "}
          {youWereFirst >= sample - youWereFirst
            ? "Speed is not the thing costing you most of these."
            : "Applying sooner is the lever you control."}
        </div>
      ) : (
        <NotEnoughYet
          what="how your speed compares to the helper who won"
          have={sample}
          need={floors.head_to_head}
          unit="jobs someone else won"
        />
      )}
    </AnalyticsPanel>
  );
}
