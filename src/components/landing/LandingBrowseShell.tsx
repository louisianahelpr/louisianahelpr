import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useGuestSpanish } from "./useGuestSpanish";

/**
 * The one section frame under the landing's Jobs | Declutter switch (owner 11-09, 10:35 PM: browsing Jobs and browsing
 * Declutter look the same: same section layout, header, card grid and see-all). Both modes draw it:
 *   - Jobs: "Live now / Open jobs near you", the just-finished job as the first card, then the newest open jobs
 *     (LiveJobsSection.tsx);
 *   - Declutter: "Popular now / Popular on Declutter", the popular listings (FreshDeclutterSection.tsx and its strip).
 * The same padding, serif H2, one quiet line under it, the see-all link beside the heading from sm (under the
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
  title: string;
  /** One quiet sentence under the heading (the two facts that used to sit in their own block above it). */
  line: string;
  seeAll: { to: string; label: string };
  children: ReactNode;
  sectionRef?: Ref<HTMLElement>;
  /** A loading placeholder: hidden from assistive tech, no heading, no link. */
  hidden?: boolean;
}) {
  // F260q (owner 11-11): the Spanish words for the English this shell is handed, when the visitor's language is Spanish.
  const es = useGuestSpanish();
  const w = (english: string) => (SHELL_WORD_KEYS[english] && es?.[SHELL_WORD_KEYS[english]]) || english;
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
            {/* D015 (landing design audit 11-10): no "LIVE NOW" / "POPULAR NOW" eyebrow over the heading; the heading
                says it. */}
            {hidden ? (
              <span className="block font-display landing-serif landing-h2" style={{ color: "var(--lp-ink)" }}>{w(title)}</span>
            ) : (
              <h2 id={titleId} className="font-display landing-serif landing-h2" style={{ color: "var(--lp-ink)" }}>
                {w(title)}
              </h2>
            )}
            <p className="text-ds-14 lg:text-ds-15" style={{ color: "var(--lp-body)" }} data-landing-browse-line="">
              {w(line)}
            </p>
          </div>
          {hidden ? <span className="hidden sm:block min-h-11" /> : <LandingSeeAll to={seeAll.to} label={w(seeAll.label)} className="hidden sm:inline-flex" />}
        </div>
        {children}
        {hidden ? <span className="sm:hidden self-center block min-h-11" /> : <LandingSeeAll to={seeAll.to} label={w(seeAll.label)} className="sm:hidden self-center inline-flex" />}
      </div>
    </section>
  );
}

/**
 * The two modes' headings, so the placeholder, the failed state and the real section say the same words. D012 (11-10):
 * one verb per destination on the whole landing: "Browse jobs" for the board, "Shop Declutter" for Declutter.
 */
export const JOBS_SHELL = {
  title: "Open jobs near you",
  line: "You pick who helps. Paid only when it’s done.",
  seeAll: { to: "/browse", label: "Browse jobs" },
} as const;

export const DECLUTTER_SHELL = {
  title: "Popular on Declutter",
  line: "Pick it up, meet up, or have a Helpr deliver it.",
  seeAll: { to: "/declutter", label: "Shop Declutter" },
} as const;

/**
 * D003 (landing design audit 11-10, High): with no open job the first section under the hero was an empty card ("No
 * open jobs right now..."). Then the Jobs view shows real Declutter listings under this heading instead, never an
 * empty card.
 */
export const NO_JOBS_DECLUTTER_SHELL = {
  title: "New on Declutter near you",
  line: "Every job is taken right now. Here’s what neighbors are selling.",
  seeAll: { to: "/declutter", label: "Shop Declutter" },
} as const;

/** The words a browse section draws: heading, one line, its see-all link. */
export type BrowseShellCopy = { readonly title: string; readonly line: string; readonly seeAll: { readonly to: string; readonly label: string } };

/**
 * F260q: the dictionary key for each English sentence the shell draws (enLanding.ts), so the shells above stay the one
 * English source. A sentence not listed here stays English (landingInSpanish.test.tsx lists every shell's words).
 */
const SHELL_WORD_KEYS: Record<string, string> = {
  "Open jobs near you": "landing.shell.jobsTitle",
  "You pick who helps. Paid only when it’s done.": "landing.shell.jobsLine",
  "Photo ID checked before anyone posts or heads out. Paid only when it’s done.": "landing.shell.jobsLineId",
  "Popular on Declutter": "landing.shell.declutterTitle",
  "Pick it up, meet up, or have a Helpr deliver it.": "landing.shell.declutterLine",
  "New on Declutter near you": "landing.shell.noJobsTitle",
  "Every job is taken right now. Here’s what neighbors are selling.": "landing.shell.noJobsLine",
  "Browse jobs": "landing.browseJobs",
  "Shop Declutter": "landing.shopDeclutter",
};
