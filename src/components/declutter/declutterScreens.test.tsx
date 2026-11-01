/**
 * The Declutter screens (second slice): the states a member can reach, in plain words
 * (docs/specs/declutter-auctions.md). The Declutter API module and the
 * account hooks are stubbed: these tests check what each STATE renders, not
 * the backend (the backend proof is src/test/pglite/declutterSlice2.pglite.mjs).
 *
 * @mutate src/components/declutter/SellOneScreen.tsx |   if (underAge) { |   if (false) {
 * @mutate src/components/declutter/declutterUi.tsx |   if (enabled) return <>{children}</>; |   return <>{children}</>;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   pending_review: "Being checked. We'll send you a notice when it's done.", |   pending_review: "Waiting for a review. We'll send you a notice.",
 * @mutate src/components/declutter/DeclutterQuestions.tsx |             <Button type="submit" variant="outline" className="h-auto shrink-0" disabled={ask.isPending \|\| text.length < 2}> |             <Button type="submit" className="h-auto shrink-0 btn-grad-primary" variant="ghost" disabled={ask.isPending \|\| text.length < 2}>
 * @mutate src/components/declutter/DeclutterQuestions.tsx | <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{q.question}</p> | <p className="text-ds-15 font-semibold">{q.question}</p>
 * @mutate src/components/declutter/declutterUi.tsx | <Checkbox id={id} className="mt-0.5" checked={checked} onCheckedChange={(v) => onChange(v === true)} />; | <input type="checkbox" id={id} className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
 * Owner 2026-10-28 "make these checks 1": one box, all four facts; one tick lists (attestItem's four trues: api.test.ts).
 * @mutate src/components/declutter/useSellFlowState.ts |     if (!attested) { |     if (false) {
 * @mutate src/components/declutter/declutterUi.tsx |     if (agreed.data === true) return <>{agreedSales}</>; |
 * Owner 2026-10-19: back from Stripe's card page, the member returns to the item and carries on.
 * @mutate src/pages/declutter/DeclutterPage.tsx | afterCardReturnState(cardReturn === "saved", next) | afterCardReturnState(false, next)
 * @mutate src/pages/declutter/DeclutterPage.tsx |     navigate(afterCardPath(next.itemId), { replace: true, state: afterCardReturnState(cardReturn === "saved", next) }); |     void afterCardReturnState;
 * @mutate src/components/declutter/DeclutterItemView.tsx | : <OfferPanel item={it} userId={user.id} askSignal={offerAsk} footer={deliveredLine} />)} | : null)}
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  /** Deep audit #58: the seller's windows the item page reads (declutter_item_pickup_windows); null = not deployed. */
  itemWindows: null as { weekday: number; starts: string; ends: string }[] | null,
  /** Audit 1028 D1-2: the ways the seller ticked (declutter_items.handovers); null = an older item with none. */
  itemHandovers: null as string[] | null,
  underAge: false,
  payoutBlock: null as string | null,
  sellerCart: [] as unknown[],
  mine: [] as unknown[],
  item: null as unknown,
  photos: [] as unknown[],
  questions: [] as unknown[],
  agreed: false,
  card: null as unknown,
  /** "Keep it up until it sells" (owner 2026-10-29): the draft's saved switch. */
  keepUp: false as boolean | "not_deployed",
};

// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
// Q2427: no bundle discount here (its own tests: declutterTradeViews, declutterBundleDiscount.test.ts).
// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/declutter/movingSale", async (orig) => ({ ...(await orig<object>()), fetchItemInMovingSale: async () => false }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null,
  // The item page's places read (ItemHandoverTimes): none saved, so the usual times are the pickup times. Unmocked, it
  // went to the network and the file ran for 10+ minutes.
  fetchItemPickupPlaces: async () => [] }));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => null,
  fetchBundlePreview: async () => 0,
}));
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
// Audit 1028 D1-8: My listings listens for new notices (the shared realtime bus); no socket in a unit test.
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
// The whole hook shape: Sell it for me (on Selling and Sell an item) reads explain + gatedProps too.
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge, explain: () => {}, gatedProps: () => ({}) }) }));
// A1-B2: the Buy now label reads the setup fee still owed; an account that paid it (the fee's own cases live in
// declutterYourOffer.test.tsx).
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => state.payoutBlock }));
// The server's answer to "may this member set up payouts" (payout_setup_hire_allowed_for_me):
// since 2026-10-27, true for a seller only once a paid order holds money for them.
const setupAllowed = { value: false };
vi.mock("@/hooks/usePayoutSetupHireAllowed", () => ({ usePayoutSetupHireAllowed: () => setupAllowed.value }));
vi.mock("@/hooks/useStripeConnectStatus", () => ({ useStripeConnectStatus: () => ({ payoutPrompt: { kind: "setup" }, refetchStatus: () => {} }) }));
// The Declutter payouts read (the payout prompt counts the money that waits): none sent yet.
vi.mock("@/lib/declutter/handover", async (orig) => ({ ...(await orig<object>()), fetchMyPayouts: async () => [],
  fetchItemPickupWindows: async () => state.itemWindows }));
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
// The sell form's "remember my setup" read (SellLastSetup.tsx; its own test is declutterSellLastSetup): no earlier listing.
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
// No remembered listing choices saved (owner 2026-10-30): the app's defaults; the save at Post goes nowhere.
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
// The porch weekday chips' read (SellPorchDays.tsx; its own test is sellPorchDays): none picked.
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => [],
  fetchMapPins: async () => new Map(),
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
  setHandovers: vi.fn(async (_id: string, ways: string[]) => ways),
  fetchItemHandovers: async () => state.itemHandovers,
  setDropPct: async (_id: string, pct: number) => pct,
  fetchItemDropState: async () => ({ sale_mode: "offers", last_price_drop_on: null, drop_pct: 5 }),
  fetchMyPickupWindows: async () => [],
  fetchKeepUp: async () => state.keepUp,
  setKeepUp: vi.fn(async (_id: string, on: boolean) => { state.keepUp = on; return on; }),
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  withdrawItem: async () => undefined,
  setWatch: async () => "watching",
  askQuestion: async () => "q",
  answerQuestion: async () => "a",
  fetchMyCard: async () => state.card,
  fetchMyActiveStrikes: async () => 0,
  fetchMyOffers: async () => [],
  fetchMyCart: async () => state.sellerCart,
  makeOffer: async () => "o",
  respondOffer: async () => "declined",
  buyNow: async () => "l",
  sellerCancelSale: async () => 1,
  fetchHasAgreedSales: async () => state.agreed,
  // List it (step 5): the attest/publish chain, recorded, never Supabase.
  setPickupWindows: vi.fn(async () => 1),
  attestItem: vi.fn(async () => undefined),
  requestAiCheck: vi.fn(async () => ({ checked: true, flagged: false })),
  requestAiCheckWithRetry: vi.fn(async () => ({ checked: true, flagged: false })),
  publishItem: vi.fn(async () => "live"),
}));
import * as api from "@/lib/declutter/api";

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { rememberAfterCard } from "@/lib/declutter/afterCard";
import { formProblem } from "./sellForm";
import { dollarsToCents } from "@/lib/declutter/money";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
// Q2428: no partner charity near and no donation receipts (the donate RPCs never reach prod from a test).
vi.mock("@/lib/declutter/donate", () => ({
  fetchDonationPartnersNear: vi.fn(async () => []),
  fetchMyDonations: vi.fn(async () => []),
  chooseDonation: vi.fn(async () => 0),
  donatePostJobPath: (p: string) => `${p}&donate=1`,
  oneDonationPartner: () => null,
}));

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

// The tabs and the agreed-sales view are lazy since train 13 (B74/B77): load their code once up front, so a cold CI
// shard's first findBy never times out on a chunk import instead of the screen (#3938, Vitest shards 2 and 6).
beforeAll(async () => {
  await import("./DeclutterTradeViews");
  await import("./DeclutterMineViews");
  await import("./DeclutterBrowseView");
}, 30_000);

describe("Declutter screens", () => {
  beforeEach(() => {
    state.feature = true;
    state.keepUp = false;
    state.itemWindows = null;
    state.itemHandovers = null;
    state.underAge = false;
    state.payoutBlock = null;
    state.sellerCart = [];
    state.mine = [];
    state.item = null;
    state.photos = [];
    state.questions = [];
    state.agreed = false;
    state.card = null;
    sessionStorage.clear();
    vi.mocked(api.attestItem).mockClear();
    vi.mocked(api.publishItem).mockClear();
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
    expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
  });

  it("My listings shows each status in plain words, incl. waiting for a review", async () => {
    state.mine = [ITEM, { ...ITEM, id: "i2", status: "draft", title: "Lamp" }];
    at("/declutter?view=mine", <DeclutterPage />);
    // One status line per row (owner 2026-10-28): the status first, then what happens next.
    expect(await screen.findByText("Being checked. We'll send you a notice when it's done.")).toBeInTheDocument();
    // Next-step line (owner 2026-11-01): a row that waits on the seller says "Next: …".
    // @mutate src/components/declutter/DeclutterHomeView.tsx |   if (move) return { who: "you", text: move }; |   if (move) return { who: "info", text: move };
    // @mutate src/components/declutter/DeclutterHomeView.tsx |   draft: "Finish it to sell it", |   draft: "Not listed yet",
    const draftLine = screen.getByText("Next: finish it to sell it");
    expect(draftLine.getAttribute("data-next-step")).toBe("you");
    expect(screen.getByText("Being checked. We'll send you a notice when it's done.").getAttribute("data-next-step")).toBe("them");
    // D4-12: every Selling row's actions name their item, so a list of rows is not "Preview, Manage, Preview, Manage".
    // @mutate src/components/declutter/DeclutterHomeView.tsx | aria-label={`Finish listing ${item.title}`} | aria-label="Finish listing"
    // @mutate src/components/declutter/DeclutterHomeView.tsx | aria-label={`Preview ${item.title}`} | aria-label="Preview"
    expect(screen.getByRole("button", { name: "Finish listing Lamp" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: `Preview ${ITEM.title}` }).length).toBeGreaterThan(0);
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
    expect(screen.queryByText(/^Set up payouts to get/)).toBeNull();
    // The form is usable: step 1's photo picker is there.
    expect(document.querySelector("[data-add-photos]")).not.toBeNull();
  });

  it("a seller owed money (a paid sale) whose payouts are not ready is prompted to set up, with the link", async () => {
    state.payoutBlock = "payouts_not_ready";
    setupAllowed.value = true;
    // Owner 2026-10-28: only Declutter money that really waits (a paid sale) brings the prompt, with its amount.
    state.sellerCart = [{ line_id: "l1", item_id: "i1", item_title: "Oak rocking chair", my_side: "seller", seller_id: "u1", price_cents: 3200,
      status: "paid", checkout_by: "2026-10-28", order_id: "o1", order_status: "paid", handover: "porch", premium_cents: null, total_cents: null, porch_ok: true }];
    try {
      at("/declutter/sell", <DeclutterSellPage />);
      expect(await screen.findByText("Set up payouts to get your $32.")).toBeInTheDocument();
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
    // Owner mockup 11-01 / A3-47: ONE pickup block, the way and the town once, the address note once at the end.
    await waitFor(() => expect(document.querySelector("[data-pickup-way='porch'] p")?.textContent).toBe("Porch pickup · Mid-City, Baton Rouge"));
    expect(document.querySelector("[data-item-address-note]")?.textContent).toBe("Exact address after you pay");
    expect(screen.getByRole("button", { name: "Watch this item" })).toBeInTheDocument();
    // Owner 2026-10-19: the two actions show with no saved card (Marketplace / OfferUp / Mercari).
    const buyNow = await screen.findByRole("button", { name: "Buy now · $42.70 total" });
    // AUD31-15: the Questions hint has its own "Make an offer"; this is the panel's.
    expect(within(document.querySelector<HTMLElement>("[aria-label='Buy or make an offer']")!).getByRole("button", { name: "Make an offer" })).toBeInTheDocument();
    // LEAD-ITEM-PAGE-LAYOUT (owner 2026-10-31): no reassurance lines under the buttons.
    expect(screen.queryByText("You're only charged when you buy.")).toBeNull();
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
    // DA-18: the link's name is all a screen reader hears of the card, so the rating is said there, as a sentence.
    // @mutate src/components/declutter/DeclutterSellerCard.tsx | `See the ${noun}, ${name}${ratingWords}` | `See the ${noun}, ${name}`
    expect(document.querySelector("[data-seller-card]")?.getAttribute("aria-label")).toMatch(/, 4\.8 stars from 12 reviews$/);
  });

  // Deep audit #58: the seller's pickup times on the item page, before anyone buys.
  // @mutate src/components/declutter/ItemPickupBlock.tsx |   const usualLine = usual.data ? weekHoursLine(usual.data) : ""; |   const usualLine = "";
  it("the item page says when the seller is around: Pickup times: Mon–Fri 5–8 PM (#58)", async () => {
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    state.itemWindows = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts: "17:00:00", ends: "20:00:00" }));
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    await waitFor(() => expect(document.querySelector("[data-item-pickup-hours='porch']")?.textContent).toBe("Mon–Fri 5–8 PM"));
  });

  // Audit 1028 D1-2 (1a-b-offer-item-p1-1440): the seller ticked porch and a safe meeting spot, the page said porch only.
  // @mutate src/components/declutter/ItemPickupBlock.tsx | const ORDER: SellerHandover[] = ["porch", "meetup", "seller_delivery", "delivery"]; | const ORDER: SellerHandover[] = ["porch"];
  // @mutate src/components/declutter/ItemPickupBlock.tsx |   if (ticked?.includes("meetup")) { |   if (false) {
  it("the item page's Pickup lists every way the seller ticked, the safe meeting spot included (D1-2)", async () => {
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    // Owner mockup 11-01 / A3-47: one line per way, the town on the porch line only.
    const cases: [string[] | null, string[]][] = [
      [["porch", "meetup"], ["Porch pickup · Mid-City, Baton Rouge", "Meet at a safe spot"]],
      [["meetup", "seller_delivery", "delivery"], ["Meet at a safe spot", "Seller delivers", "Helpr delivery"]],
      // An older item with no ticks keeps its porch line.
      [null, ["Porch pickup · Mid-City, Baton Rouge"]],
    ];
    for (const [ways, want] of cases) {
      state.itemHandovers = ways;
      const { unmount } = at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
      await waitFor(() => expect([...document.querySelectorAll("[data-pickup-way] > p:first-child")].map((p) => p.textContent)).toEqual(want));
      unmount();
    }
    state.itemHandovers = null;
  });

  // Audit 1030 DB-4: an item the seller offers only by delivery still said "Pickup", "Pickup in ..." and "Pickup times",
  // and checkout then had no pickup. The block follows the ways the seller ticked; an older item keeps "Pickup".
  // Owner mockup 11-01: the block's first line names the ways (a delivery-only item never says pickup), the second the times.
  // @mutate src/components/declutter/ItemPickupBlock.tsx |   const heading = way === "none" ? "Delivery" : way === "meetup" ? "Meetup" : "Pickup"; |   const heading = "Pickup";
  // @mutate src/components/declutter/ItemPickupBlock.tsx |   const porch = ticked === null ? porchOk : ticked.includes("porch"); |   const porch = porchOk;
  // @mutate src/components/declutter/ItemPickupBlock.tsx |   const note = showAddressNote && rows.some((r) => r.way === "porch" \|\| r.way === "pickup_home") ? addressNote(free, isSeller) : ""; |   const note = showAddressNote ? addressNote(free, isSeller) : "";
  // @mutate src/components/declutter/ItemHandoverTimes.tsx |   if (!meetup) return { places, usual: !hasPlaces && ways === null ? "Pickup times" : null }; |   if (!meetup) return { places, usual: !hasPlaces ? "Pickup times" : null };
  it("DB-4: the item page says pickup only when the seller offers one", async () => {
    state.item = { ...ITEM, seller_id: "u2", status: "live" };
    state.itemWindows = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts: "17:00:00", ends: "20:00:00" }));
    // [ways, heading, the way lines, where the Mon–Fri hours show (or null)]
    const cases: [string[] | null, string, string[], string | null][] = [
      [["seller_delivery", "delivery"], "Delivery", ["Seller delivers", "Helpr delivery"], null],
      // Lead's call 2026-10-31: the usual times are the Meetup times (no pickup place saved in this world).
      [["meetup", "delivery"], "Meetup", ["Meet at a safe spot", "Helpr delivery"], "meetup"],
      // BUY-18: porch only is a whole DAY, so no hours; porch with a meeting spot keeps them, under the meetup line.
      [["porch"], "Pickup", ["Porch pickup · Mid-City, Baton Rouge"], null],
      [["porch", "meetup"], "Pickup", ["Porch pickup · Mid-City, Baton Rouge", "Meet at a safe spot"], "meetup"],
      [null, "Pickup", ["Porch pickup · Mid-City, Baton Rouge"], "porch"],
    ];
    for (const [ways, heading, lines, times] of cases) {
      state.itemHandovers = ways;
      const { unmount } = at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
      await waitFor(() => expect([...document.querySelectorAll("[data-pickup-way] > p:first-child")].map((p) => p.textContent)).toEqual(lines));
      expect(document.getElementById("declutter-pickup")?.textContent).toBe(heading);
      if (times) await waitFor(() => expect(document.querySelector(`[data-item-pickup-hours='${times}']`)?.textContent).toMatch(/^Mon–Fri 5–8 PM/));
      else {
        await new Promise((r) => setTimeout(r, 50));
        expect(document.body.textContent).not.toMatch(/Mon–Fri 5–8 PM/);
      }
      // A3-55: the address note only with a way to the seller's place, never under delivery alone.
      expect(!!document.querySelector("[data-item-address-note]"), String(ways)).toBe(lines.some((l) => l.startsWith("Porch pickup")));
      unmount();
    }
    state.itemHandovers = null;
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

    it("DA-11: the amount typed before Stripe's page is back in the box, saved or cancelled", async () => {
      state.item = { ...ITEM, id: ID, seller_id: "u2", status: "live" };
      state.card = { brand: "visa", last4: "4242" };
      rememberAfterCard(ID, "offer", undefined, "30");
      returnTo("/declutter?card=saved");
      expect(await screen.findByLabelText("Your offer")).toHaveValue("30");
      cleanup();
      state.card = null;
      rememberAfterCard(ID, "offer", undefined, "30");
      returnTo("/declutter?card=cancelled");
      expect(await screen.findByLabelText("Your offer")).toHaveValue("30");
      // Cancelled carries on with nothing: the amount waits for the member's own Send.
      expect(screen.queryByText("Checking for your card…")).toBeNull();
    });

    it("nothing remembered: stays on Declutter", async () => {
      returnTo("/declutter?card=saved");
      expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
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
    await screen.findByRole("button", { name: /^Finish listing/ });
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

  it("the tax confirmation is ONE shared Checkbox stating all four facts, and the ways buyers get it are shared Checkboxes, never native inputs", async () => {
    state.item = { ...ITEM, status: "draft" };
    state.photos = [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/1.jpg", position: 0 }];
    at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    await screen.findByRole("heading", { name: "Show it off" });
    for (let i = 0; i < 3; i++) fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    // Owner 2026-10-28: the seller ticks the ways; an older draft with porch on shows porch ticked. DC-4 (owner
    // 2026-10-29): Helpr delivery is never a tick (buyers can always choose it).
    const porch = await screen.findByRole("checkbox", { name: "Porch pickup" });
    expect(porch.tagName).toBe("BUTTON");
    expect(porch).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("checkbox", { name: "Helpr delivery" })).toBeNull();
    expect(screen.queryByText(/Pickup at your door/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("heading", { name: "Ready to list?" });
    // Owner 2026-10-28 "make these checks 1": exactly one box.
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(1);
    expect(boxes[0].tagName).toBe("BUTTON");
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    // All four facts stay on screen, as one list above the box (R.S. 47:305(A), LDR RR 15-001; owner 2026-10-30).
    const name = document.querySelector("[data-tax-statements] ul")?.textContent ?? "";
    for (const fact of [/own personal or household use/, /not in the business of selling items like this/, /occasional sale/, /keep the item until I hand it over/]) {
      expect(name).toMatch(fact);
    }
    // Untick: List it refuses and lists nothing; one tick lists, attesting all four.
    fireEvent.click(screen.getByRole("button", { name: "List it" }));
    await screen.findByRole("heading", { name: "Ready to list?" });
    expect(api.attestItem).not.toHaveBeenCalled();
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "List it" }));
    await waitFor(() => expect(api.attestItem).toHaveBeenCalledWith("i1"));
    await waitFor(() => expect(api.publishItem).toHaveBeenCalledWith("i1"));
  });

  // Owner 2026-10-28: "it also never said how long it will stay open"; decided the same day (Q2461 / #3728):
  // "30 days per round". The review step says the rule the server runs (the copy is bound to the migration
  // by src/test/declutterListingRounds.test.ts).
  // @mutate src/components/declutter/DeclutterSellView.tsx |             <ReviewRow title="How long it stays up" body={keepUp.on ? LISTING_LIFETIME_KEEP_UP : LISTING_LIFETIME} /> |
  it("the review step says how long the listing stays up, as the server runs it", async () => {
    state.item = { ...ITEM, status: "draft" };
    state.photos = [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/1.jpg", position: 0 }];
    at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    await toStep5();
    const row = document.querySelector('[data-review-row="How long it stays up"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toMatch(/30 days\. If it hasn't sold, it goes back up by itself up to 3 more times/);
    // Not editable: the seller has no length to choose.
    expect(row!.querySelector("button")).toBeNull();
  });

  // Owner 2026-10-29: "Keep it up until it sells" on the last step, saved on the draft; the "how long" row follows it.
  // @mutate src/components/declutter/DeclutterSellView.tsx |           <KeepUpSwitch keep={keepUp} as="div" | <KeepUpSwitch keep={{ ...keepUp, itemId: null }} as="div"
  // @mutate src/components/declutter/DeclutterSellView.tsx | body={keepUp.on ? LISTING_LIFETIME_KEEP_UP : LISTING_LIFETIME} | body={LISTING_LIFETIME}
  it("the last step offers Keep it up until it sells, and the stays-up row says what it means", async () => {
    state.item = { ...ITEM, status: "draft" };
    state.photos = [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/1.jpg", position: 0 }];
    at("/declutter/sell?item=i1", <DeclutterSellPage />, "/declutter/sell");
    await toStep5();
    const sw = await screen.findByRole("switch", { name: "Keep it up until it sells" });
    expect(screen.getByText("It renews every 30 days until someone buys it. You can turn this off anytime.")).toBeInTheDocument();
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sw);
    await waitFor(() => expect(api.setKeepUp).toHaveBeenCalledWith("i1", true));
    await waitFor(() => expect(document.querySelector('[data-review-row="How long it stays up"]')!.textContent).toMatch(/Until it sells\. It renews every 30 days by itself, with no reminders\./));
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
  const ok = { title: "Oak chair", description: "", category: "furniture", conditionStars: 4, deliverySize: "large" as const, price: "40", floor: "20", drops: true, dropPct: 5, free: false, areaLabel: "Mid-City", pickupAddress: "1234 Example St, Baton Rouge" };
  it("accepts a complete form and converts dollars to cents", () => {
    expect(formProblem(ok)).toBeNull();
    // Q2419: a free item needs no price or lowest price.
    expect(formProblem({ ...ok, free: true, price: "", floor: "" })).toBeNull();
    expect(formProblem({ ...ok, price: "", floor: "" })).toMatch(/price/);
    expect(dollarsToCents("$1,250.50")).toBe(125050);
  });
  it("refuses a floor above the price, a street address as the area, and a missing name", () => {
    expect(formProblem({ ...ok, floor: "50" })).toMatch(/lowest price/);
    // Owner 2026-10-28: with drops on, the lowest price must be under the price and the step one of the choices;
    // with drops off no lowest price is asked at all.
    expect(formProblem({ ...ok, floor: "40" })).toMatch(/below your price/);
    expect(formProblem({ ...ok, dropPct: 7 })).toMatch(/how much the price drops/);
    expect(formProblem({ ...ok, drops: false, floor: "" })).toBeNull();
    expect(formProblem({ ...ok, drops: false, floor: "50" })).toBeNull();
    expect(formProblem({ ...ok, areaLabel: "1234 Example St" })).toMatch(/couldn't tell the city/);
    expect(formProblem({ ...ok, areaLabel: "70005 Metairie" })).toBeNull();
    expect(formProblem({ ...ok, title: "ab" })).toMatch(/name/);
  });
});
