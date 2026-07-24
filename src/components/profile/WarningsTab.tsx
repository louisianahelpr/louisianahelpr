import { AlertTriangle, Shield, CheckCircle2 } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/format";

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
        // Content-shaped skeleton: hero card (status overview) + a few
        // history rows so the page has visual anchor weight while the
        // violation fetch resolves. Matches the eventual layout below
        // (hero w/ rounded-2xl + history list w/ rounded-ds-md rows).
        <>
          <div className="rounded-2xl liquid-glass border-2 border-[hsl(var(--olivewood)/0.10)] p-6 text-center space-y-3">
            <Skeleton className="w-14 h-14 rounded-full mx-auto" />
            <Skeleton className="h-3 w-20 mx-auto" />
            <Skeleton className="h-7 w-44 mx-auto" />
            <Skeleton className="h-3.5 w-64 mx-auto" />
          </div>
          <div className="space-y-2 pt-2">
            <Skeleton className="h-3 w-16" />
            {[0, 1].map((i) => (
              <div key={i} className="rounded-ds-md liquid-glass p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            ))}
          </div>
        </>
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
                orange: { ring: "border-warning/30", icon: "text-warning", title: "hsl(25 90% 45%)" },
                amber: { ring: "border-warning/30", icon: "text-warning", title: "hsl(38 92% 45%)" },
                primary: { ring: "border-primary/30", icon: "text-primary", title: "hsl(var(--primary))" },
              }[tone];
              const Icon = icon;
              return (
                <div className={`rounded-2xl liquid-glass border-2 ${palette.ring} p-6 text-center space-y-3`}>
                  <div className={`w-14 h-14 rounded-full bg-card mx-auto flex items-center justify-center`}>
                    <Icon className={`w-7 h-7 ${palette.icon}`} />
                  </div>
                  <p className="font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                    {eyebrow}
                  </p>
                  <h2 className="font-display italic font-bold leading-tight text-headline-hero" style={{ color: palette.title, letterSpacing: "-0.02em" }}>
                    {title}
                  </h2>
                  <p className="font-serif italic max-w-sm mx-auto" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.8)" }}>
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

          {/* Violation history — only when there's actual history. With
              zero violations the "Good standing" status hero above already
              renders the same CheckCircle2 "no warnings, keep it up"
              message, so a second all-clear EmptyState here was a duplicate
              card; we skip the whole History block in that case. */}
          {violations.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                History
              </p>
              {violations.map((v) => (
                <div key={v.id} className="rounded-ds-md liquid-glass p-4 space-y-2 transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-ds-10 font-bold uppercase tracking-wider shrink-0 ${
                        v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive"
                        : v.action_taken === "suspension" || v.action_taken === "temporary_ban" ? "bg-warning/10 text-warning"
                        : "bg-warning/10 text-warning"
                      }`}>
                        {v.action_taken.replace(/_/g, " ")}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-ds-10 font-medium bg-[hsl(var(--burnt-sienna)/0.1)] text-[hsl(var(--burnt-sienna))] shrink-0">
                        {v.violation_type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="font-serif italic whitespace-nowrap shrink-0" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                      {v.created_at ? formatTimestamp(v.created_at) : "—"}
                    </span>
                  </div>
                  {v.description && (
                    <p className="font-serif italic leading-relaxed" style={{ fontSize: "0.82rem", color: "hsl(var(--ink-deep))" }}>
                      {v.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
