/**
 * WHAT A GUEST SEES OF A JOB (JOBS-29, lead decision 2026-10-31, under the owner's 9-2 rule in OWNER-DECISIONS:
 * "Guests see shared jobs: no poster, address, coordinates").
 *
 * A guest who taps a job on the public Browse list, or opens a shared job link, sees the job's title, category,
 * town and parish, its day and time, and its pay, and one way forward: "Sign up to apply".
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
 * Audit 11-21 (P11): the guest job PAGE shows the server-masked Details now (owner 11-12, F268a), so the sheet links to
 * it ("See the whole job"); the sheet itself still shows no free text.
 *
 * Guard: src/test/guestSeesFourFacts.test.tsx.
 */
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogPrimaryAction } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { categoryLabels } from "@/components/job-card/activityConstants";
import { computeNet } from "@/components/dashboard/JobPrice";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { formatCategory, formatPriceFloor } from "@/lib/format";
import { isGiveawayFixedPayJob, type FlatFeeStamp } from "@/lib/helprFlatFee";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { getCity } from "@/lib/locationUtils";
import { parishForTown, parishLabel } from "@/lib/parishes";
import { wordInLang } from "@/lib/i18n/inLang";
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
  // Design audit areas 11-18 #5: "New Orleans" is Orleans Parish (parishForTown knows a parish's primary city).
  const parish = parishForTown(town);
  return parish ? parishLabel(parish) : town;
}

/** Design audit areas 11-18 #1: a fact's label in the reader's language (the labels stay English as data). */
const FACT_KEYS: Record<string, string> = {
  Category: "pub.fact.Category",
  Town: "pub.fact.Town",
  Parish: "pub.fact.Parish",
  Area: "pub.fact.Area",
  When: "pub.fact.When",
  Day: "pub.fact.Day",
  Time: "pub.fact.Time",
  Pay: "pub.fact.Pay",
};
export const guestFactLabel = (label: string): string => (FACT_KEYS[label] ? wordInLang(FACT_KEYS[label], label) : label);

/** The facts, in order, as label and value. Empty values are left out rather than guessed. */
export function guestJobFacts(job: GuestJob, firstPayoutFeeDollars = 0): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (job.category) facts.push({ label: "Category", value: categoryLabels[job.category] ?? formatCategory(job.category) });
  const town = job.location ? getCity(job.location).trim() : "";
  const area = guestJobArea(job.location);
  if (town && area && area !== town) facts.push({ label: "Town", value: town });
  // Design audit areas 11-18 #5: "Area" when the town names no single parish (it said "Parish: Nowhere Special").
  if (area) facts.push({ label: town && parishForTown(town) ? "Parish" : "Area", value: area });
  // The card's own "when": its day (or window) and clock time, else Flexible (JobCard's meta row).
  const day = jobDayLabel(job);
  const time = jobStartTimeLabel(job.start_time, job.is_flexible_schedule);
  // Owner 2026-11-18: day and time each get their own row ("seperate teh day and time give each their own ine").
  if (day) facts.push({ label: "Day", value: day });
  if (time) facts.push({ label: "Time", value: time });
  else if (!day && !(job.date_needed || job.start_time)) facts.push({ label: "Time", value: FLEXIBLE_TIME_LABEL });
  const net = guestTakeHome(job, firstPayoutFeeDollars);
  // Owner 2026-10-30: the giveaway shows its pay with no "take home" words.
  // The pay row says "Pay" for every paid job (F217: one label, never a second figure; owner 2026-11-27, polish audit
  // #1: no "You'd earn after fees"). Guard: src/test/noAfterFeesAnywhere1127.test.ts.
  if (net != null) facts.push({ label: "Pay", value: `$${formatPriceFloor(net)}` });
  return facts;
}

/** F268a: "Log in" comes back to this job (src/lib/jobIntent.ts, so guest /browse names it without this dialog). */
export { guestLogInUrl } from "@/lib/jobIntent";

export function GuestJobPreview({ job, onClose, onSignUp }: {
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
              <dt className="text-muted-foreground">{guestFactLabel(f.label)}</dt>
              <dd className="font-semibold text-foreground text-right">{f.value}</dd>
            </div>
          ))}
        </dl>
        <Button asChild variant="link" size="sm" className="self-start px-0 text-ds-13 font-semibold">
          <Link to={`/jobs/${encodeURIComponent(job.id)}`} data-guest-whole-job="">{wordInLang("pub.job.seeWhole", "See the whole job")}</Link>
        </Button>
        {/* No "Not now": the sheet's X closes it (owner 10-31, every sheet has the X). */}
        <DialogFooter>
          <DialogPrimaryAction onClick={() => onSignUp(job.id)}>{wordInLang("pub.job.signUpApply", "Sign up to apply")}</DialogPrimaryAction>
        </DialogFooter>
        {/* Polish audit 11-27 #5: one sign-up action per sheet. "Already a member? Log in" is gone; the header's Log in
            covers it (F268a had added it). */}
      </DialogContent>
    </Dialog>
  );
}
