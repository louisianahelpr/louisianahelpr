import { jobCategoryLabel } from "@/lib/jobCategories";
import { sentenceCaseLabel } from "@/lib/jobCategoryGroups";
import { formatPriceExact } from "@/lib/format";

interface Props {
  title: string;
  category: string;
  /** The poster's first photo (a blob preview URL), if any. */
  photo?: string;
  /** The job price the poster set; hidden at 0. */
  budget: number;
}

/**
 * "What Helprs will see" (board 3): the card as it will read in Browse, built
 * only from what the poster has entered so far. No town or time yet: those
 * come on the next screen. With no photo there is no photo area at all
 * (owner, 2026-10-21), matching every surface a Helpr sees. The price is the job price the poster set,
 * never the Helpr's take-home (owner rule, checkoutNoHelperPayLine).
 */
export function PostJobPreviewCard({ title, category, photo, budget }: Props) {
  return (
    <section aria-label="What Helprs will see" className="space-y-2.5">
      <h3 className="font-sans text-ds-12 font-semibold text-muted-foreground">What Helprs will see</h3>
      <div className="overflow-hidden rounded-ds-lg bg-card">
        {/* A real photo or nothing, exactly like Browse (JobCardHeroBand), the quick view and the job page. */}
        {photo && (
          <div className="aspect-[16/10] bg-muted" data-preview-photo="">
            <img src={photo} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            {category && (
              <p className="font-sans text-ds-12 font-semibold text-primary">{sentenceCaseLabel(jobCategoryLabel(category))}</p>
            )}
            <p className="line-clamp-2 font-sans text-ds-17 font-bold text-foreground">{title.trim() || "Your job title"}</p>
          </div>
          {budget > 0 && (
            <span
              className="shrink-0 rounded-full px-3 py-1 font-sans text-ds-15 font-bold tabular-nums"
              style={{ color: "hsl(var(--burnt-sienna))", background: "hsl(var(--burnt-sienna) / 0.10)" }}
            >
              ${formatPriceExact(budget)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
