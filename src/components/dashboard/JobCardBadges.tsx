import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enJobCard";
import { isTodayJob } from "@/lib/sameDayJob";
import { formatPrice } from "@/lib/format";
import type { JobCardProps } from "./jobCardProps";

/* Moved out of JobCard.tsx unchanged (Q806): the badge rail's secondary chip (slot 2) and status corner (slot 4).
   The rail itself, and why each slot behaves as it does, is described in JobCard.tsx's BADGE RAIL comment. */

/* Design audit A J3 (owner approved 11-08, change 1 of 5): ONE badge per row, small caps words in sienna, no pill,
   no folder tab hanging off the corner. Priority when several apply: Boosted, Urgent, Today, Just in, Recommended
   (the old rail's status corner first, then its one secondary chip, "Just in" before "Recommended"). Urgent keeps its
   bonus in the spoken name only (owner 2026-08-30: "+$10 Urgent" read as on top of the budget). The words come from
   the same i18n keys, so Spanish follows (A3-3). Guard: src/test/jobsHairlineRows.test.tsx. */
export function JobCardBadge({ job, justIn, recommended }: { job: JobCardProps["job"]; justIn: boolean; recommended: boolean }) {
  const { t } = useLanguage();
  const bonus = Number(job.urgent_fee ?? 0);
  const pick: { key: string; text: string; label?: string; testId?: string } | null = job.isBoosted
    ? { key: "boosted", text: t("jobCard.boosted") }
    : job.is_urgent
    ? { key: "urgent", text: t("jobCard.urgent"), label: bonus > 0 ? `Urgent — $${formatPrice(bonus)} bonus` : undefined }
    : isTodayJob(job.date_needed)
    ? { key: "today", text: t("jobCard.today"), testId: "job-card-today" }
    : justIn
    ? { key: "just-in", text: t("jobCard.justIn"), label: t("jobCard.justPosted") }
    : recommended
    ? { key: "recommended", text: t("jobCard.recommended") }
    : null;
  if (!pick) return null;
  return (
    <span
      data-job-badge={pick.key}
      data-testid={pick.testId}
      role={pick.label ? "img" : undefined}
      aria-label={pick.label}
      className="job-row-badge shrink-0 self-center font-sans text-ds-11 font-bold uppercase leading-none tracking-[0.08em] whitespace-nowrap pointer-events-none"
      style={{ color: "hsl(var(--sienna-ink))" }}
    >
      {pick.text}
    </span>
  );
}
