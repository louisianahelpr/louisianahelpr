// Jobs & Posts (/jobs; /posts redirects here with ?tab=posted). Owner final
// decisions, 2026-10-19: the section OPENS ON BROWSE; a segmented toggle with
// Browse always leftmost — Browse | Posted | Working (one word each).
//   Browse  = the existing job feed (pages/home/Dashboard), embedded.
//   Posted  = the existing My Posts list (JobListPage "posted"), embedded.
//   Working = the existing My Jobs list (JobListPage "applied"), embedded.
// Nothing here redraws a card or a list; it places the existing screens
// under the section's top bar and tabs.
//
// OLD DEEP LINKS. Before this page, /jobs WAS "My Jobs", and every
// notification, email and push link still says /jobs?job=<id>,
// /jobs?filter=<bucket>, /jobs?highlight=<applicationId> or /jobs?q=. With no
// ?tab=, any of those params means the link was written for My Jobs, so it
// lands on Working; a plain /jobs opens on Browse. /posts?... arrives here as
// /jobs?tab=posted&... (App.tsx redirect), so it lands on Posted.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import Dashboard from "@/pages/home/Dashboard";
import { JobsListLoadingFrame } from "@/components/JobsSectionSkeleton";
import { removeShellOncePainted } from "@/components/landing/landingShell";
import { JOBS_SHELL_ID } from "@/components/landing/homeShell";
import { manageLinkOpensJobPage } from "@/components/job-card/manageLinkOpensJobPage";
import { AppTopBar, SectionSettingsButton } from "@/components/sections/AppTopBar";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { SectionListBack } from "@/components/sections/SectionListBack";
import type { SectionMineMenu } from "@/components/sections/sectionMine";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useNeedsYouCounts } from "@/lib/needsYouStore";
import { useLanguage } from "@/lib/i18n/language";
import { navKey } from "@/lib/i18n/navLabels";
import { loadModule, untilReload } from "@/lib/loadModule";
import { JOB_LISTS_PREFETCH_KEY, prefetchRoutesWhenIdle } from "@/lib/routePrefetch";

// Q1158/Q654 (B52, 11-03): the Posted and Working lists are their own chunk. Static, they put JobListPage and the
// offer, activity and payment handlers only it runs on Browse's boot (the section opens on Browse). A cold link that
// opens on a list starts this chunk from the entry beside the section's (src/boot/jobsListRoute.ts); Browse warms it
// once the page has settled, so the first tap on Posted or Working finds it in hand. Same specifier everywhere, so all
// share one module instance. Through loadModule (dynamicImportThenDoesNoWork): a prevented preload resolves null.
// Q2705/Q1158 (Builder 3, 11-09): the refund_requests switch's provider (board 141) wraps only the lists, so it loads
// with them. Static here, RefundsSwitch's chunk (job-lifecycle) put WhatNextSheet, the Sheet and their Radix dialog on
// Browse's first screen too. Guard: src/test/jobsFirstScreenStaysLight.test.ts.
const JobListPage = lazy(() =>
  Promise.all([
    loadModule(() => import("@/components/job-card/JobListPage")),
    loadModule(() => import("@/components/refund/RefundsSwitch")),
  ]).then(([m, refunds]) => {
    if (!m || !refunds) return untilReload();
    const List = m.default;
    const { RefundsSwitchProvider } = refunds;
    return { default: (props: Parameters<typeof List>[0]) => <RefundsSwitchProvider><List {...props} /></RefundsSwitchProvider> };
  }),
);

const JOBS_SETTINGS = { label: "Jobs settings", labelKey: "jobs.settings", path: "/jobs/settings" } as const;

export const JOBS_TABS = [
  { value: "posted", label: "Posted", labelKey: "jobs.tabPosted" },
  { value: "working", label: "Working", labelKey: "jobs.tabWorking" },
] as const;

/** Params only the old My Jobs page read (and ?quotes=, QUOTE_HOMES.myQuotes): their presence (with no ?tab=) means Working. */
export const MY_JOBS_LINK_PARAMS = ["job", "filter", "highlight", "q", "quotes"] as const;

/** Every param a tab's list reads; switching tab drops them so one tab's state never leaks into another. */
const LIST_PARAMS = ["tab", "status", ...MY_JOBS_LINK_PARAMS] as const;

export function resolveJobsTab(params: URLSearchParams, picked: string): "browse" | "posted" | "working" {
  if (params.get("tab")) return picked as "browse" | "posted" | "working";
  return MY_JOBS_LINK_PARAMS.some((k) => params.has(k)) ? "working" : "browse";
}

const JobsSection = () => {
  const [params, setParams] = useSearchParams();
  const [picked] = useSectionTab(["posted", "working"]);
  // An OLD My Jobs link is decided from the URL the section OPENED with, once.
  // Browse writes ?q= (its search) and ?job= (its open job) into the same URL
  // as you use it; read live, typing one letter in Browse's search jumped to
  // Working (dashboards build run 4, replaceState-churn spec).
  const [openedOnLegacyLink] = useState(() => resolveJobsTab(params, picked) === "working" && !params.get("tab"));
  const tab = params.get("tab") ? resolveJobsTab(params, picked) : openedOnLegacyLink ? "working" : "browse";
  const section = sectionByKey("jobs");
  // Browse warms the lists' chunk once the page has settled (prefetchRoutesWhenIdle waits for it, skips Save-Data).
  const onBrowse = tab === "browse";
  useEffect(() => (onBrowse ? prefetchRoutesWhenIdle([JOB_LISTS_PREFETCH_KEY]) : undefined), [onBrowse]);
  // Q2705 B: index.html drew this section's skeleton first (#lh-jobs-shell); take it away once this is painted.
  useEffect(() => removeShellOncePainted(JOBS_SHELL_ID), []);
  const { t: tr } = useLanguage();
  const desktop = useIsWebDesktop();
  // My Jobs' to-do counts (and the photo's dot): Home's to-do list, split by side (needsYouStore, the navs' source).
  const todo = useNeedsYouCounts(useAuthReady().user?.id);
  const todoFor = { posted: todo.jobsPosted, working: todo.jobsWorking } as const;

  const onTab = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of LIST_PARAMS) p.delete(k);
          if (next !== "browse") p.set("tab", next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Pin a legacy My Jobs link to Working in the URL itself, so the list's own
  // deep-link handling (which strips ?job= once resolved) can't drop it back
  // onto Browse.
  if (tab === "working" && !params.get("tab")) {
    const p = new URLSearchParams(params);
    p.set("tab", "working");
    return <Navigate replace to={`/jobs?${p.toString()}`} />;
  }

  // THE SECTION SHELL's head (owner, 2026-10-19: "make layout consistent so the shells are in the same
  // place for each"): no inset of its own, the bar 4px over the toggle, exactly SectionScreen's
  // (Declutter, Shops, Homes). Guard: e2e/prod-audit/section-shell-alignment.spec.ts.
  // THE EXPLORE HEADER (owner, 2026-10-22): the section chips with the bell and the photo, the thin tabs (the
  // Jobs settings gear LAST at their right end, on every tab and width: owner 2026-10-28, desktop, "move gear down
  // with the other icons"), then the search. It sits in the scaffold's title card, above the
  // scrolling list, and never changes while the list scrolls (exploreHeaderSteady).
  /** Browse puts its count beside the tab and its search, filters and map at the row's end on desktop. */
  // PHONE (owner 11-08, the Vinted header): the bar is the tab's search ("Search jobs", Filters inside it on Browse)
  // with the bell (which holds Messages) and the photo; no visible title (a hidden h1). Posted, Working and Jobs
  // settings live in "My Jobs" under the photo; on Posted or Working the row under the bar names the list and goes
  // back to Browse. "+ Post a job" is the floating pill. DESKTOP keeps the tabs row with the gear last.
  const mine: SectionMineMenu = {
    title: tr("jobs.myJobs"),
    items: JOBS_TABS.map((t) => ({ key: t.value, label: tr(t.labelKey), to: `/jobs?tab=${t.value}`, count: todoFor[t.value] })),
    settings: { label: tr(JOBS_SETTINGS.labelKey), to: JOBS_SETTINGS.path },
  };
  const listLabel = JOBS_TABS.find((t) => t.value === tab);
  const makeHeader = (browse?: { end?: ReactNode; count?: number; search?: ReactNode; chips?: ReactNode }) => (
    <div data-explore-header="" className="explore-header flex flex-col gap-1">
      {desktop ? (
        <>
          <AppTopBar title={tr(navKey(section.path, section.label) ?? "nav.jobs")} explore section="jobs" desktopGap={false} />
          <SectionTabs label={tr("jobs.tabsLabel")} tabs={JOBS_TABS} value={tab} onChange={onTab} browseCount={browse?.count} end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>} />
        </>
      ) : (
        <>
          <AppTopBar title={tr(navKey(section.path, section.label) ?? "nav.jobs")} explore section="jobs" desktopGap={false}
            search={browse?.search ?? <SectionSearchBar noun="jobs" home="/jobs" />} mine={mine} />
          {listLabel && <SectionListBack label={tr(listLabel.labelKey)} onBack={() => onTab("browse")} />}
          {/* Browse's category chips under the bar (design audit A J1, owner 11-08; JobCategoryChips). */}
          {!listLabel && browse?.chips}
        </>
      )}
      {/* ONE search per screen (owner 2026-10-21). Desktop: every tab's search is an ICON at the end of the tabs row,
          before the gear, opening IN PLACE (InlineListSearch). Phone (owner 11-08): the top bar's field. Guards:
          src/test/jobsSearchIsAnIcon.test.tsx, src/test/jobsToolbarRowIsOneRow.test.tsx. */}
    </div>
  );
  const fab = desktop ? null : <SectionCreateFab section="jobs" text={tr("jobs.postAJob")} />;

  // An old Manage job link opens the job page, before the list mounts (manageLinkOpensJobPage).
  const jobPage = tab === "posted" ? manageLinkOpensJobPage(params) : null;
  if (jobPage) return <Navigate replace to={jobPage} />;
  // Board 141: the refund_requests switch, read once for every job card in the list (JobListPage's lazy wrapper above).
  // While the lists' chunk arrives: the list's own loading frame (EmbeddedActivityLoading draws the same), so the only
  // change a reader sees is still bones -> content.
  if (tab === "posted" || tab === "working") {
    const list = tab === "posted" ? "posted" : "applied";
    return (
      <>
        <Suspense fallback={<JobsListLoadingFrame header={makeHeader()} tab={list} />}>
          <JobListPage key={tab} defaultTab={list} embeddedHeader={makeHeader} />
        </Suspense>
        {fab}
      </>
    );
  }
  return <><Dashboard embeddedHeader={makeHeader} />{fab}</>;
};

export default JobsSection;
