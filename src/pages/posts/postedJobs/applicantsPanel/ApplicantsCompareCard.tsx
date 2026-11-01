import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { Button } from "@/components/ui/button";
import { formatName } from "@/lib/utils";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { sentenceCaseLabel } from "@/lib/jobCategoryGroups";
import type { EnrichedApplication } from "@/components/job-card/activityConstants";

/**
 * Board 170: the sticky side card beside the desktop applicants table.
 * "Comparing 2" with one row per fact, each fact read from the same rows the
 * table shows (public rating and its count, completed jobs, completed jobs in
 * this job's category when that count is known, ID check, distance band), and
 * a Hire per pick that goes through the row's own onAcceptApplication. A fact
 * we do not have is left out, never guessed: the board's "Replies in" and
 * "Before/after photos" have no data behind them, so they are not drawn.
 * Never the Helpr's take-home (poster screen, checkoutNoHelperPayLine).
 */
export function ApplicantsCompareCard({
  picked,
  completedCount,
  categoryCount,
  category,
  distanceOf,
  onHire,
  clear,
}: {
  picked: EnrichedApplication[];
  completedCount: (app: EnrichedApplication) => number;
  /** Completed jobs in this job's category; undefined when not known (switch off, read failed). */
  categoryCount: (app: EnrichedApplication) => number | undefined;
  category: string;
  distanceOf: (app: EnrichedApplication) => string | null;
  onHire: (app: EnrichedApplication) => void;
  clear: () => void;
}) {
  // "not yet" promises a check; with the ID check off (owner 2026-10-23) it is a plain "no".
  const idOn = useIdentityCheckOnStore();
  const first = (a: EnrichedApplication) => formatName(a.profiles?.full_name, "Helpr").split(" ")[0];
  const joined = (value: (a: EnrichedApplication) => string) => picked.map((a) => `${first(a)} ${value(a)}`).join(" · ");
  const rows: { label: string; text: string }[] = [
    { label: "Rating", text: joined((a) => ((a.reviewCount ?? 0) > 0 ? `${(a.avgRating ?? 0).toFixed(1)} from ${a.reviewCount}` : "no reviews yet")) },
    { label: "Jobs done", text: joined((a) => String(completedCount(a))) },
  ];
  if (picked.length > 0 && picked.every((a) => categoryCount(a) !== undefined)) {
    rows.push({ label: `${sentenceCaseLabel(jobCategoryLabel(category))} jobs`, text: joined((a) => String(categoryCount(a))) });
  }
  rows.push({ label: "ID checked", text: joined((a) => (a.profiles?.is_id_verified === true ? "yes" : idOn ? "not yet" : "no")) });
  if (picked.some((a) => distanceOf(a))) rows.push({ label: "Distance", text: joined((a) => distanceOf(a) ?? "not shared") });

  return (
    <aside
      aria-label="Compare applicants"
      className="sticky top-4 rounded-ds-lg border border-border bg-card p-4 shadow-[var(--card-shadow)]"
      data-compare-card=""
    >
      {picked.length < 2 ? (
        <>
          <h2 className="text-ds-16 font-bold">Compare</h2>
          <p className="mt-1 text-ds-13 text-muted-foreground">Tick Compare on 2 or 3 Helprs to see them side by side.</p>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-ds-16 font-bold">Comparing {picked.length}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={clear} className="px-1 text-ds-12 font-semibold tracking-normal text-muted-foreground hover:text-foreground">
              Clear
            </Button>
          </div>
          <dl className="mt-1">
            {rows.map((r) => (
              <div key={r.label} className="border-b border-border py-2.5 last:border-b-0">
                <dt className="text-ds-14 font-semibold">{r.label}</dt>
                <dd className="text-ds-12 text-muted-foreground">{r.text}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {picked.map((a, i) => (
              <Button
                key={a.id}
                variant={i === 0 ? "primary" : "outline"}
                className="min-w-0 flex-1 rounded-full"
                onClick={() => {
                  clear();
                  onHire(a);
                }}
              >
                Hire {first(a)}
              </Button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
