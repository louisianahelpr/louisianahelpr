/**
 * #31 (deep audit 11-22): once the job day had passed, the Helpr's tracker said "Confirm the job below to unlock
 * the next step" while JobConfirmation, below it, had already hidden its button. The line pointed at nothing.
 *
 * The class: the tracker's "Confirm the job below" line shows exactly when JobConfirmation shows the Helpr's
 * confirm button, at every moment of the window (before it opens, on the day, after the day). Both read ONE rule,
 * helprConfirmClosed in src/lib/jobDate.ts, and so does HelperTrackerPanel's gate.
 *
 * @mutate src/components/JobTrackingView.tsx |           if (jobDateNeeded && helprConfirmClosed(jobDateNeeded, Date.now())) { |           if (false) {
 * @mutate src/components/JobConfirmation.tsx | : !helprConfirmClosed(dateNeeded, now.getTime())); | : hoursUntilJob > -48);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/TrackingMap", () => ({ TrackingMap: () => <div data-testid="tracking-map" /> }));
vi.mock("@/hooks/usePermissionRationale", () => ({ usePermissionRationale: () => ({ request: async () => true }) }));
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
});

import { JobTracking } from "@/components/JobTracking";
import { JobConfirmation } from "@/components/JobConfirmation";

const DAY = "2032-10-14";
const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };
afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderBoth() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobTracking
          jobId="job-1" helperId="helper-1" isHelper isOwner={false}
          jobDateNeeded={DAY} jobStartTime={null} jobStatus="in_progress"
          helperConfirmedAt="2032-10-01T12:00:00Z" helperDayofConfirmedAt={null}
          posterConfirmedAt="2032-10-13T15:00:00Z" posterName="Erin Doe"
        />
        <JobConfirmation
          variant="inline" jobId="job-1" isOwner={false} isHelper
          posterConfirmedAt="2032-10-13T15:00:00Z" helperConfirmedAt="2032-10-01T12:00:00Z"
          helperDayofConfirmedAt={null} dateNeeded={DAY} startTime={null} jobStatus="in_progress"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const MOMENTS: Array<[string, string]> = [
  ["the day before, window open", "2032-10-13T15:00:00Z"],
  ["on the job day", "2032-10-14T18:00:00Z"],
  ["late on the job day", "2032-10-15T04:30:00Z"],
  ["the day after", "2032-10-15T15:00:00Z"],
  ["a week after", "2032-10-21T15:00:00Z"],
];

describe("'Confirm the job below' shows only while the confirm button is there", () => {
  for (const [label, iso] of MOMENTS) {
    it(label, () => {
      at(iso);
      renderBoth();
      const line = /Confirm the job below/i.test(document.body.textContent ?? "");
      const button = screen.queryAllByRole("button", { name: /Confirm you'll be at the job/i }).length > 0;
      expect(line, `${label}: the line says "below" ${line ? "with no" : "while a"} confirm button is there`).toBe(button);
    });
  }

  it("after the day, the line says what the Helpr can do, with the poster's name", () => {
    at("2032-10-15T15:00:00Z");
    renderBoth();
    expect(document.body.textContent ?? "").toMatch(/The day passed without a confirm\. Message Erin or cancel the job\./);
  });

  it("every Helpr confirm window reads the one shared rule, never a hand-copied hour count", () => {
    const users = ["src/components/JobTrackingView.tsx", "src/components/JobConfirmation.tsx", "src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx"];
    let n = 0;
    for (const f of users) {
      const code = blankComments(readFileSync(f, "utf8"));
      expect(code, `${f} reads helprConfirmClosed`).toMatch(/helprConfirmClosed\(/);
      expect(code, `${f} hand-copies the Helpr window as hoursUntilJob > -24`).not.toMatch(/hoursUntilJob\s*>\s*-24/);
      n++;
    }
    expect(n).toBeGreaterThan(2);
  });
});
