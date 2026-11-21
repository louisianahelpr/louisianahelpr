/**
 * Owner 2026-11-21 ("when they click post a job or sell something should we let them post and sell and before it will be
 * submitted make them sign up so they can see how it's set up?" -> yes): a guest fills a Declutter listing before
 * signing up, the way a job post already works (guestPostDraftSurvivesSignup.test.tsx).
 *
 * The chain a guest walks, each link real code:
 *   /declutter/sell opens for a guest (App.tsx allowGuest; DeclutterSellPage lets only the one-item screen through)
 *   -> photos, title, price, size are kept on the device under GUEST_SELLER (useSellSaved -> deviceStore, IndexedDB,
 *   photos too) and nothing reaches the server: no early photo upload, no AI draft, no draft row
 *   -> "Sign up to post" opens SellGuestSignup -> "Create free account" (finishAsGuest: saved first, then
 *   /signup?redirect=/declutter/sell?resume=draft&reason=sell) -> Signup keeps the redirect (rememberSignupRedirect) and
 *   says the listing is kept -> after verification postAuthDestination spends it -> the member's sell screen takes over
 *   the guest's work (deviceStore.load) with every photo and opens at what Post still needs (the tax box).
 *
 * The store is an in-memory idb-keyval (jsdom has no IndexedDB), as in declutterSellSaved.test.tsx; every Declutter
 * API call and every Supabase client access is recorded, so "nothing reached the server" is measured, not assumed.
 *
 * @mutate src/components/declutter/useSellFlowState.ts | () => (!user ? null : itemId ? | () => (itemId ?
 * @mutate src/components/declutter/useSellFlowState.ts | (user?.id ?? (isGuest ? GUEST_SELLER : undefined)) | (user?.id)
 * @mutate src/lib/declutter/bunchSaved.ts | const claimed = saved.userId === GUEST_SELLER; | const claimed = false;
 * @mutate src/components/declutter/SellOneScreen.tsx |     if (s.isGuest) {\n      setTried(false);\n      setAskSignup(true); |     if (false) {\n      setTried(false);\n      setAskSignup(true);
 * @mutate src/components/declutter/SellOneScreen.tsx |   if (member && !s.attested) out.push |   if (!s.attested) out.push
 * @mutate src/lib/guestSellDraft.ts | export const GUEST_SELL_RESUME_PATH = "/declutter/sell?resume=draft"; | export const GUEST_SELL_RESUME_PATH = "/declutter/sell";
 * @mutate src/pages/declutter/DeclutterSellPage.tsx | if (isReady && !user && !guestCanSell(params)) { | if (false) {
 * @mutate src/App.tsx | <ProtectedRoute fullProfile allowGuest><DeclutterSellPage /></ProtectedRoute> | <ProtectedRoute fullProfile><DeclutterSellPage /></ProtectedRoute>
 * @mutate src/components/landing/HowItWorksSection.tsx | export const SELL_SIGNED_OUT = SELL_PATH; | export const SELL_SIGNED_OUT = "/signup?redirect=%2Fdeclutter%2Fsell";
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  calls: [] as string[],
  user: null as { id: string } | null,
}));

vi.mock("idb-keyval", () => ({
  get: async (k: string) => h.disk.get(k),
  set: async (k: string, v: unknown) => void h.disk.set(k, v),
  del: async (k: string) => void h.disk.delete(k),
  delMany: async (ks: string[]) => ks.forEach((k) => h.disk.delete(k)),
  keys: async () => [...h.disk.keys()],
  createStore: () => ({}),
}));
vi.mock("@/lib/declutter/photos", async (orig) => ({ ...(await orig<object>()), cleanListingPhoto: async (f: File) => f }));
// Signed out, every switch reads false (useFeature's contract); the guest gate reads Declutter as open to everyone.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => !!h.user, useFeatureStatus: () => ({ on: !!h.user, settled: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: new Set(["declutter"]), settled: true, failed: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: h.user, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: h.user, profile: h.user ? {} : null, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => ({ status: "idle" }), getCachedUserLocation: () => null, deriveFallbackLocation: async () => null }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => { h.calls.push("geocode"); return { latitude: 30.45, longitude: -91.15 }; } }));
// The member's first-sale address box (after sign-up) loads Apple Maps search; not wanted here.
vi.mock("@/hooks/useMapKitJs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMapKitJs")>()),
  useMapKitJs: () => "missing-token" as const,
}));
vi.mock("@/components/AppPage",() => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => { h.calls.push("fetchLastSetup"); return null; } }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => { h.calls.push("fetchSellerDefaults"); return null; }, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => { h.calls.push("fetchMyPorchPlaces"); return []; } }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
// Any use of the Supabase client at all is recorded (a guest's sell screen must not touch it).
vi.mock("@/integrations/supabase/client", () => {
  const deep = (path: string): unknown => new Proxy(() => {}, {
    get: (_t, k) => (k === "then" ? undefined : deep(`${path}.${String(k)}`)),
    apply: () => { h.calls.push(path); return deep(path); },
  });
  return { supabase: deep("supabase") };
});
vi.mock("@/lib/declutter/api", () => {
  const rec = <T,>(name: string, v: T) => async () => { h.calls.push(name); return v; };
  return {
    fetchItem: rec("fetchItem", null), fetchMyItemPrivate: rec("fetchMyItemPrivate", null), fetchMyPickupWindows: rec("fetchMyPickupWindows", []),
    fetchPhotos: rec("fetchPhotos", []), fetchHasAgreedSales: rec("fetchHasAgreedSales", false), fetchItemStatuses: rec("fetchItemStatuses", new Map()),
    photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
    createDraft: rec("createDraft", "new-id"), setDropPct: rec("setDropPct", 5), fetchItemDropState: rec("fetchItemDropState", null),
    updateDraft: rec("updateDraft", "ok"), setKeepUp: rec("setKeepUp", true), setHandovers: rec("setHandovers", []), fetchItemHandovers: rec("fetchItemHandovers", null),
    stageListingPhoto: rec("stageListingPhoto", "path"), dropStagedPhotos: rec("dropStagedPhotos", undefined), addPhotoSteadily: rec("addPhotoSteadily", "p"),
    removePhoto: rec("removePhoto", undefined), requestAiDraft: rec("requestAiDraft", {}), requestAiDraftFromPhotos: rec("requestAiDraftFromPhotos", {}),
    requestAiCheckWithRetry: rec("requestAiCheckWithRetry", null), setPickupWindows: rec("setPickupWindows", 1), attestItem: rec("attestItem", undefined),
    publishItem: rec("publishItem", "live"), setAutoFreeDays: rec("setAutoFreeDays", true), fetchKeepUp: rec("fetchKeepUp", null),
    fetchGuestSellerCard: rec("fetchGuestSellerCard", null), pickupsLabel: () => "",
  };
});

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { GUEST_SELLER, deviceStore, SELL_ONE_KEY } from "@/lib/declutter/bunchSaved";
import { GUEST_SELL_RESUME_PATH, guestCanSell, guestSellSignupUrl } from "@/lib/guestSellDraft";
import { wantsDraftResume } from "@/lib/guestPostDraft";
import { postAuthDestination, rememberSignupRedirect, signupSubtitle } from "@/lib/jobIntent";
import { safeStorage } from "@/lib/safeStorage";
import { enCore } from "@/lib/i18n/enCore";
import { SELL_PATH, SELL_SIGNED_OUT } from "@/components/landing/HowItWorksSection";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const Where = () => {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
};

function open(entry = "/declutter/sell") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (h.user) qc.setQueryData(featureSwitchBatchKey(h.user.id), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/declutter/sell" element={<DeclutterSellPage />} />
          <Route path="/signup" element={<Where />} />
          <Route path="/login" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const addPhotos = (...names: string[]) => fireEvent.change(document.getElementById("sell-files")!, { target: { files: names.map(jpg) } });
const rowValue = (field: string) => document.querySelector(`[data-summary-row="${field}"] [data-summary-value]`)?.textContent ?? null;
type Kept = { userId: string; photos: { key: string }[]; form: { title: string; price: string } };
const kept = () => h.disk.get(SELL_ONE_KEY) as Kept | undefined;

/** A guest fills the owner's fields (photos, title, price) and the size, and taps Sign up to post. */
async function guestFillsAndAsksToPost() {
  open();
  await screen.findByRole("heading", { name: "Show it off" });
  expect(screen.getByText(/Fill in the details yourself for now/)).toBeInTheDocument();
  addPhotos("a.jpg", "b.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Add title" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Oak rocking chair" } });
  fireEvent.click(screen.getByRole("button", { name: "Add price" }));
  fireEvent.change(document.getElementById("sell-price")!, { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Add size" }));
  fireEvent.click(screen.getByText("Small: fits in a car"));
  await waitFor(() => expect(kept()?.photos.length).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "Sign up to post" }));
  await screen.findByRole("heading", { name: "Create your free account to post" });
}

beforeEach(() => {
  h.disk.clear();
  h.calls.length = 0;
  h.user = null;
  safeStorage.removeItem("helpr.signupRedirect");
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("a guest's Declutter listing survives sign-up and email verification (owner 11-21)", () => {
  it("a guest fills the listing; it is kept on the device with its photos and nothing reaches the server", async () => {
    await guestFillsAndAsksToPost();
    expect(screen.getByText(/Your listing is saved on this device/)).toBeInTheDocument();
    // The step takes the button's place: one next step on screen.
    expect(screen.queryByRole("button", { name: "Sign up to post" })).toBeNull();
    // Asked after sign-up, not before: no tax box, no settings rows, no address box for a guest.
    expect(document.querySelector("[data-sell-tax]")).toBeNull();
    expect(document.querySelector("[data-selling-settings]")).toBeNull();
    expect(document.querySelector("[data-first-sale]")).toBeNull();
    const k = kept()!;
    expect(k.userId).toBe(GUEST_SELLER);
    expect(k.photos.length).toBe(2);
    expect(k.form.title).toBe("Oak rocking chair");
    expect(k.form.price).toBe("20");
    // Measured: not one Declutter API call (no photo upload, no AI draft, no draft row) and no Supabase client use.
    expect(h.calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Create free account" }));
    const where = await screen.findByTestId("where");
    expect(where.textContent).toBe(guestSellSignupUrl());
    expect(h.calls).toEqual([]);
  });

  it("sign-up carries the way back and says the listing is kept; the verified sign-up returns to it", () => {
    const url = new URL(guestSellSignupUrl(), "https://x.invalid");
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("redirect")).toBe(GUEST_SELL_RESUME_PATH);
    expect(signupSubtitle(url.searchParams.get("reason"), url.searchParams.get("redirect"))).toBe(enCore["signup.sellSubtitle"]);
    rememberSignupRedirect(url.searchParams.get("redirect"));
    const back = postAuthDestination("/home");
    expect(back).toBe("/declutter/sell?resume=draft");
    expect(wantsDraftResume(new URL(back, "https://x.invalid").searchParams)).toBe(true);
    expect(postAuthDestination("/home")).toBe("/home");
  });

  it("back signed in, the member takes over the guest's listing with every photo and it opens at Post", async () => {
    await guestFillsAndAsksToPost();
    cleanup();
    h.user = { id: "u-new" };
    open(GUEST_SELL_RESUME_PATH);
    expect(await screen.findByText("Your listing is here, ready to post.")).toBeInTheDocument();
    expect(document.querySelector("[data-photo-count]")?.textContent).toContain("2 of 12");
    expect(rowValue("title")).toBe("Oak rocking chair");
    expect(rowValue("price")).toBe("$20");
    // The statement made when posting is asked now, and the screen opens there (or at the first sale's Pickup box).
    expect(document.querySelector("[data-sell-tax]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Post it" })).toBeInTheDocument();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    const target = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1) as Element;
    expect(target.matches('[data-sell-row="pickup"], [data-sell-row="tax"]')).toBe(true);
    // Nothing was written for them yet: their own Post does that.
    for (const write of ["createDraft", "publishItem", "attestItem", "updateDraft"]) expect(h.calls).not.toContain(write);
    // The next save writes their id over the guest's.
    await waitFor(() => expect(kept()?.userId).toBe("u-new"));
  });

  it("a guest tapping Post before the listing is ready is told what is missing, and never asked for an address", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    fireEvent.click(screen.getByRole("button", { name: "Sign up to post" }));
    const marked = await screen.findAllByTestId("sell-form-problem");
    const rows = marked.map((m) => m.getAttribute("data-problem-at"));
    expect(rows).toContain("photos");
    expect(rows).not.toContain("settings");
    expect(rows).not.toContain("tax");
    expect(screen.queryByRole("heading", { name: "Create your free account to post" })).toBeNull();
  });

  it("only the one-item screen opens for a guest: Sell a bunch, the chooser, a saved draft and a Wanted answer ask to log in", async () => {
    for (const entry of ["/declutter/sell?mode=bunch", "/declutter/sell?mode=choose", "/declutter/sell?item=abc"]) {
      open(entry);
      expect((await screen.findByTestId("where")).textContent).toBe(`/login?redirect=${encodeURIComponent(entry)}`);
      cleanup();
    }
    expect(guestCanSell(new URLSearchParams("free=1"))).toBe(true);
    expect(guestCanSell(new URLSearchParams(""))).toBe(true);
    expect(guestCanSell(new URLSearchParams("answer=x"))).toBe(false);
  });

  it("control: another member's kept listing is still never handed to a different member", async () => {
    const store = deviceStore<{ userId: string; savedAt: number; photos: never[] }>(SELL_ONE_KEY);
    await store.saveMeta({ userId: "someone-else", savedAt: Date.now(), photos: [] });
    expect(await store.load("u-new")).toBeNull();
    await store.saveMeta({ userId: GUEST_SELLER, savedAt: Date.now(), photos: [] });
    expect((await store.load("u-new"))?.saved.userId).toBe(GUEST_SELLER);
  });

  it("guests can open Sell: the route lets them in and the landing's Sell link goes straight to the form", () => {
    const routes = read("src/App.tsx");
    expect(routes).toContain("<ProtectedRoute fullProfile allowGuest><DeclutterSellPage /></ProtectedRoute>");
    expect(SELL_SIGNED_OUT).toBe(SELL_PATH);
    // Inventory floor: the guest path names each server call it skips.
    const flow = read("src/components/declutter/useSellFlowState.ts");
    const skips = [/if \(!user \|\| urlItemId \|\| createdId/, /\(\) => \(!user \? null : itemId \?/, /if \(!user\) return;/].filter((re) => re.test(flow));
    expect(skips.length).toBeGreaterThan(2);
  });
});
