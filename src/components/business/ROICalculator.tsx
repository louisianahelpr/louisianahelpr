import { useMemo, useState } from "react";
import { Calculator, TrendingUp } from "lucide-react";
import { AnimatedCounter } from "@/components/AnimatedCounter";

/**
 * ROI Calculator — pure client-side widget.
 *
 * W-2 baseline assumptions (kept conservative; documented inline so a
 * future copywriter can sanity-check the numbers without re-reading the
 * code):
 *  - $25/hr loaded baseline for a comparable part-time employee
 *  - 22% loaded burden on top of wage (payroll tax, workers' comp,
 *    unemployment, basic benefits) — IRS / BLS rule-of-thumb
 *  - 1.5 hours of equivalent W-2 time per task on average (covers
 *    schedule overhead, supervision, drive time, idle hours)
 *  - Helpr platform fee already priced into the task budget the user
 *    enters, so we compare tasks-out-of-pocket to W-2-out-of-pocket
 *    rather than double-counting fees.
 */
const W2_HOURLY = 25;
const W2_BURDEN = 0.22;
const W2_HOURS_PER_TASK = 1.5;

export function ROICalculator() {
  const [tasksPerWeek, setTasksPerWeek] = useState(8);
  const [avgBudget, setAvgBudget] = useState(125);

  const numbers = useMemo(() => {
    const tasksPerMonth = tasksPerWeek * 4.33;
    const helprMonthlyCost = tasksPerMonth * avgBudget;
    const w2HoursPerMonth = tasksPerMonth * W2_HOURS_PER_TASK;
    const w2LoadedRate = W2_HOURLY * (1 + W2_BURDEN);
    const w2MonthlyCost = w2HoursPerMonth * w2LoadedRate;
    const monthlySavings = Math.max(0, w2MonthlyCost - helprMonthlyCost);
    const annualSavings = monthlySavings * 12;
    return {
      tasksPerMonth: Math.round(tasksPerMonth),
      helprMonthlyCost,
      w2MonthlyCost,
      monthlySavings,
      annualSavings,
    };
  }, [tasksPerWeek, avgBudget]);

  return (
    <section
      aria-labelledby="roi-calculator-heading"
      className="liquid-glass p-6 lg:p-8"
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-ds-md flex items-center justify-center shrink-0"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.12)",
            color: "hsl(var(--burnt-sienna))",
          }}
        >
          <Calculator className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div>
          <span className="text-display-eyebrow">ROI calculator</span>
          <h2
            id="roi-calculator-heading"
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.35rem, 2vw + 0.5rem, 1.75rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            See what you'd save vs. hiring part-time.
          </h2>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label
                htmlFor="roi-tasks"
                className="text-ds-13 font-semibold"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Tasks per week
              </label>
              <span
                className="text-ds-17 font-bold tabular-nums"
                style={{ color: "hsl(var(--bark))" }}
              >
                {tasksPerWeek}
              </span>
            </div>
            <input
              id="roi-tasks"
              type="range"
              min={1}
              max={50}
              step={1}
              value={tasksPerWeek}
              onChange={(e) => setTasksPerWeek(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Tasks per week"
            />
            <div className="flex justify-between text-ds-11 text-muted-foreground mt-1">
              <span>1</span>
              <span>50</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label
                htmlFor="roi-budget"
                className="text-ds-13 font-semibold"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Avg. task budget
              </label>
              <span
                className="text-ds-17 font-bold tabular-nums"
                style={{ color: "hsl(var(--bark))" }}
              >
                ${avgBudget}
              </span>
            </div>
            <input
              id="roi-budget"
              type="range"
              min={25}
              max={500}
              step={5}
              value={avgBudget}
              onChange={(e) => setAvgBudget(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Average task budget in dollars"
            />
            <div className="flex justify-between text-ds-11 text-muted-foreground mt-1">
              <span>$25</span>
              <span>$500</span>
            </div>
          </div>

          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            W-2 baseline: ${W2_HOURLY}/hr loaded at {Math.round(W2_BURDEN * 100)}%
            payroll burden, {W2_HOURS_PER_TASK} hrs equivalent per task
            (schedule, supervision, idle).
          </p>
        </div>

        <div
          className="rounded-ds-md p-5 flex flex-col justify-between"
          style={{
            background: "hsl(var(--bark) / 0.04)",
            border: "1px solid hsl(var(--olivewood) / 0.12)",
          }}
        >
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-ds-11 text-muted-foreground">
                ~{numbers.tasksPerMonth} tasks/mo on Helpr
              </span>
              <span className="text-ds-13 font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                <AnimatedCounter
                  value={numbers.helprMonthlyCost}
                  prefix="$"
                  decimals={0}
                />
                /mo
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-ds-11 text-muted-foreground">
                Equivalent W-2 cost
              </span>
              <span
                className="text-ds-13 font-semibold tabular-nums line-through"
                style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              >
                <AnimatedCounter
                  value={numbers.w2MonthlyCost}
                  prefix="$"
                  decimals={0}
                />
                /mo
              </span>
            </div>
          </div>

          <div
            className="mt-5 pt-5 border-t"
            style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp
                className="w-4 h-4"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                strokeWidth={2}
              />
              <span className="text-display-eyebrow">Monthly savings</span>
            </div>
            <p
              className="font-display italic font-bold tabular-nums leading-none"
              style={{
                fontSize: "clamp(2rem, 4vw + 0.5rem, 3rem)",
                color: "hsl(var(--burnt-sienna))",
                letterSpacing: "-0.03em",
              }}
              data-testid="roi-monthly-savings"
            >
              <AnimatedCounter
                value={numbers.monthlySavings}
                prefix="$"
                decimals={0}
              />
            </p>
            <p
              className="text-ds-13 mt-2 tabular-nums"
              style={{ color: "hsl(var(--olivewood))" }}
            >
              ≈{" "}
              <AnimatedCounter
                value={numbers.annualSavings}
                prefix="$"
                decimals={0}
                className="font-semibold"
              />{" "}
              annually
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ROICalculator;
