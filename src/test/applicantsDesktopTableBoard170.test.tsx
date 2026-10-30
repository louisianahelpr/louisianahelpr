/**
 * Board 170 (desktop applicants): from 1280px the poster's Applicants list is a
 * table (Compare, Helpr, Price, Their note, then Message and Hire) with a sticky
 * compare card beside it from 1400px; below 1280px the phone cards stay. Owner
 * (2026-10-22): the job name + date line goes back under "Applicants".
 *
 * What must hold, each shown red by a mutation below:
 *  - one layout at a time (the table OR the cards, never both: duplicate Hire buttons);
 *  - the table hires, declines, reports and blocks through the panel's own handlers (Q366: on every row);
 *  - a note the contact scanner hid is never on screen in the table either;
 *  - no "When" column (an application has no time) and Price says "At your price" (no bids);
 *  - the compare card says nothing until 2 are picked, then real facts and a Hire per pick;
 *    the category row only when the category counts are known; never the Helpr's take-home;
 *  - the job line under the title is the job's name and date.
 *
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | {!wide && sortedApplications.slice(0, shown).map( | {sortedApplications.slice(0, shown).map(
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |                 {wide && (\n                  <ApplicantsDesktopTable |                 {false && (\n                  <ApplicantsDesktopTable
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | {[selectedJob.title, selectedJob.date_needed ? formatJobDate(selectedJob.date_needed) : null] | {[selectedJob.title]
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx | {app.flagged_hidden ? ( | {false ? (
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx | onClick={() => { hapticLight(); onBlock(app); }} | onClick={() => { hapticLight(); }}
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx | onClick={() => { hapticLight(); onReport(app); }} | onClick={() => { hapticLight(); }}
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx | onAcceptApplication={() => onAcceptApplication(app)} | onAcceptApplication={() => {}}
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx | {app.status === "pending" && <CompareCheck | {false && <CompareCheck
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsCompareCard.tsx |       {picked.length < 2 ? ( |       {picked.length < 1 ? (
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsCompareCard.tsx | if (picked.length > 0 && picked.every((a) => categoryCount(a) !== undefined)) { | if (picked.length > 0) {
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsCompareCard.tsx |                   onHire(a); |                   onHire(picked[0]);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/pages/posts/postedJobs/useApplicantCategoryCounts", () => ({ useApplicantCategoryCounts: () => null }));
vi.mock("@/hooks/usePaidTierBadge", () => ({ usePaidTierBadge: () => () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    },
  };
});

import { ApplicantsPanel } from "@/pages/posts/postedJobs/ApplicantsPanel";
import { ApplicantsDesktopTable, APPLICANTS_TABLE_QUERY } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable";
import { ApplicantsCompareCard } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantsCompareCard";
import type { EnrichedApplication, Job } from "@/components/job-card/activityConstants";
import { formatJobDate } from "@/lib/dateUtils";
import { jobLocalDateISO } from "./helpers/jobLocalDate";


/** The applicant trust line (Q2478) reads through React Query; every render gets a fresh client (rpc stubbed above). */
function QueryWrap({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DAY = jobLocalDateISO(9);

const JOB = { id: "job-1", title: "Pressure wash driveway", category: "pressure_washing", date_needed: DAY, status: "open", created_at: new Date().toISOString() } as unknown as Job;
const app = (id: string, name: string, over: Record<string, unknown> = {}): EnrichedApplication =>
  ({
    id,
    job_id: JOB.id,
    helper_id: `h-${id}`,
    status: "pending",
    message: `note ${id}`,
    flagged_hidden: false,
    reviewCount: 4,
    avgRating: 4.75,
    created_at: new Date().toISOString(),
    profiles: { full_name: name, skills: null, user_id: `h-${id}`, is_id_verified: true, is_payout_ready: true },
    ...over,
  }) as unknown as EnrichedApplication;

function setWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide && query === APPLICANTS_TABLE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  })) as unknown as typeof window.matchMedia;
}
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function renderPanel(applications: EnrichedApplication[]) {
  const empty = new Map();
  render(
    <MemoryRouter initialEntries={["/posts"]}>
      <ApplicantsPanel
        selectedJob={JOB}
        setSelectedJob={() => {}}
        applications={applications}
        applicationsLoading={false}
        applicationsError={false}
        onLoadApplications={() => {}}
        onAcceptApplication={() => {}}
        onDeclineApplication={() => {}}
        neighborCountMap={empty}
        completedCountsMap={empty}
        repeatHireMap={empty}
        onTimeMap={empty}
        distanceBandMap={empty}
      />
    </MemoryRouter>,
    { wrapper: QueryWrap },
  );
  return screen.getByRole("region", { name: /Applicants for Pressure wash driveway/ });
}

const notes = { applicantNotes: {}, noteEditing: null, setNoteEditing: () => {}, noteDraft: "", setNoteDraft: () => {}, saveNote: () => {} };

function renderTable(apps: EnrichedApplication[], handlers: Partial<Record<"onHire" | "onDecline" | "onReport" | "onBlock", (a: EnrichedApplication) => void>> = {}) {
  const compare = { ids: [] as string[], toggle: vi.fn(), clear: vi.fn() };
  render(
    <MemoryRouter>
      <ApplicantsDesktopTable
        rows={apps.map((a) => ({ app: a, distanceBand: null, promotedByTier: false }))}
        applications={apps}
        topHelperId={null}
        jobId={JOB.id}
        category="pressure_washing"
        completedCountsMap={new Map([["h-a", 31]])}
        categoryCounts={null}
        compare={compare}
        notes={notes}
        onAcceptApplication={handlers.onHire ?? vi.fn()}
        onDecline={handlers.onDecline ?? vi.fn()}
        onReport={handlers.onReport ?? vi.fn()}
        onBlock={handlers.onBlock ?? vi.fn()}
      />
    </MemoryRouter>,
    { wrapper: QueryWrap },
  );
  return compare;
}

describe("board 170: the Applicants panel picks one layout by width", () => {
  it("from 1280px: the table, and no phone cards (one Hire per applicant)", () => {
    setWide(true);
    const region = renderPanel([app("a", "Andre Lafleur"), app("b", "Deon Wells")]);
    expect(within(region).getByRole("table")).toBeInTheDocument();
    expect(within(region).getAllByRole("button", { name: /^Select / })).toHaveLength(2);
  });

  it("below 1280px: the phone cards, and no table", () => {
    setWide(false);
    const region = renderPanel([app("a", "Andre Lafleur"), app("b", "Deon Wells")]);
    expect(within(region).queryByRole("table")).toBeNull();
    expect(within(region).getAllByRole("button", { name: /^Select / })).toHaveLength(2);
  });

  it("owner: the job name and date sit under the Applicants title", () => {
    setWide(false);
    const region = renderPanel([app("a", "Andre Lafleur")]);
    const line = region.querySelector("[data-applicants-job-line]");
    expect(line?.textContent).toBe(`Pressure wash driveway · ${formatJobDate(DAY)}`);
    expect(formatJobDate(DAY)).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe("board 170: the desktop table", () => {
  it("has Compare, Helpr, Price and Their note columns, no When column, and Price says At your price", () => {
    renderTable([app("a", "Andre Lafleur"), app("b", "Deon Wells")]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(0, 4)).toEqual(["Compare", "Helpr", "Price", "Their note"]);
    expect(headers.join(" ")).not.toMatch(/when/i);
    expect(screen.getAllByText("At your price")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Compare Andre L." })).toBeInTheDocument();
    expect(screen.getByText(/31 jobs/)).toBeInTheDocument();
  });

  it("never shows a note the contact scanner hid", () => {
    renderTable([app("a", "Andre Lafleur", { message: "text me at 555-0100", flagged_hidden: true })]);
    expect(screen.queryByText(/555-0100/)).toBeNull();
    expect(screen.getByText(/This note was hidden/)).toBeInTheDocument();
  });

  it("hires, declines, reports and blocks through the panel's handlers, on every row", () => {
    const onHire = vi.fn();
    const onDecline = vi.fn();
    const onReport = vi.fn();
    const onBlock = vi.fn();
    const apps = [app("a", "Andre Lafleur"), app("b", "Deon Wells")];
    renderTable(apps, { onHire, onDecline, onReport, onBlock });
    fireEvent.click(screen.getByRole("button", { name: "Select Deon W." }));
    expect(onHire).toHaveBeenCalledWith(apps[1]);
    fireEvent.click(screen.getByRole("button", { name: "Decline Andre L." }));
    expect(onDecline).toHaveBeenCalledWith(apps[0]);
    fireEvent.click(screen.getByRole("button", { name: "Report Deon W.'s application" }));
    expect(onReport).toHaveBeenCalledWith(apps[1]);
    fireEvent.click(screen.getByRole("button", { name: "Block Andre L." }));
    expect(onBlock).toHaveBeenCalledWith(apps[0]);
  });
});

describe("board 170: the compare card", () => {
  const base = { completedCount: () => 3, category: "pressure_washing", distanceOf: () => null, clear: vi.fn() };

  it("says how to compare until 2 are picked", () => {
    render(<ApplicantsCompareCard {...base} picked={[app("a", "Andre Lafleur")]} categoryCount={() => undefined} onHire={vi.fn()} />);
    expect(screen.queryByText(/Comparing/)).toBeNull();
    expect(screen.getByText(/Tick Compare on 2 or 3 Helprs/)).toBeInTheDocument();
  });

  it("with 2 picked: real facts, the category row only when known, a Hire per pick, never take-home", () => {
    const apps = [app("a", "Andre Lafleur"), app("b", "Deon Wells", { reviewCount: 0 })];
    const onHire = vi.fn();
    const { rerender } = render(<ApplicantsCompareCard {...base} picked={apps} categoryCount={() => undefined} onHire={onHire} />);
    expect(screen.getByText("Comparing 2")).toBeInTheDocument();
    expect(screen.getByText("Andre 4.8 from 4 · Deon no reviews yet")).toBeInTheDocument();
    expect(screen.queryByText("Pressure washing jobs")).toBeNull();
    rerender(<ApplicantsCompareCard {...base} picked={apps} categoryCount={(a) => (a.id === "a" ? 12 : 3)} onHire={onHire} />);
    expect(screen.getByText("Pressure washing jobs")).toBeInTheDocument();
    expect(screen.getByText("Andre 12 · Deon 3")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/take.?home|receives/i);
    fireEvent.click(screen.getByRole("button", { name: "Hire Deon" }));
    expect(onHire).toHaveBeenCalledWith(apps[1]);
  });
});
