import { ArrowLeft, AlertTriangle, Shield, CheckCircle2 } from "lucide-react";

type Violation = {
  id: string;
  violation_type: string;
  description: string | null;
  action_taken: string;
  created_at: string | null;
  job_id: string | null;
};

interface WarningsTabProps {
  violations: Violation[];
  loading: boolean;
  onBack: () => void;
}

export function WarningsTab({ violations, loading, onBack }: WarningsTabProps) {
  const strikeCount = violations.filter((v) => v.action_taken === "warning" || v.action_taken === "final_warning").length;
  const hasBan = violations.some((v) => v.action_taken === "permanent_ban");
  const hasSuspension = violations.some((v) => v.action_taken === "suspension" || v.action_taken === "temporary_ban");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-accent" /> Warnings & Strikes
          </h1>
          <p className="text-sm text-muted-foreground">Your account standing and violation history</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Status overview */}
          {(() => {
            if (hasBan) {
              return (
                <div className="rounded-xl border-2 border-destructive bg-destructive/5 p-5 text-center space-y-2">
                  <Shield className="w-10 h-10 text-destructive mx-auto" />
                  <h2 className="text-lg font-bold text-destructive">Account Banned</h2>
                  <p className="text-sm text-muted-foreground">Your account has been permanently banned due to policy violations.</p>
                </div>
              );
            }
            if (hasSuspension) {
              return (
                <div className="rounded-xl border-2 border-orange-500/30 bg-orange-500/5 p-5 text-center space-y-2">
                  <AlertTriangle className="w-10 h-10 text-orange-500 mx-auto" />
                  <h2 className="text-lg font-bold text-orange-600">Account Suspended</h2>
                  <p className="text-sm text-muted-foreground">Your account is under temporary suspension.</p>
                </div>
              );
            }
            if (strikeCount > 0) {
              return (
                <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-5 text-center space-y-2">
                  <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
                  <h2 className="text-lg font-bold text-amber-600">Strike {strikeCount}/2</h2>
                  <p className="text-sm text-muted-foreground">
                    {strikeCount === 1 ? "You have 1 warning. A second strike may lead to suspension." : "Final warning. Another violation will result in a permanent ban."}
                  </p>
                </div>
              );
            }
            return (
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
                <h2 className="text-lg font-bold text-primary">Good Standing</h2>
                <p className="text-sm text-muted-foreground">Your account has no warnings or violations. Keep it up!</p>
              </div>
            );
          })()}

          {/* Violation history */}
          <div className="space-y-2">
            <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider">History</h2>
            {violations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No violations on record.</p>
            ) : (
              violations.map((v) => (
                <div key={v.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive"
                        : v.action_taken === "suspension" || v.action_taken === "temporary_ban" ? "bg-orange-500/10 text-orange-600"
                        : "bg-amber-500/10 text-amber-600"
                      }`}>
                        {v.action_taken.replace(/_/g, " ")}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground shrink-0">
                        {v.violation_type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                      {v.created_at ? new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </span>
                  </div>
                  {v.description && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{v.description}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
