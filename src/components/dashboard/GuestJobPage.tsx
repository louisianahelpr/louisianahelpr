/**
 * A SHARED JOB LINK OPENED SIGNED OUT: THE JOB'S OWN READ-ONLY PAGE (F268a, owner 2026-11-12, OWNER-DECISIONS: "a
 * signed-out visitor opening a shared job link sees a FULL read-only job page with the description and Sign up to
 * apply ... Still no poster, address or coordinates (9-2 rule)"). It replaces the small sheet over a blurred page
 * (GuestJobPreview) on /jobs/:id only; a tap on the guest Browse list still opens that sheet.
 *
 * What it prints: the title (JobDetail's h1), the facts the sheet prints (category, town, parish, day and time, the
 * guest card's own take-home: guestJobFacts), and the description. The description is the public view's GUEST copy:
 * open_jobs_browse masks phone numbers and numbered street addresses for anon on the server (mask_guest_contact,
 * 20261112202620), so nothing here filters it again. No poster, no address, no coordinates, no photos.
 *
 * Guards: src/test/guestOpensSharedJobLink.test.tsx (the page, its reads, its ways on),
 * src/test/pglite/guestsReadMaskedJobDescription.pglite.mjs (the server-side mask).
 */
import { Button } from "@/components/ui/button";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { guestJobFacts, type GuestJob } from "@/components/dashboard/GuestJobPreview";

export function GuestJobPage({ job, onSignUp, onLogIn, onBrowse }: {
  job: GuestJob;
  /** Sign up carrying this job (signupUrlFor(`/jobs/<id>`)), so the job is waiting after sign-up. */
  onSignUp: (jobId: string) => void;
  /** A member logs in and comes back to this job (guestLogInUrl). */
  onLogIn: (jobId: string) => void;
  /** The public Browse list. */
  onBrowse: () => void;
}) {
  // A guest has no profile, so this is 0 for them, exactly as on the card's chip.
  const facts = guestJobFacts(job, useFirstPayoutFeeDollars());
  const details = job.description?.trim() ?? "";
  return (
    <article data-guest-job-page="" className="space-y-5">
      <dl className="border-y border-border">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
            <dt className="shrink-0 text-ds-14 text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 text-right text-ds-14 font-semibold text-foreground [overflow-wrap:anywhere]">{f.value}</dd>
          </div>
        ))}
      </dl>
      {details && (
        <section aria-labelledby="guest-job-details" className="rounded-2xl border border-border bg-card p-4">
          <h2 id="guest-job-details" className="text-ds-16 font-semibold">Details</h2>
          <p data-guest-job-description="" className="mt-1.5 whitespace-pre-line text-ds-15 leading-relaxed [overflow-wrap:anywhere]">
            {details}
          </p>
        </section>
      )}
      <div className="space-y-2">
        <Button type="button" className="w-full" data-guest-sign-up="" onClick={() => onSignUp(job.id)}>
          Sign up to apply
        </Button>
        <p className="text-center font-sans text-ds-13 text-muted-foreground" data-guest-log-in="">
          Already a member?{" "}
          <Button type="button" variant="link" size="sm" className="px-1 text-ds-13 font-semibold" onClick={() => onLogIn(job.id)}>
            Log in
          </Button>
        </p>
        <p className="text-center">
          <Button type="button" variant="link" size="sm" className="px-1 text-ds-13" data-guest-browse="" onClick={onBrowse}>
            See other open jobs
          </Button>
        </p>
      </div>
    </article>
  );
}
