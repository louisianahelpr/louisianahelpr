/**
 * Declutter "Add a Helpr" panel (docs/specs/declutter-add-a-helpr.md): hidden
 * while the switch is off for the viewer; otherwise three one-tap choices that
 * each open Post a Job for THIS order, the booked (funded) jobs listed with a
 * link, an unpaid one left out, and a refusal shown in plain words. The data
 * module is stubbed; the backend proof is
 * src/test/pglite/declutterAddAHelpr.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |     enabled: on, |     enabled: true,
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |   const booked = info.data.jobs.filter(isBookedSetupJob); |   const booked = info.data.jobs;
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |     return <ErrorState variant="inline" title="We couldn't load the Helpr options." body={declutterErrorMessage(info.error)} onRetry={() => void info.refetch()} />; |     return null;
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |   if (info.isError && (info.error as { message?: string })?.message === "item_not_found") return null; | 
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { on: true, fail: "" as string, jobs: [] as unknown[], fetches: 0 };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/lib/declutter/setupHelpr", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/setupHelpr")>();
  return {
    ...real,
    fetchSetupHelpr: async (orderId: string) => {
      state.fetches++;
      if (state.fail === "closed") throw Object.assign(new Error("item_not_found"), { userMessage: "This item isn't available." });
      if (state.fail === "down") throw Object.assign(new Error("Failed to fetch"), { userMessage: "We couldn't reach Louisiana Helpr. Try again." });
      return { order_id: orderId, status: "paid", handover: "pickup_home", items: ["Oak bookshelf"], pickup_at: null, jobs: state.jobs };
    },
  };
});

import { AddHelprPanel } from "./DeclutterAddHelpr";

let qc: QueryClient;
function show() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><AddHelprPanel orderId="o1" /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Declutter Add a Helpr panel", () => {
  beforeEach(() => {
    state.on = true;
    state.fail = "";
    state.jobs = [];
    state.fetches = 0;
  });

  it("shows nothing and asks the server nothing while the switch is off for the viewer", async () => {
    state.on = false;
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    expect(state.fetches).toBe(0);
  });

  it("offers three one-tap choices, each opening Post a Job for this order", async () => {
    show();
    expect(await screen.findByText("Need a hand with it?")).toBeTruthy();
    const hrefs = ["Put it together", "Hang it on the wall", "Set it up"].map((t) => screen.getByRole("link", { name: t }).getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(2);
    expect(hrefs).toEqual([
      "/post-job?declutterOrder=o1&help=assemble",
      "/post-job?declutterOrder=o1&help=mount",
      "/post-job?declutterOrder=o1&help=setup",
    ]);
  });

  it("lists a paid Helpr job with a link, and leaves an unpaid one out", async () => {
    state.jobs = [
      { job_id: "j1", title: "Put together Oak bookshelf", category: "assembly", status: "open", payment_status: "escrow" },
      { job_id: "j2", title: "Abandoned post", category: "assembly", status: "open", payment_status: "unpaid" },
    ];
    show();
    const link = await screen.findByRole("link", { name: "Put together Oak bookshelf" });
    expect(link.getAttribute("href")).toBe("/jobs/j1");
    expect(screen.queryByText("Abandoned post")).toBeNull();
  });

  it("a closed offer (refunded, or 30 days after the handover) shows nothing", async () => {
    state.fail = "closed";
    const { container } = show();
    await waitFor(() => expect(qc.getQueryState(["declutter", "setup-helpr", "o1"])?.status).toBe("error"));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("any other failure shows its plain words with a retry", async () => {
    state.fail = "down";
    show();
    expect(await screen.findByText("We couldn't load the Helpr options.")).toBeTruthy();
    expect(screen.getByText("We couldn't reach Louisiana Helpr. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});
