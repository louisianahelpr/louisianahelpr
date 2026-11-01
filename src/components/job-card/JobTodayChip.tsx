import { Zap } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enJobs";

/**
 * Q2438: a browse card for a job dated Louisiana's today wears "Today" in the
 * corner, below Boosted and Urgent (which keep it). `className` is the card's
 * corner chip class.
 */
export function JobTodayChip({ className }: { className: string }) {
  // Jobs in Spanish (A3-3): the chip follows the member's language.
  const { t } = useLanguage();
  return (
    <span
      className={className}
      data-testid="job-card-today"
      style={{
        color: "hsl(var(--bark))",
        background: "hsl(var(--bark) / 0.12)",
        borderColor: "hsl(var(--bark) / 0.4)",
        letterSpacing: "0.05em",
      }}
    >
      <Zap className="w-2.5 h-2.5 shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden />
      {t("jobCard.today")}
    </span>
  );
}
