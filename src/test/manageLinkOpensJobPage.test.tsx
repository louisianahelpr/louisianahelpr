/**
 * THE MANAGE JOB SCREEN IS GONE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT): its actions are on the job page, and an old
 * `/posts?highlight=<id>&manage=1` link (a chat card, an email, a notification already on a phone) opens /jobs/<id>.
 * Only the job page's own trip for a card-held step (approve, cancel, edit, more options: faceActionRequest) still
 * opens the Posted card.
 *
 * @mutate src/components/job-card/useManageDeepLink.ts |     if (target) navigate(`/jobs/${encodeURIComponent(target)}`, { replace: true }); |     void target;
 * @mutate src/components/job-card/useManageDeepLink.ts | (idFromUrl && !hasFaceAction(idFromUrl) ? idFromUrl : null) | (idFromUrl ? idFromUrl : null)
 * @mutate src/components/job-card/JobListPage.tsx |   useManageDeepLink(manageJobId, postedJobs, actions, { jobPageFirst: true }); |   useManageDeepLink(manageJobId, postedJobs, actions);
 * @mutate src/components/job-card/useManageDeepLink.ts |   useManageLinkOpensJobPage(opts.jobPageFirst ? idFromUrl : null); |   useManageLinkOpensJobPage(null);
 * @mutate src/components/messages/chatView/DealCard.tsx |         ? `/jobs/${job.id}` |         ? `/jobs?tab=posted&highlight=${job.id}&manage=1`
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { useManageDeepLink, useManageLinkOpensJobPage } from "@/components/job-card/useManageDeepLink";
import { requestFaceAction } from "@/components/job-card/faceActionRequest";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");

function run(id: string | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/posts?highlight=${id}&manage=1`]}>{children}</MemoryRouter>
  );
  return renderHook(() => {
    useManageLinkOpensJobPage(id);
    return useLocation();
  }, { wrapper });
}

describe("an old Manage job link opens the job page (LEAD-JOBPAGE-LAYOUT)", () => {
  it("a plain &manage=1 link lands on /jobs/<id>", () => {
    const { result } = run("job-1");
    expect(result.current.pathname).toBe("/jobs/job-1");
  });

  it("the job page's own trip for a card-held step (approve, cancel, edit, more) still opens the card", () => {
    for (const action of ["approve", "cancel", "edit", "open"] as const) {
      requestFaceAction(`job-${action}`, action);
      const { result } = run(`job-${action}`);
      expect(result.current.pathname, action).toBe("/posts");
    }
  });

  it("Posted's manage link hook carries it; Working's open link (no jobPageFirst) never leaves the list", () => {
    const cards = { expandedJobIds: new Set<string>(), toggleExpandedJobId: () => {} };
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={["/posts?highlight=job-9&manage=1"]}>{children}</MemoryRouter>;
    const posted = renderHook(() => { useManageDeepLink("job-9", [], cards, { jobPageFirst: true }); return useLocation(); }, { wrapper });
    expect(posted.result.current.pathname).toBe("/jobs/job-9");
    const working = renderHook(() => { useManageDeepLink("job-9", [], cards); return useLocation(); }, { wrapper });
    expect(working.result.current.pathname).toBe("/posts");
  });

  it("no id, no move", () => {
    const { result } = run(null);
    expect(result.current.pathname).toBe("/posts");
  });

  it("Posted runs it on its manage link, and the only &manage=1 left in the app is the job page's card trip", () => {
    const listPage = blankComments(readFileSync(path.join(ROOT, "src/components/job-card/JobListPage.tsx"), "utf8"));
    expect(listPage).toMatch(/useManageDeepLink\(manageJobId, postedJobs, actions, \{ jobPageFirst: true \}\);/);
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\./.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const makers = files.filter((f) => /manage=1/.test(blankComments(readFileSync(path.join(ROOT, f), "utf8"))));
    expect(makers).toEqual(["src/pages/jobs/jobPage/posterPageActions.tsx"]);
  });
});
