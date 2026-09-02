/**
 * /wrapped is the app's most SHARED screen, so a wrong number here travels.
 * These lock the six defects found on 2026-09-01, each of which rendered
 * perfectly and said something untrue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HelprWrapped from "./HelprWrapped";

const USER = { id: "u-1", email: "both@helpr.test" };

/** Rows keyed by the shape of the query the page issues. */
interface Rows {
  posted: unknown[];
  helped: unknown[];
  reviewsGiven: unknown[];
  reviewsReceived: unknown[];
}
let rows: Rows;

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: USER, isReady: true, session: null }),
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const shareNativeMock = vi.fn();
vi.mock("@/lib/nativeShare", () => ({
  shareNative: (...args: unknown[]) => shareNativeMock(...args),
}));

vi.mock("@/integrations/supabase/client", () => {
  /** A chainable PostgREST stub that resolves to whatever `pick` selects. */
  function builder(pick: () => unknown) {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "neq", "order", "in"]) {
      self[m] = () => self;
    }
    self.maybeSingle = () => Promise.resolve({ data: null, error: null });
    self.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: pick(), error: null }).then(res);
    return self;
  }
  return {
    supabase: {
      from: (table: string) => {
        const calls = { table, filters: {} as Record<string, string> };
        const b = builder(() => {
          if (calls.table === "profiles") return null;
          if (calls.table === "reviews") {
            return calls.filters.reviewer_id ? rows.reviewsGiven : rows.reviewsReceived;
          }
          return calls.filters.helper_id ? rows.helped : rows.posted;
        }) as Record<string, unknown>;
        b.eq = (col: string, val: string) => {
          calls.filters[col] = val;
          return b;
        };
        return b;
      },
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    },
  };
});

function renderWrapped() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/profile?tab=wrapped"]}>
        <HelprWrapped />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A member who BOTH posts and helps — the case every defect below hid from. */
function bothSides() {
  rows = {
    // $650 of completed posted work (+ one open job that must not count).
    posted: [
      { id: "p1", budget: 400, category: "moving", helper_id: "x1", status: "completed" },
      { id: "p2", budget: 250, category: "cleaning", helper_id: "x2", status: "completed" },
      { id: "p3", budget: 180, category: "cleaning", helper_id: null, status: "open" },
    ],
    // $450 gross at 15% → $382.50 take-home.
    helped: [
      { id: "h1", budget: 300, category: "yard_work", customer_id: "y1", helper_fee_percent: 15, platform_fee_amount: null, urgent_fee: 0, helpers_needed: 1, is_group_job: false, payment_status: "released" },
      { id: "h2", budget: 150, category: "yard_work", customer_id: "y2", helper_fee_percent: 15, platform_fee_amount: null, urgent_fee: 0, helpers_needed: 1, is_group_job: false, payment_status: "released" },
    ],
    reviewsGiven: [{ id: "rg1", rating: 5 }, { id: "rg2", rating: 4 }, { id: "rg3", rating: 5 }],
    // 5, 3, 4 → mean 4.0. A max would read 5.0.
    reviewsReceived: [{ id: "rr1", rating: 5 }, { id: "rr2", rating: 3 }, { id: "rr3", rating: 4 }],
  };
}

describe("/wrapped tells the truth about a year", () => {
  beforeEach(() => {
    shareNativeMock.mockReset().mockResolvedValue("shared");
    bothSides();
  });

  it("shows what a member SPENT even when they also earned", async () => {
    // The tile was gated on `totalEarned === 0`, so anyone who both posts and
    // helps never saw their own spend.
    renderWrapped();
    expect(await screen.findByText("invested in community")).toBeTruthy();
    expect(screen.getByText("$650")).toBeTruthy();
    // …alongside, not instead of, the earnings tile.
    expect(screen.getByText("earned")).toBeTruthy();
    expect(screen.getByText("$382")).toBeTruthy();
  });

  it("reports the AVERAGE rating received, not the single kindest review", async () => {
    renderWrapped();
    expect(await screen.findByText("average rating")).toBeTruthy();
    expect(screen.getByText("4.0")).toBeTruthy();
    expect(screen.queryByText("best rating")).toBeNull();
    expect(screen.queryByText("5.0")).toBeNull();
  });

  it("makes no claim about hours worked — nothing in this app records them", async () => {
    renderWrapped();
    await screen.findByText("earned");
    // "~26 hrs" was `totalEarned / 15`: an undisclosed $15/hr rate presented in
    // the same grid as measured figures, on a card built to be screenshotted.
    expect(screen.queryByText(/hrs?$/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/~\d+\s*hrs/);
  });

  it("renders the reviews the member WROTE instead of fetching and dropping them", async () => {
    renderWrapped();
    expect(await screen.findByText("reviews written")).toBeTruthy();
    expect(screen.getByText("reviews received")).toBeTruthy();
  });

  it("shares the SAME money string the tile shows", async () => {
    renderWrapped();
    fireEvent.click(await screen.findByRole("button", { name: /Share Your/i }));
    await waitFor(() => expect(shareNativeMock).toHaveBeenCalled());
    const text = (shareNativeMock.mock.calls[0][0] as { text: string }).text;
    // The tile floors to $382; `toLocaleString()` used to send "$382.5".
    expect(text).toContain("earned $382");
    expect(text).not.toContain("382.5");
  });

  it("cannot open two share sheets from a double tap", async () => {
    let release: (v: string) => void = () => {};
    shareNativeMock.mockImplementation(() => new Promise<string>((r) => { release = r; }));
    renderWrapped();
    const btn = await screen.findByRole("button", { name: /Share Your/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("button", { name: /Opening/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Opening/i }));
    expect(shareNativeMock).toHaveBeenCalledTimes(1);
    release("shared");
    await waitFor(() => expect(screen.getByRole("button", { name: /Share Your/i })).toBeTruthy());
  });

  it("still hides the spend tile when there is genuinely no spend", async () => {
    rows.posted = [{ id: "p3", budget: 180, category: "cleaning", helper_id: null, status: "open" }];
    renderWrapped();
    await screen.findByText("earned");
    expect(screen.queryByText("invested in community")).toBeNull();
  });
});
