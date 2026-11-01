/**
 * WHAT A GUEST SEES OF A JOB (JOBS-29, lead decision 2026-10-31, under the owner's 9-2 rule in OWNER-DECISIONS:
 * "Guests see shared jobs: no poster, address, coordinates").
 *
 * A guest who taps a job on the public Browse list, or opens a shared job link, sees the job's title, category,
 * parish and budget, and one way forward: "Sign Up to Apply". Nothing else: no poster name, no address, no
 * coordinates, no description or photos (a description is free text and can carry a street address or a phone
 * number). Before this, the Browse tap went straight to the sign-up form with no job shown first.
 *
 * Guard: src/test/guestSeesFourFacts.test.tsx.
 */
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogPrimaryAction, DialogSecondaryAction } from "@/components/ui/dialog";
import { categoryLabels } from "@/components/job-card/activityConstants";
import { formatCategory, formatPrice } from "@/lib/format";
import { getCity } from "@/lib/locationUtils";
import { parishForCity, parishLabel } from "@/lib/parishes";

/** The only fields this preview reads. The guest's job read selects exactly these (plus status and expiry). */
export const GUEST_JOB_FIELDS = ["id", "title", "category", "budget", "location"] as const;

export type GuestJob = {
  id: string;
  title: string | null;
  category: string | null;
  budget: number | null;
  /** The public view's town ("Lafayette, LA"); never a street address. */
  location: string | null;
};

/** "Lafayette Parish" from the town; the town alone when it names no single parish; null with no town. */
export function guestJobArea(location: string | null | undefined): string | null {
  const town = location ? getCity(location).trim() : "";
  if (!town) return null;
  const parish = parishForCity(town);
  return parish ? parishLabel(parish) : town;
}

/** The four facts, in order, as label and value. Empty values are left out rather than guessed. */
export function guestJobFacts(job: GuestJob): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (job.category) facts.push({ label: "Category", value: categoryLabels[job.category] ?? formatCategory(job.category) });
  const area = guestJobArea(job.location);
  if (area) facts.push({ label: "Parish", value: area });
  if (typeof job.budget === "number" && Number.isFinite(job.budget) && job.budget > 0) facts.push({ label: "Budget", value: `$${formatPrice(job.budget)}` });
  return facts;
}

export function GuestJobPreview({ job, onClose, onSignUp }: {
  job: GuestJob;
  onClose: () => void;
  /** Sign up carrying this job (signupUrlFor(`/jobs/<id>`)), so the job is waiting after sign-up. */
  onSignUp: (jobId: string) => void;
}) {
  const facts = guestJobFacts(job);
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
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Not Now</DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => onSignUp(job.id)}>Sign Up to Apply</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GuestJobPreview;
