// QuickApplyHandler — the deep-link resolver behind BOTH `/dashboard?quickApply=<id>`
// and `/jobs/<id>` (every signed-in visitor to that route is redirected here).
//
// What these tests prevent: telling a PARTICIPANT that a job they are working
// on — or have already finished — "isn't available to open yet". That is the
// Early Access copy, and it was the only thing a helper got when they opened
// the job-start reminder for a completed job, because the handler's only
// single-row lookup was `open_jobs_browse`, which by construction shows OPEN,
// funded, early-access-released jobs and nothing else. Prod carries 34
// `/jobs/<id>` notification rows and all of them are addressed to a party.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QuickApplyHandler } from "./QuickApplyHandler";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const toastMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastMock(...args), {
    error: (...args: unknown[]) => toastErrorMock(...args),
  }),
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

// One canned response per table, so a test says only what each lookup returns
// and the handler's ORDER of lookups is what's under test.
const responses = new Map<string, { data: unknown; error: unknown }>();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            responses.get(table) ?? { data: null, error: null },
        }),
      }),
    }),
  },
}));

const USER = { id: "helper-1" } as unknown as Parameters<typeof QuickApplyHandler>[0]["user"];
const JOB_ID = "job-abc";

function renderHandler() {
  return render(
    <MemoryRouter>
      <QuickApplyHandler
        searchParams={new URLSearchParams(`quickApply=${JOB_ID}`)}
        user={USER}
        allJobs={[]}
        onApply={vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  responses.clear();
  navigateMock.mockClear();
  toastMock.mockClear();
  toastErrorMock.mockClear();
});

describe("QuickApplyHandler — a job the browse view cannot show", () => {
  it("sends the ASSIGNED HELPER to their own job instead of the Early Access error", async () => {
    // The reported case: a completed job. `open_jobs_browse` misses it (not
    // open), but RLS on `jobs` hands the row to the helper who worked it.
    responses.set("open_jobs_browse", { data: null, error: null });
    responses.set("jobs", {
      data: { id: JOB_ID, customer_id: "poster-9", helper_id: "helper-1" },
      error: null,
    });

    renderHandler();

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        `/my-jobs?job=${JOB_ID}`,
        { replace: true },
      ),
    );
    // The failure this file exists for: any error toast at all on this path.
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("sends the POSTER to their own post", async () => {
    responses.set("open_jobs_browse", { data: null, error: null });
    responses.set("jobs", {
      data: { id: JOB_ID, customer_id: "helper-1", helper_id: "someone-else" },
      error: null,
    });

    renderHandler();

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        `/my-posts?highlight=${JOB_ID}`,
        { replace: true },
      ),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("still explains itself to a stranger — and does not promise that waiting will work", async () => {
    // Neither lookup returns a row: the viewer is party to nothing. This is
    // the only case the message is for, and it must not assert a single cause.
    responses.set("open_jobs_browse", { data: null, error: null });
    responses.set("jobs", { data: null, error: null });

    renderHandler();

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const message = String(toastErrorMock.mock.calls[0][0]);
    expect(message).toMatch(/filled or taken down/i);
    expect(message).toMatch(/few minutes/i);
    // "isn't available to open YET" was the exact wording that read as a
    // promise; a job that was filled will never become available.
    expect(message).not.toMatch(/available to open yet/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("reports a failed participant lookup as a load failure, not as 'no such job'", async () => {
    // A dropped error here would misreport a network/permission failure as a
    // missing job — the read-side twin of the zero-row write trap.
    responses.set("open_jobs_browse", { data: null, error: null });
    responses.set("jobs", { data: null, error: { message: "network down" } });

    renderHandler();

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(String(toastErrorMock.mock.calls[0][0])).toMatch(/Check your connection/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
