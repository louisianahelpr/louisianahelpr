import { useRef } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { ChevronRight, Loader2 } from "lucide-react";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { getCity } from "@/lib/locationUtils";
import type { JobPageRow } from "./useJobPage";
import { useJobReach } from "./useJobReach";
import { useAddJobPhotos } from "./useAddJobPhotos";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enJobs";

/**
 * Board 57, the poster's open job with nobody applied yet. Shown only when the job is
 * truly out to Helprs (paid and held, payment_status 'escrow', the open_jobs_browse rule)
 * and the applicant read has landed at zero. "Want replies sooner?" offers only what the
 * poster can do today: share the link, and add a photo when there is none (picked and
 * added right here, useAddJobPhotos).
 *
 * Audit 11-21 (High): both rows used to open EditJobDialog, which has no photo field and
 * locks the price once paid, so "Add a photo" and "Change the price" led nowhere. Every
 * row here now does the thing it names; the price row is gone (a paid price cannot change).
 * Guard: JobPage.test.tsx. "Ask for quotes instead" is not offered: quotes are tester-only
 * (the 'quotes' switch).
 */
export function NoApplicantsYet({ job }: { job: JobPageRow }) {
  const { t } = useLanguage();
  const city = job.location ? getCity(job.location) : null;
  // Board 184: the alerts already sent, a floor (sent rows only); 0 or unknown says nothing new.
  const reach = useJobReach(job.id);
  const photoInput = useRef<HTMLInputElement>(null);
  const photos = useAddJobPhotos(job.id, job.photos);
  const rows = [
    !(job.photos ?? []).length && { key: "photo", title: t("jobPage.addPhoto"), detail: t("jobPage.addPhotoWhy"), go: () => photoInput.current?.click() },
  ].filter(Boolean) as { key: string; title: string; detail: React.ReactNode; go: () => void }[];
  return (
    // Design audit r3 #18: one card, left-aligned, a 17 px title (was a 28 px display headline floating outside any
    // card, then an uppercase "WANT REPLIES SOONER?" eyebrow). Guard: src/test/auditR3Mediums.test.tsx.
    <section data-no-applicants="" aria-labelledby="no-applicants-title" className="space-y-3 rounded-2xl border border-border bg-card p-4 text-left lg:col-start-1">
      <h2 id="no-applicants-title" className="text-ds-17 font-semibold text-foreground">{t("jobPage.noApplicants")}</h2>
      <p className="text-ds-14 text-muted-foreground">
        {reach && reach > 0
          ? (reach === 1 ? t("jobPage.sentToOne") : t("jobPage.sentToN", { n: reach }))
          : city ? t("jobPage.outNear", { city }) : t("jobPage.outNearby")}{" "}
        {t("jobPage.tellYou")}
      </p>
      <h3 className="sr-only">{t("jobPage.repliesSooner")}</h3>
      <div className="space-y-2 text-left">
        <ShareJobButton job={{ id: job.id, title: job.title, budget: job.budget, helper_fee_flat_cents: job.helper_fee_flat_cents, helper_fee_percent: job.helper_fee_percent, category: job.category, city: city ?? undefined }} />
        {rows.length > 0 && (
          <ul className="-mx-4 divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <li key={r.key}>
                <ListRow variant="flush" onClick={r.go} disabled={photos.busy} aria-busy={photos.busy || undefined} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-ds-15 font-semibold">{r.title}</span>
                    <span className="block text-ds-13 text-muted-foreground">{r.detail}</span>
                  </span>
                  {photos.busy
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                </ListRow>
              </li>
            ))}
          </ul>
        )}
        <HiddenFileInput
          ref={photoInput}
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          tabIndex={-1}
          aria-hidden
          data-testid="no-applicants-photo-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void photos.add(files);
          }}
        />
      </div>
    </section>
  );
}
