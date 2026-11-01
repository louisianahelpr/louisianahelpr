import { useQuery } from "@tanstack/react-query";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { getCachedUserLocation } from "@/hooks/useUserLocation";
import { JobPrice } from "@/components/dashboard/JobPrice";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { STANDARD_PAYOUT_PHRASE } from "../../../../supabase/functions/_shared/escrowTiming";
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";
import { formatShortDate } from "@/lib/format";
import { takeHomeFirstJobPrefetch } from "./homePrefetchTake";
import type { Profile } from "@/components/profile/profileLanding/types";

/** Jobs near you shows this many; the count beside the heading is the real total up to NEAR_CAP. */
const NEAR_SHOWN = 3;
const NEAR_CAP = 20;
/** "Pick what you do" lands on Edit profile's "I can help with" chips (app audit A3-C11). */
export const SKILLS_FOCUS_PATH = "/profile?tab=profile&focus=skills";

interface FirstJobState {
  /** No job history at all (never applied, posted, or worked one): the "first job" Home shows. */
  isNew: boolean;
  /** The job-match alerts are off on both channels (the alerts card shows only then). */
  alertsOff: boolean;
}

/**
 * Board 189 (spec v2 §9.35, "New Helpr Home"): is this member still before
 * their first job? Every account can do jobs (never role-based), so this is
 * about history, not a role. Unknown while loading or on a failed read: the
 * Home then shows its normal cards (null).
 *
 * A3-C20 (app audit 2026-10-29): "never applied" alone put "Get your first
 * job" at the top of Home for a poster with 366 jobs. A member is new only
 * with NO job history: no application, and no job they posted or were hired
 * on (a direct offer has no application). RLS lets a member count both sides
 * of their own jobs ("Users can view their own jobs").
 */
export function useFirstJobState(userId: string | undefined): FirstJobState | null {
  const { data } = useQuery({
    queryKey: ["home", "first-job-state", userId],
    enabled: !!userId,
    queryFn: async () => {
      // The entry already asked these three on a cold load of /home (src/boot/homePrefetch.ts): taken once.
      const pre = await takeHomeFirstJobPrefetch(userId!);
      if (pre) return firstJobState(pre.appCount, pre.jobCount, pre.prefs);
      // Independent reads, asked together (they ran one after another: three round trips before Home's first card).
      const [apps, mine, prefsRead] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("helper_id", userId!),
        supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .or(`customer_id.eq.${userId},helper_id.eq.${userId}`),
        supabase.from("notification_preferences").select("job_matches, email_job_matches").eq("user_id", userId!).maybeSingle(),
      ]);
      // A head-only count: unwrap() throws the read error (Q1182) and hands back the count.
      const appCount = unwrap({ data: apps.count, error: apps.error, status: apps.status });
      const jobCount = unwrap({ data: mine.count, error: mine.error, status: mine.status });
      return firstJobState(appCount, jobCount, unwrap(prefsRead));
    },
  });
  return data ?? null;
}

function firstJobState(
  appCount: number | null,
  jobCount: number | null,
  prefs: { job_matches?: boolean | null; email_job_matches?: boolean | null } | null,
): FirstJobState {
  return {
    isNew: (appCount ?? 0) === 0 && (jobCount ?? 0) === 0,
    alertsOff: !!prefs && prefs.job_matches === false && prefs.email_job_matches === false,
  };
}

/** A budget splits across helpers_needed only on a group job. */
const crewSize = (j: NearJob): number => (j.is_group_job && j.helpers_needed ? j.helpers_needed : 1);

interface NearJob {
  id: string;
  title: string;
  budget: number;
  urgent_fee: number | null;
  helpers_needed: number | null;
  is_group_job: boolean | null;
  date_needed: string | null;
  location: string | null;
  parish: string | null;
  distance_band: string | null;
  pricing_mode: string | null;
  helper_fee_flat_cents: number | null;
  helper_fee_percent: number | null;
}

/**
 * The first-job Home (board 189): a five-step checklist from the member's real
 * profile, the open jobs nearest them (the Browse ranking, priced by the ONE
 * money component), an alerts card only while job alerts are off, and a plain
 * "How you get paid" from the shared payout constants.
 */
export function FirstJobHome({ profile, alertsOff }: { profile: Profile | null; alertsOff: boolean }) {
  const navigate = useNavigate();
  const loc = getCachedUserLocation();
  const near = useQuery({
    queryKey: ["home", "jobs-near-you", loc?.lat ?? null, loc?.lng ?? null],
    queryFn: async () =>
      unwrap(await supabase.rpc("get_ranked_open_jobs", {
        p_limit: NEAR_CAP,
        p_offset: 0,
        ...(loc ? { p_lat: loc.lat, p_lng: loc.lng } : {}),
      })) as unknown as NearJob[],
  });

  const skills = (profile?.skills ?? "").trim();
  // Owner ruling 2026-10-23: payout setup is paused while Stripe reviews our
  // account. An unfinished payout step leaves the checklist and the paused
  // notice sits under it instead.
  const setupPaused = usePayoutSetupPaused();
  const payoutsDone = profile?.stripe_payouts_enabled === true;
  // Not while the profile is still loading (null is not "not set up").
  const payoutStepPaused = setupPaused && !!profile && !payoutsDone;
  // AUD31-65: no ID step. Owner rule: the ID check happens once, at hire or first payout, never at sign-up, post,
  // buy or list (the hire and payout doors ask for it themselves).
  const allSteps = [
    { key: "skills", label: skills ? `Pick what you do: ${skills}` : "Pick what you do", done: !!skills, go: () => navigate(SKILLS_FOCUS_PATH) },
    { key: "about", label: "Add a photo and a line about you", done: !!profile?.avatar_url && !!(profile?.bio ?? "").trim(), go: () => navigate("/profile?tab=profile") },
    { key: "payouts", label: "Add your payout bank", done: payoutsDone, go: () => navigate("/profile?tab=payment") },
    { key: "apply", label: "Apply to your first job", done: false, go: () => navigate("/jobs") },
  ];
  const steps = allSteps.filter((st) => st.key !== "payouts" || !payoutStepPaused);
  const jobs = near.data ?? [];

  return (
    <div className="flex flex-col gap-section" data-testid="first-job-home">
      <section aria-label="Get your first job" className="liquid-glass p-card flex flex-col gap-1">
        <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Get your first job</h2>
        <ChecklistSteps steps={steps} />
        {payoutStepPaused && <PayoutSetupPausedNotice compact className="mt-2" />}
      </section>

      {jobs.length > 0 && (
        <section aria-label="Jobs near you" className="flex flex-col gap-2">
          <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Jobs near you · {jobs.length >= NEAR_CAP ? `${NEAR_CAP}+` : jobs.length}
          </h2>
          <div className="liquid-glass flex flex-col divide-y divide-border/60">
            {jobs.slice(0, NEAR_SHOWN).map((j) => (
              <button key={j.id} type="button" title={j.title} onClick={() => navigate(`/jobs/${j.id}`)} className="min-h-11 flex items-center gap-3 px-card py-3 text-left">
                <span className="flex-1 min-w-0">
                  <span className="block text-ds-15 font-semibold text-foreground truncate">{j.title}</span>
                  <span className="block text-ds-13 text-muted-foreground truncate">
                    {[j.location || j.parish, j.distance_band, j.date_needed ? formatShortDate(j.date_needed) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {j.pricing_mode === "quotes" ? (
                  <span className="shrink-0 text-ds-13 font-semibold text-foreground">Quotes</span>
                ) : (
                  <JobPrice
                    budget={j.budget}
                    effectiveFee={TIER_PERKS.free.platformFeePercent}
                    urgentFee={j.urgent_fee ?? 0}
                    helpersNeeded={crewSize(j)}
                    feeStamp={{ helper_fee_flat_cents: j.helper_fee_flat_cents, helper_fee_percent: j.helper_fee_percent }}
                  />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {alertsOff && (
        <section aria-label="New jobs nearby" className="liquid-glass p-card flex items-center gap-3">
          <span className="flex-1 min-w-0">
            <span className="block text-ds-15 font-semibold text-foreground">Get told about new jobs nearby</span>
            <span className="block text-ds-13 text-muted-foreground">Your job alerts are off. Be first to apply.</span>
          </span>
          <Button type="button" variant="primary" size="sm" onClick={() => navigate("/profile?tab=notifications")} className="shrink-0 px-5 text-ds-15 font-semibold">
            Turn on
          </Button>
        </section>
      )}

      <section aria-label="How you get paid" className="liquid-glass p-card flex flex-col gap-1">
        <h2 className="text-ds-15 font-semibold text-foreground">How you get paid</h2>
        <p className="text-ds-13 text-muted-foreground">
          The person who posts the job pays when they hire you. It's held, and released only when they approve the work:
          it reaches your Helpr account {STANDARD_PAYOUT_PHRASE}, and your bank {STANDARD_PAYOUT_WINDOW} after that. Every job shows what you'll take home before you apply, and tips are paid in full.
        </p>
      </section>
    </div>
  );
}

/** One checklist row per step: a tick when done, the label, and the whole row goes to where the step is done. Shared by
 *  the first-job card and the poster's first-job card (UX-5) so the two look alike. */
export function ChecklistSteps({ steps }: { steps: { key: string; label: string; done: boolean; go: () => void }[] }) {
  return (
    <ul className="flex flex-col">
      {steps.map((s) => (
        <li key={s.key}>
          <button type="button" onClick={s.go} className="w-full min-h-11 flex items-center gap-3 text-left" data-step={s.key} data-done={s.done ? "" : undefined}>
            <span
              className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${s.done ? "bg-primary text-primary-foreground" : "border-2 border-border"}`}
              aria-hidden
            >
              {s.done && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
            </span>
            <span className={`text-ds-14 font-semibold ${s.done ? "text-muted-foreground" : "text-foreground"}`}>
              {s.label}
              <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
