/**
 * UX-4 (owner approved 2026-10-29, Q2484): a Helpr whose "jobs I'm doing" list is empty is pointed to their own
 * Book me link and to "Notify me when one lands", not only to Browse. Renders the REAL AppliedJobsTab with no
 * applications and presses both.
 *
 * @mutate src/pages/jobs/AppliedJobsTab.tsx | <EmptyJobsWaysOut userId={userId} /> | null
 * @mutate src/pages/jobs/EmptyJobsWaysOut.tsx | shareBookMe(userId, firstNameOf(profile?.full_name)) | Promise.resolve()
 * @mutate src/pages/jobs/EmptyJobsWaysOut.tsx | onClick={() => void notify()} | onClick={() => undefined}
 * @mutate src/pages/jobs/EmptyJobsWaysOut.tsx |           variant="outline" |           variant="link"
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { shareBookMe, notify } = vi.hoisted(() => ({
  shareBookMe: vi.fn((_id: string, _first: string) => Promise.resolve("shared")),
  notify: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/bookMe", async (io) => ({ ...(await io<typeof import("@/lib/bookMe")>()), shareBookMe }));
vi.mock("@/hooks/useNotifyWhenWorkLands", () => ({ useNotifyWhenWorkLands: () => notify }));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: { full_name: "Ann Boudreaux" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    },
  };
});

import { AppliedJobsTab } from "@/pages/jobs/AppliedJobsTab";

type Props = Parameters<typeof AppliedJobsTab>[0];
const noop = () => {};
function renderEmpty() {
  const props = {
    apps: [], expandedJobIds: new Set<string>(), toggleExpandedJobId: noop, helperReviewedJobIds: new Set<string>(),
    latestTracking: {}, userId: "helpr-1", onHelperResponse: noop, respondingHelperAppId: null, onComplete: noop,
    completingJobId: null, onResolveRevision: noop, onHelperReview: noop, onDispute: noop, onViewDispute: noop, onRefresh: noop,
  } as unknown as Props;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/jobs"]}>
        <AppliedJobsTab {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UX-4: the empty jobs list points to your Book me link and to job alerts", () => {
  beforeEach(() => { shareBookMe.mockClear(); notify.mockClear(); });

  it("shows both beside Browse, as the shared pill Button", () => {
    renderEmpty();
    expect(screen.getByRole("button", { name: /Browse open Jobs/ })).toBeTruthy();
    const share = screen.getByRole("button", { name: "Share your Book me link" });
    const alerts = screen.getByRole("button", { name: "Notify me when one lands" });
    for (const b of [share, alerts]) expect(b.className.split(/\s+/), b.textContent ?? "").toContain("rounded-full");
    // The share button reads as a button (an outline pill), not a bare link.
    expect(share.className).toMatch(/\bborder\b/);
  });

  it("Share opens the Book me share sheet for YOUR id with your first name", () => {
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Share your Book me link" }));
    expect(shareBookMe).toHaveBeenCalledTimes(1);
    expect(shareBookMe).toHaveBeenCalledWith("helpr-1", "Ann");
  });

  it("Notify me runs the one shared job-alert handler", () => {
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Notify me when one lands" }));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
