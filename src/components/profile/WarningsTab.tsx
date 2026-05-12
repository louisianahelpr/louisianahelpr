import { AlertTriangle, Shield, CheckCircle2 } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

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
      <ProfileTabHeader
        eyebrow="Account standing"
        title="Warnings &amp; strikes"
        meta="Your record and violation history"
        onBack={onBack}
      />

      {loading ? (
        <p className="text-ds-11 text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Status overview */}
          {(() => {
            const renderHero = (
              icon: typeof Shield,
              tone: "destructive" | "orange" | "amber" | "primary",
              eyebrow: string,
              title: string,
              body: string,
            ) => {
              const palette = {
                destructive: { ring: "border-destructive/40", icon: "text-destructive", title: "hsl(var(--destructive))" },
                orange: { ring: "border-orange-500/30", icon: "text-orange-500", title: "hsl(25 90% 45%)" },
                amber: { ring: "border-amber-500/30", icon: "text-amber-500", title: "hsl(38 92% 45%)" },
                primary: { ring: "border-primary/30", icon: "text-primary", title: "hsl(var(--primary))" },
              }[tone];
              const Icon = icon;
              return (
                <div className={`rounded-2xl liquid-glass border-2 ${palette.ring} p-6 text-center space-y-3`}>
                  <div className={`w-14 h-14 rounded-full bg-white/60 mx-auto flex items-center justify-center`}>
                    <Icon className={`w-7 h-7 ${palette.icon}`} />
                  </div>
                  <p className="font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    {eyebrow}
                  </p>
                  <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.4rem", color: palette.title, letterSpacing: "-0.02em" }}>
                    {title}
                  </h2>
                  <p className="font-serif italic max-w-sm mx-auto" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                    {body}
                  </p>
                </div>
              );
            };
            if (hasBan) return renderHero(Shield, "destructive", "Status", "Account banned", "Permanently banned due to policy violations.");
            if (hasSuspension) return renderHero(AlertTriangle, "orange", "Status", "Suspended", "Your account is under temporary suspension.");
            if (strikeCount > 0) return renderHero(
              AlertTriangle, "amber", "Status", `Strike ${strikeCount}/2`,
              strikeCount === 1 ? "One warning on file. A second strike may lead to suspension." : "Final warning. Another violation will result in a permanent ban."
            );
            return renderHero(CheckCircle2, "primary", "Status", "Good standing", "No warnings or violations on record. Keep it up.");
          })()}

          {/* Violation history */}
          <div className="space-y-2 pt-2">
            <p className="font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              History
            </p>
            {violations.length === 0 ? (
              <p className="font-serif italic py-4 text-center" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                No violations on record.
              </p>
            ) : (
              violations.map((v) => (
                <div key={v.id} className="rounded-ds-md liquid-glass p-4 space-y-2 transition-all hover:-translate-y-0.5 hover:shadow-md">
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
                    <span className="font-serif italic whitespace-nowrap shrink-0" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                      {v.created_at ? new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </span>
                  </div>
                  {v.description && (
                    <p className="font-serif italic leading-relaxed" style={{ fontSize: "0.82rem", color: "hsl(var(--ink-deep))" }}>
                      {v.description}
                    </p>
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
