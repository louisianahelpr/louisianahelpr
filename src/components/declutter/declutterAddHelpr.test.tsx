/**
 * Declutter "Add a Helpr" panel (docs/specs/declutter-add-a-helpr.md): hidden
 * while the switch is off for the viewer; otherwise three one-tap choices that
 * each open Post a job for THIS order, the booked (funded) jobs listed with a
 * link, an unpaid one left out, and a refusal shown in plain words. The data
 * module is stubbed; the backend proof is
 * src/test/pglite/declutterAddAHelpr.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |     enabled: on, |     enabled: true,
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |   const booked = info.data.jobs.filter(isBookedSetupJob); |   const booked = info.data.jobs;
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |     return <ErrorState variant="inline" title="We couldn't load the Helpr options." body={declutterErrorMessage(info.error)} onRetry={() => void info.refetch()} />; |     return null;
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |   if (info.isError && (info.error as { message?: string })?.message === "item_not_found") return null; | 
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |             {...gatedProps("post")}\n | \n
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |             onClick={(e) => { if (underAge) { e.preventDefault(); explain("post"); } }} |             onClick={() => {}}
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx |   const kinds = setupKindsFor(info.data.item_details, info.data.handover); |   const kinds = setupKindsFor(info.data.item_details, "pickup_home");
 * @mutate src/components/declutter/DeclutterAddHelpr.tsx | {kinds.includes("move") ? "Need help moving it?" : "Need a hand with it?"} | {"Need a hand with it?"}
 * @mutate src/lib/declutter/setupHelpr.ts |   if (canMove && details.some((d) => d.delivery_size === "large" \|\| d.delivery_size === "xl")) fit.add("move"); |   if (canMove) fit.add("move");
 * @mutate src/lib/declutter/setupHelpr.ts |   const canMove = handover !== "delivery" && handover !== "seller_delivery"; |   const canMove = true;
 * @mutate src/lib/declutter/setupHelpr.ts |   const canMove = handover !== "delivery" && handover !== "seller_delivery"; |   const canMove = handover !== "delivery";
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { on: true, fail: "" as string, jobs: [] as unknown[], details: undefined as unknown, handover: "pickup_home", fetches: 0, underAge: false, explained: [] as string[] };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
// The real hook reads the signed-in birthday; the panel only uses its three outputs.
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: state.underAge,
    explain: (kind: string) => { state.explained.push(kind); },
    gatedProps: (kind: string) => (state.underAge ? { "aria-disabled": true, "data-age-gated": kind } : {}),
  }),
}));
vi.mock("@/lib/declutter/setupHelpr", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/setupHelpr")>();
  return {
    ...real,
    fetchSetupHelpr: async (orderId: string) => {
      state.fetches++;
      if (state.fail === "closed") throw Object.assign(new Error("item_not_found"), { userMessage: "This item isn't available." });
      if (state.fail === "down") throw Object.assign(new Error("Failed to fetch"), { userMessage: "We couldn't reach Louisiana Helpr. Try again." });
      return { order_id: orderId, status: "paid", handover: state.handover, items: ["Oak bookshelf"], item_details: state.details, pickup_at: null, jobs: state.jobs };
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

/** The panel on an order page, with Post a job as a route the tap can reach. */
function showRouted() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/declutter"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/declutter" element={<AddHelprPanel orderId="o1" />} />
          <Route path="/post-job" element={<p>Post a job page</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Declutter Add a Helpr panel", () => {
  beforeEach(() => {
    state.details = undefined;
    state.handover = "pickup_home";
    state.on = true;
    state.fail = "";
    state.jobs = [];
    state.fetches = 0;
    state.underAge = false;
    state.explained = [];
  });

  it("under 18: the choices are greyed out, a tap says why and does not open Post a job (Q1586(c))", async () => {
    state.underAge = true;
    showRouted();
    expect(await screen.findByText("Need help moving it?")).toBeTruthy();
    const links = ["Put it together", "Hang it on the wall", "Set it up"].map((t) => screen.getByRole("link", { name: t }));
    expect(links.length).toBeGreaterThan(2);
    for (const l of links) {
      expect(l.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(l);
    }
    expect(state.explained).toEqual(["post", "post", "post"]);
    expect(screen.queryByText("Post a job page")).toBeNull();
    expect(screen.getByText("Need help moving it?")).toBeTruthy();
  });

  it("18 or older: the choices are live and a tap opens Post a job", async () => {
    showRouted();
    const l = await screen.findByRole("link", { name: "Put it together" });
    expect(l.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(l);
    expect(await screen.findByText("Post a job page")).toBeTruthy();
    expect(state.explained).toEqual([]);
  });

  it("shows nothing and asks the server nothing while the switch is off for the viewer", async () => {
    state.on = false;
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    expect(state.fetches).toBe(0);
  });

  // Audit #27: "Put it together" was offered on a mug. Only the choices the items can need show.
  // @mutate src/components/declutter/DeclutterAddHelpr.tsx | const kinds = setupKindsFor(info.data.item_details, info.data.handover); | const kinds = setupKindsFor(undefined, info.data.handover);
  it("a mug gets no Helpr panel; a bookshelf gets put together and hang, not set up", async () => {
    state.details = [{ title: "Blue mug", category: "kitchen", delivery_size: "small" }];
    const mug = show();
    await waitFor(() => expect(state.fetches).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("region", { name: "Add a Helpr" })).toBeNull();
    mug.unmount();
    state.details = [{ title: "Oak bookshelf", category: "furniture", delivery_size: "large" }];
    show();
    expect(await screen.findByRole("link", { name: "Put it together" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hang it on the wall" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set it up" })).toBeNull();
  });

  it("offers three one-tap choices, each opening Post a job for this order", async () => {
    show();
    expect(await screen.findByText("Need help moving it?")).toBeTruthy();
    const hrefs = ["Put it together", "Hang it on the wall", "Set it up"].map((t) => screen.getByRole("link", { name: t }).getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(2);
    expect(hrefs).toEqual([
      "/post-job?declutterOrder=o1&help=assemble",
      "/post-job?declutterOrder=o1&help=mount",
      "/post-job?declutterOrder=o1&help=setup",
    ]);
  });

  // GROW-5 (owner 2026-10-29): "Need help moving it?" opens a pre-filled moving job, only when
  // the buyer collects something big themselves.
  it("a big item the buyer picks up: Need help moving it? opens a moving job for this order", async () => {
    state.details = [{ title: "Sectional sofa", category: "furniture", delivery_size: "xl" }];
    showRouted();
    expect(await screen.findByText("Need help moving it?")).toBeTruthy();
    const move = screen.getByRole("link", { name: "Move it to my place" });
    expect(move.getAttribute("href")).toBe("/post-job?declutterOrder=o1&help=move");
    // Move comes first, before the set-up choices.
    const names = screen.getAllByRole("link").map((l) => l.textContent);
    expect(names.length).toBeGreaterThan(2);
    expect(names).toEqual(["Move it to my place", "Put it together", "Hang it on the wall"]);
    fireEvent.click(move);
    expect(await screen.findByText("Post a job page")).toBeTruthy();
  });

  it("no moving choice on a Helpr or seller delivery (it is already brought) or for a small item", async () => {
    const cases = [
      { handover: "delivery", details: [{ title: "Sectional sofa", category: "furniture", delivery_size: "xl" }] },
      // AUD31-8: the seller delivers it.
      { handover: "seller_delivery", details: [{ title: "Sectional sofa", category: "furniture", delivery_size: "xl" }] },
      { handover: "delivery", details: undefined },
      { handover: "porch", details: [{ title: "Desk lamp", category: "home_decor", delivery_size: "small" }] },
    ];
    expect(cases.length).toBeGreaterThan(2);
    for (const c of cases) {
      state.handover = c.handover;
      state.details = c.details;
      state.fetches = 0;
      const view = show();
      await waitFor(() => expect(state.fetches).toBeGreaterThan(0));
      expect(await screen.findByRole("region", { name: "Add a Helpr" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Move it to my place" }), c.handover).toBeNull();
      expect(screen.getByText("Need a hand with it?")).toBeTruthy();
      view.unmount();
    }
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
