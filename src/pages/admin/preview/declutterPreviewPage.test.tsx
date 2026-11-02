/**
 * Q2585: the admin Declutter stage preview draws the REAL Buying / Selling views on the stage's sample, for every
 * stage on either side, and while it is open nothing reaches the network (the page's own fetch layer answers; the
 * window's fetch underneath is a spy that must stay unused for every Supabase request).
 * The backend's rules are proved request by request in src/test/adminDeclutterPreviewIsInert.test.ts.
 *
 * @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |           : <SellingDash todo={todo} userId={sample.userId} listings={<MyListingsView userId={sample.userId} haulOn />} />} |           : null}
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |   globalThis.fetch = previewFetch; |   void previewFetch;
 * @mutate src/pages/admin/preview/declutterPreviewSamples.ts |     declutter_my_free_pause: null,\n |
 * @mutate src/pages/admin/preview/declutterPreviewSamples.ts |     declutter_payouts: [],\n |
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |       if (Object.prototype.hasOwnProperty.call(s.reads, name)) { |       if (false) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DECLUTTER_PREVIEW_STAGES } from "./declutterPreviewSamples";
import { declutterPreviewChecks } from "./declutterPreviewBackend";

const ADMIN = "00000000-0000-4000-a000-000000000001";
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: ADMIN }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: ADMIN }, isReady: true }) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

const SUPABASE = "https://unit-test.invalid";
let spy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;
beforeEach(() => {
  spy = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
  globalThis.fetch = spy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  declutterPreviewChecks.onUnlisted = undefined;
});

import DeclutterPreviewPage, { isSamePageMove } from "./DeclutterPreviewPage";

function open(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/preview/declutter${search}`]}>
        <Routes><Route path="/admin/preview/declutter" element={<DeclutterPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const supabaseCalls = () => spy.mock.calls.filter(([u]) => String(u instanceof Request ? u.url : u).startsWith(SUPABASE) && !String(u).includes("/auth/v1/"));

describe("Q2585: /admin/preview/declutter", () => {
  it("draws the real Buying view on a paid sample order for the buyer, and the real Selling view for the seller", async () => {
    const a = open("?stage=paid&side=buyer");
    expect(await screen.findByRole("heading", { level: 1, name: /Declutter preview: Paid, pickup not booked, buyer/ })).toBeInTheDocument();
    expect(await screen.findAllByText(/Oak rocking chair \(sample\)/)).not.toHaveLength(0);
    expect(document.querySelector('[data-preview-view="paid:buyer"]')).not.toBeNull();
    a.unmount();
    open("?stage=paid&side=seller");
    await waitFor(() => expect(document.querySelector('[data-preview-view="paid:seller"]')).not.toBeNull());
    expect(await screen.findAllByText(/Oak rocking chair \(sample\)/)).not.toHaveLength(0);
    expect(supabaseCalls()).toEqual([]);
  });

  it("every stage on either side draws without an error screen, answers every read from its sample, and sends nothing", async () => {
    // Audit 1102c P1: a read the sample does not answer drew made-up states (Invalid Date, a crashed Seller delivers).
    const unlisted: string[] = [];
    let drawn = 0;
    for (const { key } of DECLUTTER_PREVIEW_STAGES) {
      for (const side of ["buyer", "seller"]) {
        declutterPreviewChecks.onUnlisted = (what) => unlisted.push(`${key}:${side} ${what}`);
        const r = open(`?stage=${key}&side=${side}`);
        await waitFor(() => expect(document.querySelector(`[data-preview-view="${key}:${side}"]`), `${key}:${side}`).not.toBeNull());
        // Let the views' reads land.
        await new Promise((res) => setTimeout(res, 20));
        expect(screen.queryByText(/Something went wrong/i), `${key}:${side}`).toBeNull();
        expect(document.querySelector("[data-preview-crashed]"), `${key}:${side} crashed`).toBeNull();
        r.unmount();
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThan(20);
    expect(unlisted).toEqual([]);
    expect(supabaseCalls()).toEqual([]);
  });

  // Audit 1102c P3 (Q2621): the preview passed todo={null}, so the Selling chips showed no counts and a sale to hand
  // over never came first. The counts come from the sample (declutterTodo), as the real tab's come from the cart.
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |           : <SellingDash todo={todo} userId | : <SellingDash todo={null} userId
  it("Q2621: Selling's chips count the sample's sale to hand over, and the sale comes first", async () => {
    open("?stage=paid&side=seller");
    const chip = await waitFor(() => { const el = document.querySelector('[data-status-box="sold"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect(chip.textContent).toBe("Hand over · 1");
    // AUD31-4: the sale to hand over is drawn before the listings.
    const sold = await screen.findByRole("region", { name: /Sold: pickup and payout/ });
    const listings = await screen.findByText(/Your listings/);
    expect(sold.compareDocumentPosition(listings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Let the views' last reads land on the preview layer before cleanup puts the real fetch back.
    await new Promise((res) => setTimeout(res, 50));
    expect(supabaseCalls()).toEqual([]);
  });

  // Audit 1102c P4 (Q2622): the status chips are a search-param change on this page; the inert navigation blocked them
  // ("Preview: this would open ...&status=offers"), so no chip filter could be walked.
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx | replace: (...a: Opts) => (samePage(a[0]) ? outer.navigator.replace(...a) | replace: (...a: Opts) => (false ? outer.navigator.replace(...a)
  it("Q2622: a status chip filters the preview's own list", async () => {
    open("?stage=paid&side=seller");
    const chip = await waitFor(() => { const el = document.querySelector('[data-status-box="sold"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    chip.click();
    await waitFor(() => expect(document.querySelector('[data-status-box="sold"]')).toHaveAttribute("aria-pressed", "true"));
    // The stage and side stay (the chip changes only ?status=).
    expect(document.querySelector('[data-preview-view="paid:seller"]')).not.toBeNull();
    await new Promise((res) => setTimeout(res, 50));
    expect(supabaseCalls()).toEqual([]);
  });

  // Q2622: only a move on this page goes through; another page (Browse, an item, Home) stays a note.
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |   return !to.pathname \|\| to.pathname === here; |   return true;
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx | to.startsWith("?") \|\| to.startsWith("#") \|\| to.split(/[?#]/)[0] === here; | true;
  it("Q2622: only a move on this page goes through", () => {
    const here = "/admin/preview/declutter";
    expect(isSamePageMove("?status=sold", here)).toBe(true);
    expect(isSamePageMove(`${here}?stage=paid&status=sold`, here)).toBe(true);
    expect(isSamePageMove({ pathname: here, search: "?status=offers" }, here)).toBe(true);
    expect(isSamePageMove({ search: "?status=offers" }, here)).toBe(true);
    expect(isSamePageMove("/declutter?tab=selling&status=offers", here)).toBe(false);
    expect(isSamePageMove({ pathname: "/declutter/item/1" }, here)).toBe(false);
    expect(isSamePageMove("/home", here)).toBe(false);
  });

  it("the controls name every stage and both sides", async () => {
    open("?stage=booked&side=seller");
    await screen.findByRole("region", { name: "Declutter preview controls" });
    expect(document.querySelectorAll("[data-preview-stage]").length).toBe(DECLUTTER_PREVIEW_STAGES.length);
    expect(document.querySelector('[data-preview-stage="booked"]')).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector('[data-preview-side="seller"]')).toHaveAttribute("aria-checked", "true");
  });
});
