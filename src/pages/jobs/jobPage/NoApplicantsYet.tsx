import { ChevronRight } from "lucide-react";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { formatPrice } from "@/lib/format";
import { getCity } from "@/lib/locationUtils";
import type { JobPageRow } from "./useJobPage";

/**
 * Board 57, the poster's open job with nobody applied yet. Shown only when the job is
 * truly out to Helprs (paid and held, payment_status 'escrow', the open_jobs_browse rule)
 * and the applicant read has landed at zero. "Want replies sooner?" offers only what the
 * poster can do today: share the link, add a photo when there is none, change the price
 * (both through the Posted card's edit). "Ask for quotes instead" is not offered: quotes
 * are tester-only (the 'quotes' switch).
 */
export function NoApplicantsYet({ job, onManage }: { job: JobPageRow; onManage: () => void }) {
  const city = job.location ? getCity(job.location) : null;
  const rows = [
    !(job.photos ?? []).length && { key: "photo", title: "Add a photo", detail: "Jobs with photos are easier to say yes to" },
    { key: "price", title: "Change the price", detail: <>You're at <span className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">${formatPrice(job.budget)}</span></> },
  ].filter(Boolean) as { key: string; title: string; detail: React.ReactNode }[];
  return (
    <section data-no-applicants="" aria-labelledby="no-applicants-title" className="space-y-3 text-center lg:col-start-1">
      <h2 id="no-applicants-title" className="font-display font-moment text-ds-28 font-semibold">No applicants yet</h2>
      <p className="text-ds-14 text-muted-foreground">
        {city ? `It's out to Helprs near ${city}.` : "It's out to Helprs nearby."} We'll tell you when someone applies.
      </p>
      <h3 className="pt-2 text-left text-ds-12 font-semibold uppercase tracking-wide text-muted-foreground">Want replies sooner?</h3>
      <div className="space-y-2 text-left">
        <ShareJobButton job={{ id: job.id, title: job.title, budget: job.budget, category: job.category, city: city ?? undefined }} />
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={onManage} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-ds-15 font-semibold">{r.title}</span>
                  <span className="block text-ds-13 text-muted-foreground">{r.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
