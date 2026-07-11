/**
 * Presentational cards for the admin analytics dashboard.
 *
 * Extracted verbatim from AdminAnalytics.tsx — each is a pure,
 * props-only render helper: the metric tiles, the status rows, the MRR
 * breakdown rows, the cohort-retention table, and the activation-funnel
 * card. None fetch data or hold state of their own.
 */

import { toneTextClasses } from "@/components/admin/tones";
import { formatPrice } from "@/lib/format";

export const MetricCard = ({ label, value, sub, icon: Icon, accent, warning, onClick }: {
  label: string; value: string | number; sub: string; icon: any; accent?: boolean; warning?: boolean; onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    disabled={!onClick}
    className={`rounded-ds-md border bg-card p-5 text-left transition-all group ${
      onClick ? "hover:bg-secondary/30 hover:border-primary/30 cursor-pointer" : ""
    } ${warning ? "border-warning/30" : "border-border"}`}
  >
    <div className="flex items-center justify-between mb-3">
      <span className="text-ds-11 text-muted-foreground">{label}</span>
      <Icon className={`w-5 h-5 ${accent ? "text-primary" : warning ? toneTextClasses.warning : "text-primary"} group-hover:scale-110 transition-transform`} />
    </div>
    <p className={`text-ds-24 font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    <p className="text-ds-11 text-muted-foreground mt-1">{sub}</p>
    {onClick && <p className="text-ds-10 text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Click to view details →</p>}
  </button>
);

export const StatusRow = ({ icon: Icon, label, count, color }: { icon: any; label: string; count: number; color: string }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-ds-11 text-muted-foreground">{label}</span>
    </div>
    <span className="text-ds-13 font-semibold text-foreground">{count}</span>
  </div>
);

export const MRRRow = ({ tier, count, amount }: { tier: string; count: number; amount: number }) => (
  <div className="flex items-center justify-between text-ds-13">
    <span className="text-muted-foreground">{tier} × {count}</span>
    <span className="font-semibold text-foreground">${formatPrice(amount)}</span>
  </div>
);

// Cohort retention card — last 6 monthly signup cohorts, each row shows
// total signups + how many are still active (= had any job activity in the
// last 30 days). Directional retention signal at low data volumes; convert
// to a multi-month retention matrix once cohorts routinely exceed ~50 users.
export const CohortRetentionCard = ({
  cohorts,
  monthLabel,
}: {
  cohorts: { date: Date; total: number; active: number }[];
  monthLabel: (d: Date) => string;
}) => (
  <div className="rounded-ds-md liquid-glass p-5">
    <h3 className="text-ds-13 font-semibold text-foreground">Cohort retention</h3>
    <p className="text-ds-11 text-muted-foreground mb-4">
      Of users who signed up in each month, how many had any job activity in the last 30 days.
    </p>
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-ds-10 uppercase tracking-wider text-muted-foreground px-1">
        <div className="col-span-3">Cohort</div>
        <div className="col-span-2 text-right">Signups</div>
        <div className="col-span-2 text-right">Still active</div>
        <div className="col-span-5">Retention</div>
      </div>
      {cohorts.map((c) => {
        const pct = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
        const isEmpty = c.total === 0;
        const tone = isEmpty
          ? "bg-muted/40"
          : pct >= 50 ? "bg-primary/70"
          : pct >= 20 ? "bg-warning/70"
          : "bg-destructive/70";
        return (
          <div key={c.date.toISOString()} className="grid grid-cols-12 gap-2 items-center text-ds-11">
            <div className="col-span-3 text-foreground">{monthLabel(c.date)}</div>
            <div className="col-span-2 text-right tabular-nums text-foreground">{c.total}</div>
            <div className="col-span-2 text-right tabular-nums text-muted-foreground">
              {isEmpty ? "—" : `${c.active} (${pct}%)`}
            </div>
            <div className="col-span-5">
              <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${tone}`}
                  style={{ width: `${isEmpty ? 0 : pct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// Funnel card — rows render as horizontal bars sized by absolute count;
// each row also shows conversion % from the prior stage.
export const FunnelCard = ({
  title, subtitle, stages,
}: {
  title: string;
  subtitle: string;
  stages: { label: string; count: number; of: number }[];
}) => {
  // Bar widths normalize against the first (largest) stage so the funnel
  // visually narrows. Empty cohort renders as a flat empty bar instead of NaN.
  const max = Math.max(stages[0]?.count ?? 0, 1);
  return (
    <div className="rounded-ds-md liquid-glass p-5">
      <h3 className="text-ds-13 font-semibold text-foreground">{title}</h3>
      <p className="text-ds-11 text-muted-foreground mb-4">{subtitle}</p>
      <div className="space-y-2.5">
        {stages.map((s, i) => {
          const widthPct = Math.max(2, Math.round((s.count / max) * 100));
          const convPct = i === 0 ? null : s.of > 0 ? Math.round((s.count / s.of) * 100) : 0;
          return (
            <div key={s.label}>
              <div className="flex items-center justify-between text-ds-11">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-mono tabular-nums text-foreground">
                  {s.count}
                  {convPct !== null && (
                    <span className={`ml-2 ${convPct >= 50 ? "text-primary" : convPct >= 20 ? toneTextClasses.warning : "text-destructive"}`}>
                      {convPct}%
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full bg-primary/70 rounded-full transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
