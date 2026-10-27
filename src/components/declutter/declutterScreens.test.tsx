/**
 * The Declutter screens (second slice): the states a member can reach, in plain words
 * (docs/specs/declutter-auctions.md). The Declutter API module and the
 * account hooks are stubbed: these tests check what each STATE renders, not
 * the backend (the backend proof is src/test/pglite/declutterSlice2.pglite.mjs).
 *
 * @mutate src/components/declutter/DeclutterSellView.tsx |   if (underAge) { |   if (false) {
 * @mutate src/components/declutter/declutterUi.tsx |   if (enabled) return <>{children}</>; |   return <>{children}</>;
 * @mutate src/components/declutter/declutterUi.tsx |   pending_review: "Waiting for a review", |   pending_review: "pending_review",
 * @mutate src/components/declutter/DeclutterQuestions.tsx |             <Button type="submit" className="h-auto shrink-0" disabled={ask.isPending \|\| text.length < 2}> |             <Button type="submit" className="h-auto shrink-0 btn-grad-primary" variant="ghost" disabled={ask.isPending \|\| text.length < 2}>
 * @mutate src/components/declutter/DeclutterQuestions.tsx | <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{q.question}</p> | <p className="text-ds-15 font-semibold">{q.question}</p>
 * @mutate src/components/declutter/DeclutterSellView.tsx |                 <Checkbox id={`sell-tax-${i}`} className="mt-0.5" checked={checks[i]} |                 <input type="checkbox" id={`sell-tax-${i}`} className="mt-0.5" checked={checks[i]}
 * @mutate src/components/declutter/declutterUi.tsx |     if (agreed.data === true) return <>{agreedSales}</>; |
 * Owner 2026-10-19: back from Stripe's card page, the member returns to the item and carries on.
 * @mutate src/pages/declutter/DeclutterPage.tsx |     const state: AfterCardState \| null = cardReturn === "saved" ? { afterCard: next.action } : null; |     const state: AfterCardState \| null = null;
 * @mutate src/pages/declutter/DeclutterPage.tsx |     navigate(afterCardPath(next.itemId), { replace: true, state }); |     void state;
 * @mutate src/components/declutter/DeclutterItemView.tsx | : <OfferPanel item={it} userId={user.id} />)} | : null)}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  agreed: false,
  card: null as unknown,
};

// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
// Seller delivery (20261027153244): its settings card and checkout offer read through these; answered here, never Supabase.
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/sellerDelivery")>();
  return {
    ...real,
    fetchMySellerDelivery: async () => ({ enabled: false, rate_cents: null, free_over_cents: null, radius_miles: 10, windows: [], days_off: [],
      items_off: [], rules: real.SELLER_DELIVERY_RULES }),
    fetchSellerDeliveryOffer: async () => ({ available: false, reason: "seller_not_delivering", rate_cents: null, base_rate_cents: null,
      free_over_cents: null, items_cents: null, radius_miles: null, dropoff_area: null, slot_minutes: 60, slots: [], held_slot: null }),
  };
});
vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => state.feature,
  // DeclutterPage warms the declutter_wanted read with useFeatureStatus (Q?declutter-settle).
  useFeatureStatus: () => ({ on: state.feature, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
// The whole hook shape: Sell it for me (on Selling and Sell an item) reads explain + gatedProps too.
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => state.payoutBlock }));
// The server's answer to "may this member set up payouts" (payout_setup_hire_allowed_for_me):
// since 2026-10-27, true for a seller only once a paid order holds money for them.
const setupAllowed = { value: false };
vi.mock("@/hooks/usePayoutSetupHireAllowed", () => ({ usePayoutSetupHireAllowed: () => setupAllowed.value }));
vi.mock("@/hooks/useStripeConnectStatus", () => ({ useStripeConnectStatus: () => ({ payoutPrompt: { kind: "setup" }, refetchStatus: () => {} }) }));
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
// Haul-away (its own screens' tests: declutterHaulAway.test.tsx); here only no network.
// A plain (synchronous) factory: with an async one spreading the original, the
// screen's dynamic import could resolve the real module first and reach the
// network (seen flaky 2026-10-17).
vi.mock("@/lib/declutter/haulAway", () => ({
  fetchHaulAwayState: async () => [],
  oneTripGroup: () => [],
  haulJobToDelete: () => null,
  deleteNeverPaidHaulJob: async () => true,
  cancelHaulAway: async () => "live",
  HAUL_AWAY_CLIENT_ERROR_COPY: { haul_away_job_stuck: "stuck" },
}));
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => [],
  fetchMyItems: async () => state.mine,
  fetchPhotos: async () => state.photos,
  fetchDropStates: async () => new Map(),
  fetchQuestions: async () => state.questions,
  fetchSellerRating: async () => ({ avg: 4.8, count: 12 }),
  fetchSellerCard: async () => ({ name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" }),
  fetchWatching: async () => new Set(),
  fetchItem: async () => state.item,
  fetchMyItemReview: async () => ({ review_note: "Used car seats cannot be sold.", ai_flagged: true }),
  fetchMyItemPrivate: async () => ({ floor_price_cents: 3000, pickup_address: "100 Main Street, Baton Rouge, LA 70802", pickup_lat: 30.45, pickup_lng: -91.15 }),
  updateDraft: async () => "i1",
  setPorchOk: async () => true,
  fetchMyPickupWindows: async () => [],
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  withdrawItem: async () => undefined,
  setWatch: async () => "watching",
  askQuestion: async () => "q",
  answerQuestion: async () => "a",
  fetchMyCard: async () => state.card,
  fetchMyActiveStrikes: async () => 0,
  fetchMyOffers: async () => [],
  fetchMyCart: async () => [],
  makeOffer: async () => "o",
  respondOffer: async () => "declined",
  buyNow: async () => "l",
  sellerCancelSale: async () => 1,
  fetchHasAgreedSales: async () => state.agreed,
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { rememberAfterCard } from "@/lib/declutter/afterCard";
import { formProblem } from "./DeclutterSellView";
import { dollarsToCents } from "@/lib/declutter/money";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What useFeature's own query would hold once the server answered.
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: state.feature });
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
  area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: null, porch_ok: true,
};

/** Walk the sell flow (board 31a-158) from step 1 to step 5 on a loaded draft. */
async function toStep5() {
  await screen.findByRole("heading", { name: "Show it off" });
  await screen.findByText(/^\d+ of 12/);
  for (let i = 0; i < 3; i++) fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
  await screen.findByRole("heading", { name: "Ready to list?" });
}

describe("Declutter screens", () => {
  beforeEach(() => {
    state.feature = true;
    state.underAge = false;
    state.payoutBlock = null;
    state.mine = [];
    state.item = null;
    state.photos = [];
    state.questions = [];
    state.agreed = false;
    state.card = null;
    sessionStorage.clear();
  });

  it("switch off: every Declutter route is the 404", async () => {
    state.feature = false;
    at("/declutter", <DeclutterPage />);
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("Declutter")).toBeNull();
  });

  it("switch off with a sale already agreed: the member can still finish it (row 62)", async () => {
    state.feature = false;
    state.agreed = true;
    at("/declutter", <DeclutterPage />);
    expect(await screen.findByText("Declutter is closed for now.")).toBeInTheDocument();
    expect(screen.queryByText("Page not found")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sell an item" })).toBeNull();
  });

  it("switch on: Browse (on a phone, selling starts from the bottom bar's center +), and an empty state in plain words", async () => {
    at("/declutter", <DeclutterPage />);
    // A phone's bar is the section chips (the Explore header, owner 2026-10-22); the page's one h1 names the section.
    expect(screen.getByRole("heading", { level: 1, name: "Declutter" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Declutter" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "Sell an item" })).toBeNull();
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
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(document.querySelector("[data-add-photos]")).toBeNull();
  });

  it("no payout setup: listing is not blocked and nobody is told to set up before a sale (owner 2026-10-27)", () => {
    state.payoutBlock = "payouts_not_ready";
    setupAllowed.value = false;
    at("/declutter/sell", <DeclutterSellPage />);
    expect(screen.queryByText("Set up payouts before you list.")).toBeNull();
    // List first, set up at first sale: the prompt waits for the server to say money is owed.
    expect(screen.queryByText("Set up payouts to get paid.")).toBeNull();
    // The form is usable: step 1's photo picker is there.
    expect(document.querySelector("[data-add-photos]")).not.toBeNull();
  });

  it("a seller owed money (a paid sale) whose payouts are not ready is prompted to set up, with the link", () => {
    state.payoutBlock = "payouts_not_ready";
    setupAllowed.value = true;
    try {
      at("/declutter/sell", <DeclutterSellPage />);
      expect(screen.getByText("Set up payouts to get paid.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/profile?tab=payment");
    } finally {
      setupAllowed.value = false;
    }
  });

  it("the seller of a rejected listing reads the admin's reason; no offer button exists", async () => {
    state.item = { ...ITEM, status: "rejected" };
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText("Your listing: Not approved")).toBeInTheDocument();
    expect(await screen.findByText("Reason: Used car seats cannot be sold.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /offer/i })).toBeNull();
  });

  it("a buyer sees area + miles wording, the watch heart, and (no saved card) Buy now and Make an offer, which ask for a card first", async () => {
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText("Pickup in Mid-City, Baton Rouge")).toBeInTheDocument();
    expect(screen.getByText("The exact address is shared after you pay.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch this item" })).toBeInTheDocument();
    // Owner 2026-10-19: the two actions show with no saved card (Marketplace / OfferUp / Mercari).
    const buyNow = await screen.findByRole("button", { name: "Buy now · $42.70 total" });
    expect(screen.getByRole("button", { name: "Make an offer" })).toBeInTheDocument();
    expect(screen.getByText("You're only charged when you buy.")).toBeInTheDocument();
    await waitFor(() => expect(buyNow).toBeEnabled());
    fireEvent.click(buyNow);
    expect(await screen.findByText("Add a card to finish.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
    // Audit #47: ONE filled primary at a time; while the card is asked for, Buy now steps back to an outline.
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx |           variant={showCardStep ? "outline" : undefined} |           variant={undefined}
    expect(document.querySelectorAll("[aria-label='Buy or make an offer'] button.btn-grad-primary").length).toBe(1);
    // Near the price: the actions come before the description, not at the bottom of the page.
    expect(buyNow.compareDocumentPosition(screen.getByText("Solid oak.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The seller card (owner 2026-10-19): name, stars only with reviews, joined date.
    expect(await screen.findByText("Dana R.")).toBeInTheDocument();
    expect(document.querySelector("[data-seller-rating]")?.textContent).toMatch(/4\.8 stars from .*12 reviews/);
  });

  describe("back from Stripe's card page (declutter-card returns to /declutter?card=saved or =cancelled)", () => {
    const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
    function returnTo(path: string) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: state.feature });
      return render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/declutter" element={<DeclutterPage />} />
              <Route path="/declutter/item/:id" element={<DeclutterItemPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    it("card saved: back on the item the member left, with the offer box open", async () => {
      state.item = { ...ITEM, id: ID, seller_id: "u2", status: "live" };
      state.card = { brand: "visa", last4: "4242" };
      rememberAfterCard(ID, "offer");
      returnTo("/declutter?card=saved");
      expect(await screen.findByRole("heading", { name: "Oak rocking chair", level: 1 })).toBeInTheDocument();
      expect(await screen.findByLabelText("Your offer")).toBeInTheDocument();
    });

    it("cancelled: back on the item, nothing started", async () => {
      state.item = { ...ITEM, id: ID, seller_id: "u2", status: "live" };
      rememberAfterCard(ID, "offer");
      returnTo("/declutter?card=cancelled");
      expect(await screen.findByRole("button", { name: "Buy now · $42.70 total" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Your offer")).toBeNull();
      expect(screen.queryByText("Checking for your card…")).toBeNull();
    });

    it("nothing remembered: stays on Declutter", async () => {
      returnTo("/declutter?card=saved");
      expect(await screen.findByText("Nothing for sale yet.")).toBeInTheDocument();
    });
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
    // Sell: walk the 5 steps, and List it once there is a photo.
    state.item = { ...ITEM, status: "draft" };
    state.photos = [1, 2, 3].map((n) => ({ id: `p${n}`, item_id: "i1", storage_path: `u1/declutter/i1/${n}.jpg`, position: n }));
    const sell = at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    await toStep5();
    await screen.findByRole("button", { name: "List it" });
    check();
    sell.unmount();
    // A buyer's Ask, and the seller's Answer.
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    const buyer = at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    await screen.findByRole("button", { name: "Ask" });
    check();
    buyer.unmount();
    state.item = { ...ITEM, status: "live" };
    state.questions = [{ id: "q1", item_id: "i1", question: "Is it sturdy?", answer: null, created_at: "2026-10-15", answered_at: null }];
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    await screen.findByRole("button", { name: "Answer" });
    check();
    // Inventory floor: Finish listing, Continue, List it, Ask, Answer. (The top bar's
    // "Sell an item" + is a plain icon button since 2026-10-19, the same as the bell: not glossy.)
    expect(seen).toBeGreaterThan(4);
  });

  it("the four tax confirmations are the shared Checkbox and porch pickup the shared Switch, never native inputs", async () => {
    state.item = { ...ITEM, status: "draft" };
    state.photos = [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/1.jpg", position: 0 }];
    at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    await screen.findByRole("heading", { name: "Show it off" });
    for (let i = 0; i < 3; i++) fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    // Row 101: porch pickup is on by default for a listing (board 49: a toggle).
    expect(await screen.findByRole("switch", { name: /Porch pickup/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("heading", { name: "Ready to list?" });
    const boxes = screen.getAllByRole("checkbox");
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
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    const answer = await screen.findByText((_, el) => el?.hasAttribute("data-answer") === true);
    // The question and the description are the word alone; the answer also carries " — Dana".
    const texts = [...screen.getAllByText(word), answer];
    expect(texts.length).toBeGreaterThan(2);
    for (const t of texts) expect(t.className).toMatch(/\[overflow-wrap:anywhere\]|break-all|break-words/);
  });
});

describe("Sell form checks mirror the server", () => {
  const ok = { title: "Oak chair", description: "", category: "furniture", conditionStars: 4, deliverySize: "large" as const, price: "40", floor: "20", free: false, areaLabel: "Mid-City", pickupAddress: "1234 Example St, Baton Rouge" };
  it("accepts a complete form and converts dollars to cents", () => {
    expect(formProblem(ok)).toBeNull();
    // Q2419: a free item needs no price or lowest price.
    expect(formProblem({ ...ok, free: true, price: "", floor: "" })).toBeNull();
    expect(formProblem({ ...ok, price: "", floor: "" })).toMatch(/price/);
    expect(dollarsToCents("$1,250.50")).toBe(125050);
  });
  it("refuses a floor above the price, a street address as the area, and a missing name", () => {
    expect(formProblem({ ...ok, floor: "50" })).toMatch(/lowest price/);
    expect(formProblem({ ...ok, areaLabel: "1234 Example St" })).toMatch(/not a street address/);
    expect(formProblem({ ...ok, areaLabel: "70005 Metairie" })).toBeNull();
    expect(formProblem({ ...ok, title: "ab" })).toMatch(/name/);
  });
});
