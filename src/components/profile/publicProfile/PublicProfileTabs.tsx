/**
 * /u/<handle> on a phone (owner 11-14, Depop/Vinted review item 10): the sections under the compact header become
 * tabs that pin to the top while the page scrolls, like Depop's Shop / Likes. Below lg only: the tab bar is lg:hidden
 * and from lg every section shows, stacked, exactly as before (the desktop page is unchanged).
 *
 * A tab exists only for a section the page already shows (nothing new is made public): For sale (live listings),
 * Jobs (open jobs), Work (work photos, job photos, skills, jobs done and reviews; always on your own page, which
 * offers "Add work photos"), Looking for (Wanted posts). A section with no tab of its own keeps showing.
 */
import { useRef } from "react";
import type { PublicProfile } from "@/lib/profileLink/api";

export type ProfileTabKey = "sale" | "jobs" | "work" | "wanted";
export interface ProfileTab {
  key: ProfileTabKey;
  label: string;
  count?: number;
}

/** The tabs for this page, in the page's section order. */
export function profileTabs(p: PublicProfile, opts: { isMe: boolean; skillCount: number }): ProfileTab[] {
  const tabs: ProfileTab[] = [];
  if (p.listings.length > 0) tabs.push({ key: "sale", label: "For sale", count: Math.max(p.listing_count ?? 0, p.listings.length) });
  if (p.jobs.length > 0) tabs.push({ key: "jobs", label: "Jobs", count: Math.max(p.job_count ?? 0, p.jobs.length) });
  const work = (p.portfolio_urls?.length ?? 0) + (p.helpr.jobs_done ?? 0) + p.helpr.reviews.length + opts.skillCount;
  if (work > 0 || opts.isMe) tabs.push({ key: "work", label: "Work" });
  if (p.wanted.length > 0) tabs.push({ key: "wanted", label: "Looking for", count: p.wanted.length });
  return tabs;
}

/** The tab that is showing: the chosen one while it still exists, else the first. */
export function activeTab(tabs: ProfileTab[], chosen: ProfileTabKey | null): ProfileTabKey | null {
  if (chosen && tabs.some((t) => t.key === chosen)) return chosen;
  return tabs[0]?.key ?? null;
}

/** A section's class on a phone: hidden while another tab is showing. A section with no tab always shows. */
export function paneHiddenClass(tabs: ProfileTab[], active: ProfileTabKey | null, key: ProfileTabKey): string {
  return active && key !== active && tabs.some((t) => t.key === key) ? "max-lg:hidden" : "";
}

/** The page's scroller: the AppPage column for a member, the document for a guest. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>("[data-app-page-scroll]") ?? (document.scrollingElement as HTMLElement | null);
}

export function PublicProfileTabs({
  tabs,
  active,
  onSelect,
  stickyClassName,
}: {
  tabs: ProfileTab[];
  active: ProfileTabKey | null;
  onSelect: (key: ProfileTabKey) => void;
  /** Where the bar pins and how far it bleeds to the scroller's edges (the shells differ: AppPage / public header). */
  stickyClassName: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const select = (key: ProfileTabKey) => {
    if (key === active) return;
    // Pinned (scrolled past the header), a new tab starts at its top: scroll back to where the bar first pins, so its
    // first row is never left under the bar part-way down the old tab's length.
    const b = bar.current;
    const prev = b?.previousElementSibling;
    let back = 0;
    if (b && prev) {
      const natural = prev.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(b).marginTop) || 0);
      back = b.getBoundingClientRect().top - natural;
    }
    onSelect(key);
    if (b && back > 1) {
      const s = scrollerOf(b);
      requestAnimationFrame(() => { if (s) s.scrollTop = Math.max(0, s.scrollTop - back); });
    }
  };
  if (tabs.length === 0) return null;
  return (
    <div
      ref={bar}
      role="tablist"
      aria-label="Profile sections"
      data-testid="pp-tabs"
      className={`sticky z-20 flex gap-5 overflow-x-auto border-b border-border bg-background lg:hidden ${stickyClassName}`}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            data-pp-tab={t.key}
            onClick={() => select(t.key)}
            className={`flex h-11 shrink-0 items-center gap-1 whitespace-nowrap text-ds-15 ${on ? "font-semibold text-foreground shadow-[inset_0_-2px_0_hsl(var(--foreground))]" : "text-muted-foreground"}`}
          >
            {t.label}
            {t.count != null && <span className="tabular-nums text-muted-foreground">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
