/**
 * THE MANAGE JOB SCREEN IS GONE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT): its actions are on the job page, and an old
 * `/posts?highlight=<id>&manage=1` link (a chat card, an email, a notification already on a phone) opens /jobs/<id>.
 * Every one now: the job page runs the card's approve, cancel, edit and steps itself (usePosterPageFlows), so the
 * app makes no &manage=1 link at all. JobsSection redirects before the Posted list mounts: a redirect from inside the list raced
 * the list's own deep-link URL write (filter=scheduled), which put the list back (headless Chromium, 2026-10-31).
 *
 * @mutate src/components/job-card/useManageDeepLink.ts |   return id ? `/jobs/${encodeURIComponent(id)}` : null; |   return id && id.length > 5 ? `/jobs/${encodeURIComponent(id)}` : null;
 * @mutate src/components/job-card/useManageDeepLink.ts |   const id = params.get("manage") === "1" ? params.get("highlight") : null; |   const id = params.get("highlight");
 * @mutate src/pages/jobs/JobsSection.tsx |   if (jobPage) return <Navigate replace to={jobPage} />; |   void jobPage;
 * @mutate src/components/messages/chatView/DealCard.tsx |         ? `/jobs/${job.id}` |         ? `/jobs?tab=posted&highlight=${job.id}&manage=1`
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { manageLinkOpensJobPage } from "@/components/job-card/useManageDeepLink";
import { blankComments } from "@/test/helpers/blankNonCode";

// The Posted list and Browse stand in as markers: what matters is whether JobsSection mounts the list at all.
vi.mock("@/components/job-card/JobListPage", () => ({ default: () => <p data-testid="posted-list">list</p> }));
vi.mock("@/pages/home/Dashboard", () => ({ default: () => <p>browse</p> }));
vi.mock("@/components/refund/RefundsSwitch", () => ({ RefundsSwitchProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));

import JobsSection from "@/pages/jobs/JobsSection";

const ROOT = path.resolve(__dirname, "../..");
const link = (id: string) => new URLSearchParams(`highlight=${id}&manage=1&tab=posted`);

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function open(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<JobsSection />} />
        <Route path="/jobs/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("an old Manage job link opens the job page (LEAD-JOBPAGE-LAYOUT)", () => {
  it("a plain &manage=1 link names /jobs/<id>; a link without manage=1 names nothing", () => {
    expect(manageLinkOpensJobPage(link("job-1"))).toBe("/jobs/job-1");
    expect(manageLinkOpensJobPage(new URLSearchParams("highlight=job-1&tab=posted"))).toBeNull();
  });

  it("Jobs > Posted redirects before the list mounts, so nothing in the list can write the URL back", () => {
    open("/jobs?tab=posted&highlight=job-2&manage=1");
    expect(screen.getByTestId("where").textContent).toBe("/jobs/job-2");
    expect(screen.queryByTestId("posted-list")).toBeNull();
  });

  it("a Posted link without manage=1 still mounts the list", () => {
    open("/jobs?tab=posted&highlight=job-3");
    expect(screen.getByTestId("posted-list")).toBeTruthy();
  });

  it("nothing in the app makes a &manage=1 link any more (the job page's card trip is gone too)", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\./.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const makers = files.filter((f) => /manage=1/.test(blankComments(readFileSync(path.join(ROOT, f), "utf8"))));
    expect(makers).toEqual([]);
  });
});
