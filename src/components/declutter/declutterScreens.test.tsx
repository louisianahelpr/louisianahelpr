/**
 * The Declutter screens (second slice): the states a member can reach, in plain words
 * (docs/specs/declutter-auctions.md). The Declutter API module and the
 * account hooks are stubbed: these tests check what each STATE renders, not
 * the backend (the backend proof is src/test/pglite/declutterSlice2.pglite.mjs).
 *
 * @mutate src/components/declutter/DeclutterSellView.tsx |   if (underAge) { |   if (false) {
 * @mutate src/components/declutter/declutterUi.tsx |   if (enabled) return <>{children}</>; |   return <>{children}</>;
 * @mutate src/components/declutter/declutterUi.tsx |   pending_review: "Waiting for a review", |   pending_review: "pending_review",
 * @mutate src/components/declutter/DeclutterItemView.tsx |             <Button type="submit" size="sm" disabled={ask.isPending \|\| question.trim().length < 2}> |             <Button type="submit" size="sm" className="btn-grad-primary" variant="ghost" disabled={ask.isPending \|\| question.trim().length < 2}>
 * @mutate src/components/declutter/DeclutterItemView.tsx | <p className="text-sm font-medium [overflow-wrap:anywhere]">Q: | <p className="text-sm font-medium">Q:
 * @mutate src/components/declutter/DeclutterSellView.tsx |                 <Checkbox id={`sell-tax-${i}`} className="mt-0.5" checked={checks[i]} |                 <input type="checkbox" id={`sell-tax-${i}`} className="mt-0.5" checked={checks[i]}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  underAge: false,
  payoutBlock: null as string | null,
  mine: [] as unknown[],
  item: null as unknown,
  photos: [] as unknown[],
  questions: [] as unknown[],
};

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge }) }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => state.payoutBlock }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children, titleActions }: { title: string; children: React.ReactNode; titleActions?: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {titleActions}
      {children}
    </main>
  ),
}));
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>Page not found</p> }));
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => [],
  fetchMyItems: async () => state.mine,
  fetchPhotos: async () => state.photos,
  fetchQuestions: async () => state.questions,
  fetchSellerRating: async () => ({ avg: 4.8, count: 12 }),
  fetchWatching: async () => new Set(),
  fetchItem: async () => state.item,
  fetchMyItemReview: async () => ({ review_note: "Used car seats cannot be sold.", ai_flagged: true }),
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  withdrawItem: async () => undefined,
  setWatch: async () => "watching",
  askQuestion: async () => "q",
  answerQuestion: async () => "a",
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { dollarsToCents, formProblem } from "./DeclutterSellView";

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What useFeature's own query would hold once the server answered.
  qc.setQueryData(["feature-enabled", "declutter", "u1"], state.feature);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ITEM = {
  id: "i1", seller_id: "u1", status: "pending_review", title: "Oak rocking chair", description: "Solid oak.",
  category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: null,
};

describe("Declutter screens", () => {
  beforeEach(() => {
    state.feature = true;
    state.underAge = false;
    state.payoutBlock = null;
    state.mine = [];
    state.item = null;
    state.photos = [];
    state.questions = [];
  });

  it("switch off: every Declutter route is the 404", () => {
    state.feature = false;
    at("/declutter", <DeclutterPage />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("Declutter")).toBeNull();
  });

  it("switch on: Browse with a Sell button, and an empty state in plain words", async () => {
    at("/declutter", <DeclutterPage />);
    expect(screen.getByRole("heading", { name: "Declutter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell an item" })).toBeInTheDocument();
    expect(await screen.findByText("Nothing for sale yet.")).toBeInTheDocument();
  });

  it("My listings shows each status in plain words, incl. waiting for a review", async () => {
    state.mine = [ITEM, { ...ITEM, id: "i2", status: "draft", title: "Lamp" }];
    at("/declutter?view=mine", <DeclutterPage />);
    expect(await screen.findByText("Waiting for a review")).toBeInTheDocument();
    expect(screen.getByText("Not listed yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish listing" })).toBeInTheDocument();
    expect(screen.queryByText("pending_review")).toBeNull();
  });

  it("under 18: selling is a plain block, not a form", () => {
    state.underAge = true;
    at("/declutter/sell", <DeclutterSellPage />);
    expect(screen.getByText("You must be 18 or older to sell on Declutter.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("no payout setup: a plain block with the way to fix it, the form still usable", () => {
    state.payoutBlock = "payouts_not_ready";
    at("/declutter/sell", <DeclutterSellPage />);
    expect(screen.getByText("Set up payouts before you list.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/profile?tab=payment");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("the seller of a rejected listing reads the admin's reason; no offer button exists", async () => {
    state.item = { ...ITEM, status: "rejected" };
    at("/declutter/item/i1", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText("Your listing: Not approved")).toBeInTheDocument();
    expect(await screen.findByText("Reason: Used car seats cannot be sold.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /offer/i })).toBeNull();
  });

  it("a buyer sees area + miles wording, the watch heart and that offers come later", async () => {
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    at("/declutter/item/i1", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText("Pickup in Mid-City, Baton Rouge")).toBeInTheDocument();
    expect(screen.getByText("The exact address is shared after you pay.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch this item" })).toBeInTheDocument();
    expect(screen.getByText("Making offers is coming soon.")).toBeInTheDocument();
    expect(await screen.findByText(/4\.8 stars from 12 reviews/)).toBeInTheDocument();
  });
});

/**
 * THE DECLUTTER SCREENS WEAR THE APP'S OWN CONTROLS (2026-10-15 visual pass on prod, lane E).
 * Measured on prod: every Declutter primary was a hand-rolled `<button className="btn-grad-primary">`
 * with no ink of its own, so it inherited the page's text colour: rgb(46,47,34) on the olive gloss in
 * light mode (about 1.5:1) and cream on the light olive in dark mode. The shared `<Button>` pins the
 * ink (button.tsx `primary`). The tax confirmations were native checkboxes (system blue on iOS), and a
 * long unbroken question ran out of its card at 375. Each rule below is checked on every screen state
 * that renders the control, never on one sample.
 */
describe("Declutter controls are the shared ones", () => {
  const PINNED_INK = "!text-[hsl(var(--parchment))]";
  // SegmentedControl's selected option takes its ink from `.segmented-option-selected` (index.css).
  const gradients = () => Array.from(document.querySelectorAll<HTMLElement>(".btn-grad-primary:not(.segmented-option-selected)"));

  it("every glossy primary on every Declutter screen pins its ink (shared Button)", async () => {
    let seen = 0;
    const check = () => {
      for (const el of gradients()) {
        seen++;
        expect(el.className, `${el.textContent?.trim()} wears btn-grad-primary without pinned ink`).toContain(PINNED_INK);
      }
    };
    // Home (Sell an item) and My listings (Finish listing).
    state.mine = [{ ...ITEM, status: "draft" }];
    const home = at("/declutter?view=mine", <DeclutterPage />);
    await screen.findByRole("button", { name: "Finish listing" });
    check();
    home.unmount();
    // Sell: Save, and List this item once there are 3 photos.
    state.item = { ...ITEM, status: "draft" };
    state.photos = [1, 2, 3].map((n) => ({ id: `p${n}`, item_id: "i1", storage_path: `u1/declutter/i1/${n}.jpg`, position: n }));
    const sell = at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    await screen.findByRole("button", { name: "List this item" });
    check();
    sell.unmount();
    // A buyer's Ask, and the seller's Answer.
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    const buyer = at("/declutter/item/i1", <DeclutterItemPage />, "/declutter/item/:id");
    await screen.findByRole("button", { name: "Ask" });
    check();
    buyer.unmount();
    state.item = { ...ITEM, status: "live" };
    state.questions = [{ id: "q1", item_id: "i1", question: "Is it sturdy?", answer: null, created_at: "2026-10-15", answered_at: null }];
    at("/declutter/item/i1", <DeclutterItemPage />, "/declutter/item/:id");
    await screen.findByRole("button", { name: "Answer" });
    check();
    // Inventory floor: Sell an item x2, Finish listing, Save details, List this item, Ask, Answer.
    expect(seen).toBeGreaterThan(5);
  });

  it("the four tax confirmations are the shared Checkbox, not native inputs", async () => {
    state.item = { ...ITEM, status: "draft" };
    at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes.length).toBe(4);
    for (const b of boxes) expect(b.tagName).toBe("BUTTON");
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    // Each statement is the box's label.
    expect(screen.getByRole("checkbox", { name: "I bought this item for my own personal or household use." })).toBeInTheDocument();
  });

  it("a long unbroken question, answer or description can wrap inside its card", async () => {
    const word = "Supercalifragilistic".repeat(6);
    state.item = { ...ITEM, status: "live", description: word };
    state.questions = [{ id: "q1", item_id: "i1", question: word, answer: word, created_at: "2026-10-15", answered_at: "2026-10-15" }];
    at("/declutter/item/i1", <DeclutterItemPage />, "/declutter/item/:id");
    const texts = [await screen.findByText(`Q: ${word}`), screen.getByText(`A: ${word}`), screen.getByText(word)];
    for (const t of texts) expect(t.className).toMatch(/\[overflow-wrap:anywhere\]|break-all|break-words/);
  });
});

describe("Sell form checks mirror the server", () => {
  const ok = { title: "Oak chair", description: "", category: "furniture", conditionStars: 4, deliverySize: "large" as const, price: "40", floor: "20", areaLabel: "Mid-City", pickupAddress: "1234 Example St, Baton Rouge" };
  it("accepts a complete form and converts dollars to cents", () => {
    expect(formProblem(ok)).toBeNull();
    expect(dollarsToCents("$1,250.50")).toBe(125050);
  });
  it("refuses a floor above the price, a street address as the area, and a missing name", () => {
    expect(formProblem({ ...ok, floor: "50" })).toMatch(/lowest price/);
    expect(formProblem({ ...ok, areaLabel: "1234 Example St" })).toMatch(/not a street address/);
    expect(formProblem({ ...ok, areaLabel: "70005 Metairie" })).toBeNull();
    expect(formProblem({ ...ok, title: "ab" })).toMatch(/name/);
  });
});
