import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

/**
 * The one section frame under the landing's Jobs | Declutter switch (owner 11-09, 10:35 PM: browsing Jobs and browsing
 * Declutter look the same: same section layout, header, card grid and see-all). Both modes draw it:
 *   - Jobs: "Live now / Open jobs near you", the just-finished job as the first card, then the newest open jobs
 *     (LiveJobsSection.tsx);
 *   - Declutter: "Popular now / Popular on Declutter", the popular listings (FreshDeclutterSection.tsx and its strip).
 * The same padding, eyebrow, serif H2, one quiet line under it, the see-all link beside the heading from sm (under the
 * grid on a phone), and the max-w-6xl measure every landing section uses.
 */
function LandingSeeAll({ to, label, className }: { to: string; label: string; className: string }) {
  return (
    <Link
      to={to}
      className={`group items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard ${className}`}
      style={{ color: "var(--lp-action-strong)" }}
    >
      {label}
      <ArrowRight className="w-4 h-4" aria-hidden />
    </Link>
  );
}

export function LandingBrowseShell({
  testId,
  titleId,
  eyebrow,
  title,
  line,
  seeAll,
  children,
  sectionRef,
  hidden,
}: {
  testId: string;
  /** The H2's id (the section's aria-labelledby); omitted for a placeholder, which draws a plain span instead. */
  titleId?: string;
  eyebrow: string;
  title: string;
  /** One quiet sentence under the heading (the two facts that used to sit in their own block above it). */
  line: string;
  seeAll: { to: string; label: string };
  children: ReactNode;
  sectionRef?: Ref<HTMLElement>;
  /** A loading placeholder: hidden from assistive tech, no heading, no link. */
  hidden?: boolean;
}) {
  return (
    <section
      ref={sectionRef}
      data-testid={testId}
      aria-labelledby={hidden ? undefined : titleId}
      aria-hidden={hidden || undefined}
      className="px-5 sm:px-8 lg:px-12 pt-8 pb-12 lg:pt-12 lg:pb-20"
      style={{ background: "var(--lp-surface)" }}
    >
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 lg:gap-8" data-testid={`${testId}-measure`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="inline-flex items-center gap-2 text-ds-11 lg:text-ds-12 font-bold uppercase tracking-[0.1em]" style={{ color: "var(--lp-action-strong)" }}>
              <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: "var(--lp-action)" }} />
              {eyebrow}
            </span>
            {hidden ? (
              <span className="block font-display landing-serif leading-[1.05] text-ds-28" style={{ color: "var(--lp-ink)" }}>{title}</span>
            ) : (
              <h2 id={titleId} className="font-display landing-serif leading-[1.05] text-ds-28" style={{ color: "var(--lp-ink)" }}>
                {title}
              </h2>
            )}
            <p className="text-ds-14 lg:text-ds-15" style={{ color: "var(--lp-body)" }} data-landing-browse-line="">
              {line}
            </p>
          </div>
          {hidden ? <span className="hidden sm:block min-h-11" /> : <LandingSeeAll to={seeAll.to} label={seeAll.label} className="hidden sm:inline-flex" />}
        </div>
        {children}
        {hidden ? <span className="sm:hidden self-center block min-h-11" /> : <LandingSeeAll to={seeAll.to} label={seeAll.label} className="sm:hidden self-center inline-flex" />}
      </div>
    </section>
  );
}

/** The two modes' headings, so the placeholder, the failed state and the real section say the same words. */
export const JOBS_SHELL = {
  eyebrow: "Live now",
  title: "Open jobs near you",
  line: "You pick who helps. Paid only when it’s done.",
  seeAll: { to: "/browse", label: "Browse local jobs" },
} as const;

export const DECLUTTER_SHELL = {
  eyebrow: "Popular now",
  title: "Popular on Declutter",
  line: "Pick it up, meet up, or have a Helpr deliver it.",
  seeAll: { to: "/declutter", label: "See everything" },
} as const;
