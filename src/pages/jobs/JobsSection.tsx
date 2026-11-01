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
import { useCallback, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import Dashboard from "@/pages/home/Dashboard";
import JobListPage from "@/components/job-card/JobListPage";
import { manageLinkOpensJobPage } from "@/components/job-card/useManageDeepLink";
import { RefundsSwitchProvider } from "@/components/refund/RefundsSwitch";
import { AppTopBar, SectionSettingsButton } from "@/components/sections/AppTopBar";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { useLanguage } from "@/lib/i18n/language";
import { navKey } from "@/lib/i18n/navLabels";

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
  const { t: tr } = useLanguage();

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
  const makeHeader = (browse?: { end?: ReactNode; count?: number; onlySelected?: boolean }) => (
    <div data-explore-header="" className="explore-header flex flex-col gap-1">
      <AppTopBar title={tr(navKey(section.path, section.label) ?? "nav.jobs")} explore section="jobs" desktopGap={false} />
      <SectionTabs label={tr("jobs.tabsLabel")} tabs={JOBS_TABS} value={tab} onChange={onTab} browseCount={browse?.count} onlySelected={browse?.onlySelected} end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>} />
      {/* ONE search per screen (owner 2026-10-21), and never an expanded field (owner 2026-10-25: "i prefer
          the search not expanded"): every tab's search is an ICON at the end of the tabs row, before the gear
          (Browse: owner 2026-10-28; Posted / Working: owner 2026-10-31, "move it up into the tab row next to the
          gear"), and it opens IN PLACE, leftward (owner 2026-10-27; InlineListSearch). Posted / Working hand it in
          through makeHeader (EmbeddedActivityHeader). Guards: src/test/jobsSearchIsAnIcon.test.tsx,
          src/test/jobsToolbarRowIsOneRow.test.tsx. */}
    </div>
  );

  // An old Manage job link opens the job page, before the list mounts (manageLinkOpensJobPage).
  const jobPage = tab === "posted" ? manageLinkOpensJobPage(params) : null;
  if (jobPage) return <Navigate replace to={jobPage} />;
  // Board 141: the refund_requests switch, read once for every job card in the list.
  if (tab === "posted") return <RefundsSwitchProvider><JobListPage key="posted" defaultTab="posted" embeddedHeader={makeHeader} /></RefundsSwitchProvider>;
  if (tab === "working") return <RefundsSwitchProvider><JobListPage key="working" defaultTab="applied" embeddedHeader={makeHeader} /></RefundsSwitchProvider>;
  return <Dashboard embeddedHeader={makeHeader} />;
};

// JA-17 (B111): the job page's Accept / Decline panel is loaded FROM this chunk, which already holds the Working card's
// handlers and offer card. Its own lazy chunk split useActivityActions into a new shared chunk that every route's
// preload list in the entry named (entry 5366 -> 5396 B gz, over the 5 KB +5% budget; measured 2026-11-01).
export { PageOfferPanel } from "./jobPage/PageOfferPanel";

export default JobsSection;
