/**
 * WHAT A GUEST SEES OF A JOB (JOBS-29, lead decision 2026-10-31, under the owner's 9-2 rule in OWNER-DECISIONS:
 * "Guests see shared jobs: no poster, address, coordinates").
 *
 * A guest who taps a job on the public Browse list, or opens a shared job link, sees the job's title, category,
 * town and parish, its day and time, and what they would earn after fees, and one way forward: "Sign up to apply".
 * F217 (whole-app audit 2026-11-10): the sheet dropped the day, time and town the card had just shown, and "You'd take
 * home" read as a different figure from the card's bare price. Nothing else: no poster name, no address, no
 * coordinates, no description or photos (a description is free text and can carry a street address or a phone
 * number). Before this, the Browse tap went straight to the sign-up form with no job shown first.
 *
 * THE SAME FIGURE AS THE CARD (lead 2026-10-31, on b49's finding): the guest Browse card shows the take-home
 * ("$74"), so the preview reads "You'd take home $74" from the same computation (JobPrice's computeNet at the
 * free tier, the group split, the fee stamp), never "Budget $85" beside a card that said $74.
 * The X closes it (owner 10-31 14:22: every sheet keeps the X only, no drag bar).
 *
 * Guard: src/test/guestSeesFourFacts.test.tsx.
 */
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogPrimaryAction } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { categoryLabels } from "@/components/job-card/activityConstants";
import { computeNet } from "@/components/dashboard/JobPrice";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { formatCategory, formatPriceFloor } from "@/lib/format";
import { isGiveawayFixedPayJob, type FlatFeeStamp } from "@/lib/helprFlatFee";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { getCity } from "@/lib/locationUtils";
import { parishForCity, parishLabel } from "@/lib/parishes";
import { jobDayLabel } from "@/lib/jobDateWindow";
import { FLEXIBLE_TIME_LABEL, jobStartTimeLabel } from "@/lib/jobDate";

/**
 * The only fields this preview reads. The guest's job read selects exactly these (plus status and expiry). The
 * next five are what the take-home needs (the card's JobPrice reads the same ones); the last four are the day and time
 * the card prints (F217). None is private.
 */
export const GUEST_JOB_FIELDS = [
  "id", "title", "category", "budget", "location",
  "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent",
  "date_needed", "date_window_end", "start_time", "is_flexible_schedule",
] as const;

export type GuestJob = FlatFeeStamp & {
  id: string;
  title: string | null;
  category: string | null;
  budget: number | null;
  /** The public view's town ("Lafayette, LA"); never a street address. */
  location: string | null;
  urgent_fee?: number | null;
  is_group_job?: boolean | null;
  helpers_needed?: number | null;
  status?: string | null;
  date_needed?: string | null;
  date_window_end?: string | null;
  start_time?: string | null;
  is_flexible_schedule?: boolean | null;
  /** The view's parish stem, read only for the share line (jobShareLine.mjs, F269a); the sheet derives its own. */
  parish?: string | null;
  /** F268a (owner 11-12): the shared-link page only (GuestJobPage). The view's guest copy, masked on the server
   *  (mask_guest_contact). The Browse sheet never prints it. */
  description?: string | null;
};

/** The pay label: the same words on the sheet for every paid job, so it never reads as a second figure (F217). */
const GUEST_PAY_LABEL = "You'd earn after fees";

/** The fee rate a guest card is priced at (DashboardGuest passes the same to every guest JobCard). */
export const GUEST_FEE_PERCENT = TIER_PERKS.free.platformFeePercent;

/**
 * What the guest would take home, floored to the dollar: the guest Browse card's own figure (JobPrice's chip with
 * effectiveFee GUEST_FEE_PERCENT, the group split and the fee stamp). Null with no budget.
 */
export function guestTakeHome(job: GuestJob, firstPayoutFeeDollars = 0): number | null {
  if (!(typeof job.budget === "number" && Number.isFinite(job.budget) && job.budget > 0)) return null;
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const firstPayoutFee = job.status === "disputed" || isGiveawayFixedPayJob(job) ? 0 : firstPayoutFeeDollars;
  const net = computeNet(job.budget, GUEST_FEE_PERCENT, job.urgent_fee ?? 0, helpers, firstPayoutFee, job).netEarnings;
  return net > 0 ? net : null;
}

/** "Lafayette Parish" from the town; the town alone when it names no single parish; null with no town. */
export function guestJobArea(location: string | null | undefined): string | null {
  const town = location ? getCity(location).trim() : "";
  if (!town) return null;
  const parish = parishForCity(town);
  return parish ? parishLabel(parish) : town;
}

/** The facts, in order, as label and value. Empty values are left out rather than guessed. */
export function guestJobFacts(job: GuestJob, firstPayoutFeeDollars = 0): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (job.category) facts.push({ label: "Category", value: categoryLabels[job.category] ?? formatCategory(job.category) });
  const town = job.location ? getCity(job.location).trim() : "";
  const area = guestJobArea(job.location);
  if (town && area && area !== town) facts.push({ label: "Town", value: town });
  if (area) facts.push({ label: "Parish", value: area });
  // The card's own "when": its day (or window) and clock time, else Flexible (JobCard's meta row).
  const day = jobDayLabel(job);
  const time = jobStartTimeLabel(job.start_time, job.is_flexible_schedule);
  const when = [day, time].filter(Boolean).join(" · ") || (job.date_needed || job.start_time ? "" : FLEXIBLE_TIME_LABEL);
  if (when) facts.push({ label: "When", value: when });
  const net = guestTakeHome(job, firstPayoutFeeDollars);
  // Owner 2026-10-30: the giveaway shows its pay with no "take home" words.
  if (net != null) facts.push({ label: isGiveawayFixedPayJob(job) ? "Pay" : GUEST_PAY_LABEL, value: `$${formatPriceFloor(net)}` });
  return facts;
}

/** F268a (audit 11-10): "Log in" from the guest preview comes back to this job after sign-in. */
export const guestLogInUrl = (jobId: string) => `/login?redirect=${encodeURIComponent(`/jobs/${jobId}`)}`;

export function GuestJobPreview({ job, onClose, onSignUp, onLogIn }: {
  job: GuestJob;
  onClose: () => void;
  /** Sign up carrying this job (signupUrlFor(`/jobs/<id>`)), so the job is waiting after sign-up. */
  onSignUp: (jobId: string) => void;
  /** F268a: a member opening a shared link logs in and comes back to the job (guestLogInUrl). */
  onLogIn?: (jobId: string) => void;
}) {
  // A guest has no profile, so this is 0 for them, exactly as on the card's chip.
  const facts = guestJobFacts(job, useFirstPayoutFeeDollars());
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-guest-job-preview="">
        <DialogHero title={job.title?.trim() || "Job"} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-sans text-ds-13">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="font-semibold text-foreground text-right">{f.value}</dd>
            </div>
          ))}
        </dl>
        {/* No "Not now": the sheet's X closes it (owner 10-31, every sheet has the X). */}
        <DialogFooter>
          <DialogPrimaryAction onClick={() => onSignUp(job.id)}>Sign up to apply</DialogPrimaryAction>
        </DialogFooter>
        {onLogIn && (
          // F268a (audit 11-10): someone with an account had to find Log in behind the blur.
          <p className="text-center font-sans text-ds-13 text-muted-foreground" data-guest-log-in="">
            Already a member?{" "}
            <Button type="button" variant="link" size="sm" className="px-1 text-ds-13 font-semibold" onClick={() => onLogIn(job.id)}>
              Log in
            </Button>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
