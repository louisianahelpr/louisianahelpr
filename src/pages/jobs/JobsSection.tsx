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
import { useCallback, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import Dashboard from "@/pages/home/Dashboard";
import JobListPage from "@/components/job-card/JobListPage";
import { AppTopBar } from "@/components/sections/AppTopBar";
import { ExploreSwitcher } from "@/components/sections/ExploreSwitcher";
import { ExploreSearchEntry } from "@/components/sections/ExploreSearchEntry";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { sectionByKey } from "@/components/sections/sectionsConfig";

export const JOBS_TABS = [
  { value: "posted", label: "Posted" },
  { value: "working", label: "Working" },
] as const;

/** Params only the old My Jobs page read: their presence (with no ?tab=) means Working. */
export const MY_JOBS_LINK_PARAMS = ["job", "filter", "highlight", "q"] as const;

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
  const header = (
    <div className="flex flex-col gap-1">
      <AppTopBar title={section.label} add={section.add} explore settings={{ label: "Jobs settings", path: "/jobs/settings" }} />
      <ExploreSearchEntry />
      <ExploreSwitcher current="jobs" />
      <SectionTabs label="Jobs & Posts" tabs={JOBS_TABS} value={tab} onChange={onTab} />
    </div>
  );

  if (tab === "posted") return <JobListPage key="posted" defaultTab="posted" embeddedHeader={header} />;
  if (tab === "working") return <JobListPage key="working" defaultTab="applied" embeddedHeader={header} />;
  return <Dashboard embeddedHeader={header} />;
};

export default JobsSection;
