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

// 3-strike system rungs, matching the exact wording of the "Strike System"
// block in CancellationDialog.tsx (the canonical copy for this ladder):
//   1st strike — written warning on your account
//   2nd strike — final warning
//   3rd strike — 7-day account restriction while an admin reviews it
import { CANCELLATION_LADDER_RUNGS } from "@/lib/reliabilityLadder";

const STRIKE_LABELS = ["Written warning", "Final warning", "7-day restriction"] as const;

export function WarningsTab({ violations, loading, onBack }: WarningsTabProps) {
  const strikeCount = violations.filter((v) => v.action_taken === "warning" || v.action_taken === "final_warning").length;
  const hasBan = violations.some((v) => v.action_taken === "permanent_ban");
  // `temp_ban` is the value that is ACTUALLY written — BanDialog.tsx:175 —
  // and it is what the admin console reads (adminusers/OverviewTab.tsx:106).
  // This checked only "suspension" and "temporary_ban", neither of which any
  // code path in the repo ever writes, so a user WITH a live temp ban saw
  // "Strike 1 of 3 — a written warning" while the list directly beneath
  // showed their TEMP BAN. The two older spellings are kept so a legacy row
  // still resolves, but `temp_ban` is the one that matters.
  // `pending_ban_review` is the rung ALL FOUR ladders now write at the top —
  // cancellation, job-denial, off-platform messaging, and (since
  // 20260831183302) no-show. apply_consequence_ladder converts effect
  // 'permanent' into 'review' when p_permanent_requires_review is set, and
  // every wrapper sets it: the account is restricted for 7 days while an admin
  // decides, never banned automatically.
  //
  // This list did not know that value, so a user sitting on a live 7-day
  // restriction with a ban decision pending read "Strike 2 of 3 — a final
  // warning" on the one screen that explains what is happening to their
  // account. Same defect as a job status falling through every branch, on a
  // trust surface where being wrong is worse.
  const hasSuspension = violations.some(
    (v) =>
      v.action_taken === "temp_ban" ||
      v.action_taken === "pending_ban_review" ||
      v.action_taken === "suspension" ||
      v.action_taken === "temporary_ban",
  );
  // Where the account sits on the 3-strike ladder: 1st/2nd strike map
  // directly to the "warning"/"final_warning" action_taken rows above; the
  // 3rd strike is the suspension/temporary_ban consequence (a 7-day
  // restriction), and a permanent ban means the ladder is maxed out. Derived
  // client-side from the same `violations` rows the history list below
  // already renders — no new query or backend field.
  const strikesOf3 = hasBan || hasSuspension ? 3 : Math.min(strikeCount, 3);

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title="Warnings &amp; Strikes"
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
              title: string,
              body: string,
              showProgress: boolean,
            ) => {
              const palette = {
                destructive: { ring: "border-destructive/40", icon: "text-destructive", title: "hsl(var(--destructive))", fill: "bg-destructive" },
                /* Titles are darkened from L45% to L34/32%: at 45% the amber
                   "Strike N of 3" headline measured 2.63:1 on the card, under the 3:1
                   AA bar for large bold text. The hue is unchanged. */
                orange: { ring: "border-warning/30", icon: "text-warning", title: "hsl(25 90% 34%)", fill: "bg-warning" },
                amber: { ring: "border-warning/30", icon: "text-warning", title: "hsl(38 92% 32%)", fill: "bg-warning" },
                primary: { ring: "border-primary/30", icon: "text-primary", title: "hsl(var(--primary))", fill: "bg-primary" },
              }[tone];
              const Icon = icon;
              return (
                <div className={`rounded-2xl liquid-glass border-2 ${palette.ring} p-6 text-center space-y-3`}>
                  <div className={`w-14 h-14 rounded-full bg-card mx-auto flex items-center justify-center`}>
                    <Icon className={`w-7 h-7 ${palette.icon}`} />
                  </div>
                  <h2 className="font-display italic font-bold leading-tight text-headline-hero" style={{ color: palette.title, letterSpacing: "-0.02em" }}>
                    {title}
                  </h2>
                  <p className="font-serif italic max-w-sm mx-auto text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    {body}
                  </p>
                  {showProgress && (
                    <div className="pt-1 space-y-1.5" role="img" aria-label={`${strikesOf3} of 3 strikes on the 3-strike system`}>
                      <div className="flex items-center justify-center gap-1.5">
                        {STRIKE_LABELS.map((label, i) => (
                          <span
                            key={label}
                            className={`h-1.5 w-10 rounded-full transition-colors ${
                              i < strikesOf3 ? palette.fill : "bg-[hsl(var(--olivewood)/0.15)]"
                            }`}
                          />
                        ))}
                      </div>
                      {/* 0.65 measured 4.46:1 — a 0.04 miss on the 4.5 AA bar at 11px. */}
                      <p className="text-ds-11 font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                        {strikesOf3} of 3 strikes
                      </p>
                    </div>
                  )}
                </div>
              );
            };
            if (hasBan) return renderHero(Shield, "destructive", "Account banned", "Permanently banned due to policy violations.", true);
            // The rung sentences come from CANCELLATION_LADDER_RUNGS, not from
            // here. Three surfaces used to hand-type this ladder and all three
            // were TRUE — which is exactly why it needed a constant rather than
            // a correction. They were true last time too, and then the RPC moved
            // and "five strikes is a ban" shipped in front of users for weeks.
            //
            // `where` is the rung the account is ON; `next` is what the one
            // after it costs, which is the part that changes behaviour.
            const rung = (i: number) => CANCELLATION_LADDER_RUNGS[i]?.replace(/^\S+\s+—\s+/, "") ?? "";
            if (hasSuspension) return renderHero(AlertTriangle, "orange", "Suspended", `3rd strike: ${rung(2)}.`, true);
            if (strikeCount > 0) return renderHero(
              AlertTriangle, "amber", `Strike ${strikeCount} of 3`,
              strikeCount === 1
                ? `1st strike: ${rung(0)}. A 2nd strike is a ${rung(1)}.`
                : `2nd strike: ${rung(1)}. A 3rd strike means ${rung(2)}.`,
              true,
            );
            return renderHero(CheckCircle2, "primary", "Good standing", "No warnings or violations on record. Keep it up.", true);
          })()}

          {/* Violation history — only when there's actual history. With
              zero violations the "Good standing" status hero above already
              renders the same CheckCircle2 "no warnings, keep it up"
              message, so a second all-clear EmptyState here was a duplicate
              card; we skip the whole History block in that case. */}
          {violations.length > 0 && (
            <div className="space-y-2 pt-2">
              {violations.map((v) => (
                <div key={v.id} className="rounded-ds-md liquid-glass p-4 space-y-2 transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-ds-10 font-bold uppercase tracking-wider shrink-0 ${
                        /* `text-warning` (L53%) on a 10% tint measured 2.94:1 at 10px bold.
                           The darker same-hue value clears AA; --warning stays as-is because
                           it is correct for fills and icons, which have no text bar. */
                        v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive"
                        : "bg-warning/10 text-[hsl(33_35%_32%)] dark:text-[hsl(33_50%_78%)]"
                      }`}>
                        {v.action_taken.replace(/_/g, " ")}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-ds-10 font-medium bg-[hsl(var(--burnt-sienna)/0.1)] text-[hsl(var(--burnt-sienna))] shrink-0">
                        {v.violation_type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="font-serif italic whitespace-nowrap shrink-0 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                      {v.created_at ? formatTimestamp(v.created_at) : "—"}
                    </span>
                  </div>
                  {v.description && (
                    <p className="font-serif italic leading-relaxed text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
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
