import { useMemo, useState } from "react";
import { Quote, ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import type { CaseStudyCard } from "./variants";

/**
 * Case-study carousel — three placeholder cards plus an optional
 * variant-driven highlight card slotted in as the first item.
 *
 * Each card is tagged `data-testid="case-study-card-placeholder"` so the
 * stand-in copy is easy to find and swap out when real customers are
 * willing to be quoted.
 */
const BASE_CASE_STUDIES: CaseStudyCard[] = [
  {
    company: "Lakeshore Vacation Rentals",
    industry: "Short-term rental management",
    quote:
      "Same-day turnovers across 22 units used to mean three vendor calls every Friday. Now it's one dashboard, two clicks.",
    outcome: "Saved 12 hours/week of coordination",
    metric: "12 hrs / wk",
  },
  {
    company: "Audubon Family Dental",
    industry: "Healthcare office services",
    quote:
      "Our after-hours cleaner cancelled. We had an ID-verified helpr in the office that night for $90.",
    outcome: "Cut helper-hiring time by 60%",
    metric: "60% faster",
  },
  {
    company: "River Road Events",
    industry: "Event production",
    quote:
      "We staff load-in and load-out crews entirely through Helpr. No more day-of staffing-agency phone calls at 5am.",
    outcome: "Replaced 4 staffing agencies",
    metric: "4 → 1 vendor",
  },
];

interface CaseStudyCarouselProps {
  highlight?: CaseStudyCard;
}

export function CaseStudyCarousel({ highlight }: CaseStudyCarouselProps) {
  const studies = useMemo(() => {
    if (!highlight) return BASE_CASE_STUDIES;
    return [highlight, ...BASE_CASE_STUDIES.filter((s) => s.company !== highlight.company)].slice(0, 3);
  }, [highlight]);

  const [index, setIndex] = useState(0);

  const prev = () => setIndex((i) => (i - 1 + studies.length) % studies.length);
  const next = () => setIndex((i) => (i + 1) % studies.length);

  return (
    <section
      aria-labelledby="case-studies-heading"
      className="liquid-glass p-6 lg:p-7"
    >
      <div className="flex items-end justify-between mb-5 gap-4">
        <div>
          <span className="text-display-eyebrow">Case studies</span>
          <h2
            id="case-studies-heading"
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.35rem, 2vw + 0.5rem, 1.75rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            How real teams use Helpr.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous case study"
            className="w-10 h-10 rounded-ds-md flex items-center justify-center transition-colors"
            style={{
              background: "hsl(var(--bark) / 0.08)",
              color: "hsl(var(--bark))",
            }}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next case study"
            className="w-10 h-10 rounded-ds-md flex items-center justify-center transition-colors"
            style={{
              background: "hsl(var(--bark) / 0.08)",
              color: "hsl(var(--bark))",
            }}
          >
            <ChevronRight className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Desktop: three-up grid. Mobile: index-driven single card. */}
      <div className="hidden md:grid grid-cols-3 gap-4">
        {studies.map((s) => (
          <CaseStudyCardView key={s.company} study={s} />
        ))}
      </div>
      <div className="md:hidden">
        <CaseStudyCardView study={studies[index]} />
        <div className="flex justify-center gap-2 mt-4">
          {studies.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show case study ${i + 1}`}
              className="w-2 h-2 rounded-full transition-colors"
              style={{
                background:
                  i === index
                    ? "hsl(var(--bark))"
                    : "hsl(var(--olivewood) / 0.3)",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CaseStudyCardView({ study }: { study: CaseStudyCard }) {
  return (
    <article
      data-testid="case-study-card-placeholder"
      className="rounded-ds-md p-5 h-full flex flex-col"
      style={{
        background: "hsl(var(--bark) / 0.04)",
        border: "1px solid hsl(var(--olivewood) / 0.12)",
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-ds-md flex items-center justify-center shrink-0"
          style={{
            background: "hsl(var(--olivewood) / 0.12)",
            color: "hsl(var(--olivewood))",
          }}
          aria-hidden
        >
          <Building2 className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p
            className="text-ds-13 font-semibold leading-tight truncate"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {study.company}
          </p>
          <p className="text-ds-11 text-muted-foreground leading-tight truncate">
            {study.industry}
          </p>
        </div>
      </div>

      <Quote
        className="w-5 h-5 mb-2 opacity-40"
        style={{ color: "hsl(var(--burnt-sienna))" }}
        strokeWidth={1.75}
        aria-hidden
      />
      <blockquote
        className="text-ds-13 leading-relaxed font-sans flex-1"
        style={{ color: "hsl(var(--ink-deep))" }}
      >
        "{study.quote}"
      </blockquote>

      <div
        className="mt-4 pt-3 border-t flex items-center justify-between"
        style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
      >
        <span className="text-ds-11 text-muted-foreground">{study.outcome}</span>
        <span
          className="text-ds-13 font-bold tabular-nums"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          {study.metric}
        </span>
      </div>
    </article>
  );
}

export default CaseStudyCarousel;
