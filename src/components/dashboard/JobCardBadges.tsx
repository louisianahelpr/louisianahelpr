import { Star, Zap, Rocket } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enJobCard";
import { JobTodayChip } from "@/components/job-card/JobTodayChip";
import { isTodayJob } from "@/lib/sameDayJob";
import { formatPrice } from "@/lib/format";
import type { JobCardProps } from "./jobCardProps";

/* Moved out of JobCard.tsx unchanged (Q806): the badge rail's secondary chip (slot 2) and status corner (slot 4).
   The rail itself, and why each slot behaves as it does, is described in JobCard.tsx's BADGE RAIL comment. */

/* 2. Secondary slot — EXACTLY ONE chip, never both.
   "Just in" outranks "Recommended" because freshness is
   perishable (true for one early-access window, then gone
   forever and unknowable from anywhere else on the card),
   while a recommended pick is already signalled by its
   position — the feed puts it at the top. It is also the
   narrower of the two, so the rail degrades less on a 320px
   phone. Both are `shrink-0`: an ellipsised "Recommen…" or
   "Just i…" carries no information, so they hold their width
   and the category label gives instead. */
export function JobCardSecondaryChip({ justIn, recommended }: { justIn: boolean; recommended: boolean }) {
  const { t } = useLanguage();
  if (justIn)
    return (
      <span role="img"
        aria-label={t("jobCard.justPosted")}
        className="inline-flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-b-lg border-b border-r text-ds-10 font-semibold leading-none shadow-sm pointer-events-none"
        style={{
          background: "hsl(var(--burnt-sienna) / 0.12)",
          // --sienna-ink for the same reason the Recommended chip uses
          // it (see below) — this is small label text on the sienna
          // family's own tint. The floating pill this replaces painted
          // raw --burnt-sienna on a 0.10 tint, i.e. the exact dark-mode
          // contrast failure --sienna-ink was minted to fix.
          color: "hsl(var(--sienna-ink))",
          borderColor: "hsl(var(--burnt-sienna) / 0.20)",
        }}
      >
        <span
          aria-hidden
          className="w-1.5 h-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
          style={{
            background: "hsl(var(--burnt-sienna))",
            boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.55)",
          }}
        />
        <span className="font-sans uppercase tracking-[0.14em] whitespace-nowrap">{t("jobCard.justIn")}</span>
      </span>
    );
  if (recommended)
    return (
      /* Inside the top row, bottom-aligned on the category line (owner 2026-10-28). Guard: recommendedTagSitsInTheRow. */
      <span data-recommended-tag=""
        className="inline-flex items-center gap-1 shrink-0 self-end ml-1 px-1.5 py-0.5 rounded-full text-ds-10 font-semibold leading-none pointer-events-none"
        style={{
          background: "hsl(var(--burnt-sienna) / 0.12)",
          // --sienna-ink, not --burnt-sienna: this is 10px label text on
          // the sienna family's own 12% tint, which is the exact case
          // --sienna-ink was minted for. Raw --burnt-sienna measured
          // 3.89:1 here in dark mode (#d46735 on #332927), under the 4.5
          // AA bar. Light mode is unchanged — the two tokens are
          // byte-identical there.
          color: "hsl(var(--sienna-ink))",
        }}
      >
        <Star
          className="w-2.5 h-2.5 shrink-0"
          strokeWidth={2}
          style={{ fill: "hsl(var(--burnt-sienna) / 0.3)" }}
        />
        <span className="font-sans font-semibold whitespace-nowrap">{t("jobCard.recommended")}</span>
      </span>
    );
  return null;
}

/* 4. Status corner — the single highest-priority signal, mirroring
   the category tab on the opposite corner. */
export function JobCardStatusCorner({ job }: { job: JobCardProps["job"] }) {
  const { t } = useLanguage();
  const corner =
    "inline-flex items-center gap-1 shrink-0 pl-2.5 pr-3 py-1 rounded-bl-lg border-b border-l text-ds-9 font-bold uppercase leading-none shadow-sm";
  if (job.isBoosted)
    return (
      <span role="img"
        className={`boosted-pulse ${corner}`}
        aria-label={t("jobCard.boosted")}
        style={{
          // --boost, not gold (P1). A --boost token already existed for
          // exactly this chip; painting it gold made a paid promotion
          // look identical to a Pro badge, which is why gold stopped
          // signalling status. 25° vs 38° — barely a shade apart, but
          // now the two mean different things.
          color: "hsl(var(--boost-ink))",
          background: "hsl(var(--boost-tint) / 0.16)",
          borderColor: "hsl(var(--boost-tint) / 0.5)",
          letterSpacing: "0.05em",
        }}
      >
        <Rocket className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} style={{ color: "hsl(var(--boost-tint))", fill: "hsl(var(--boost-tint) / 0.35)" }} />
        {t("jobCard.boosted")}
      </span>
    );
  if (job.is_urgent) {
    const bonus = Number(job.urgent_fee ?? 0);
    return (
      <span role="img"
        className={`urgent-pulse ${corner}`}
        aria-label={bonus > 0 ? `Urgent — $${formatPrice(bonus)} bonus` : t("jobCard.urgent")}
        style={{
          // --accent-ink, not --accent: 9px bold label text on the
          // accent's own 15% tint. Raw --accent measured 3.75:1 in
          // dark mode (#d46735 on #382b27, device-pass /home
          // 375-dark + 1440-dark), under the 4.5 AA bar. Light mode
          // is unchanged — the two tokens are byte-identical there.
          color: "hsl(var(--accent-ink))",
          background: "hsl(var(--accent) / 0.15)",
          borderColor: "hsl(var(--accent) / 0.5)",
          letterSpacing: "0.05em",
        }}
      >
        <Zap className="w-2.5 h-2.5 shrink-0" style={{ color: "hsl(var(--accent))", fill: "hsl(var(--accent))" }} />
        {/* Just "Urgent", not "+$10 Urgent" (owner 2026-08-30: read as on top of the budget); the bonus stays in the aria-label. */}
        {t("jobCard.urgent")}
      </span>
    );
  }
  if (isTodayJob(job.date_needed)) {
    return <JobTodayChip className={corner} />;
  }
  return null;
}

