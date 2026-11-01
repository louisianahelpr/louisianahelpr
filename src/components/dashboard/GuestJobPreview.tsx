/**
 * WHAT A GUEST SEES OF A JOB (JOBS-29, lead decision 2026-10-31, under the owner's 9-2 rule in OWNER-DECISIONS:
 * "Guests see shared jobs: no poster, address, coordinates").
 *
 * A guest who taps a job on the public Browse list, or opens a shared job link, sees the job's title, category,
 * parish and what they would take home, and one way forward: "Sign Up to Apply". Nothing else: no poster name, no address, no
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
import { categoryLabels } from "@/components/job-card/activityConstants";
import { computeNet } from "@/components/dashboard/JobPrice";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { formatCategory, formatPriceFloor } from "@/lib/format";
import { isGiveawayFixedPayJob, type FlatFeeStamp } from "@/lib/helprFlatFee";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { getCity } from "@/lib/locationUtils";
import { parishForCity, parishLabel } from "@/lib/parishes";

/**
 * The only fields this preview reads. The guest's job read selects exactly these (plus status and expiry). The
 * last five are what the take-home needs (the card's JobPrice reads the same ones); none is private.
 */
export const GUEST_JOB_FIELDS = [
  "id", "title", "category", "budget", "location",
  "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent",
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
  const parish = parishForCity(town);
  return parish ? parishLabel(parish) : town;
}

/** The facts, in order, as label and value. Empty values are left out rather than guessed. */
export function guestJobFacts(job: GuestJob, firstPayoutFeeDollars = 0): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (job.category) facts.push({ label: "Category", value: categoryLabels[job.category] ?? formatCategory(job.category) });
  const area = guestJobArea(job.location);
  if (area) facts.push({ label: "Parish", value: area });
  const net = guestTakeHome(job, firstPayoutFeeDollars);
  // Owner 2026-10-30: the giveaway shows its pay with no "take home" words.
  if (net != null) facts.push({ label: isGiveawayFixedPayJob(job) ? "Pay" : "You'd take home", value: `$${formatPriceFloor(net)}` });
  return facts;
}

export function GuestJobPreview({ job, onClose, onSignUp }: {
  job: GuestJob;
  onClose: () => void;
  /** Sign up carrying this job (signupUrlFor(`/jobs/<id>`)), so the job is waiting after sign-up. */
  onSignUp: (jobId: string) => void;
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
        {/* No "Not Now": the sheet's X closes it (owner 10-31, every sheet has the X). */}
        <DialogFooter>
          <DialogPrimaryAction onClick={() => onSignUp(job.id)}>Sign Up to Apply</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
