/**
 * Flow audit 11-23 (A2/A3): log in, password reset, Declutter save / offer / cart / checkout and Declutter posting
 * had NO analytics event, so a broken step read as a quiet one (how the 11-13 email sign-up break hid for 10 days).
 * Each step now sends one event from the place it happens, with a method, reason code or public item id only: never
 * an email, a password or an amount. The freshness monitor watches the outcomes (analyticsFreshness.test.ts holds the
 * emitted list equal to KEY_EVENTS + NOT_MONITORED).
 *
 * @mutate src/lib/loginTransport.ts |   else track(AhaEvent.LoginSucceeded, { method: "password" }); |
 * @mutate src/lib/loginTransport.ts |   if (msg.includes("invalid login credentials")) return "credentials"; |
 * @mutate src/lib/declutter/api.ts |   track(AhaEvent.DeclutterSaved, { item_id: itemId, on: watch }); // flow audit 11-23 (A2) |
 * @mutate src/lib/declutter/api.ts |   track(AhaEvent.DeclutterOfferSent, { item_id: itemId }); // flow audit 11-23 (A2) |
 * @mutate src/lib/declutter/api.ts |   track(AhaEvent.DeclutterCartAdded, { item_id: itemId, via: "buy_now" }); // flow audit 11-23 (A2): held into the cart |
 * @mutate src/lib/declutter/api.ts |   if (status === "live") track(AhaEvent.DeclutterPostLive, { item_id: itemId }); |
 * @mutate src/lib/declutter/stripeReturn.ts |   if (paid) track(AhaEvent.DeclutterCheckoutCompleted, { via: "stripe" }); // flow audit 11-23 (A2) |
 * @mutate src/lib/socialAuth.ts |   else if (r.kind === "redirecting") track(AhaEvent.LoginRedirectStarted, { method: provider }); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", async (orig) => ({ ...(await orig<typeof import("@/lib/analytics")>()), track: (...a: unknown[]) => track(...a) }));
vi.mock("@/lib/declutter/funnel", () => ({ trackFunnel: vi.fn() }));
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ offerPushAfterAction: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const auth = vi.hoisted(() => ({ signIn: vi.fn(), oauth: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      signInWithPassword: (...a: unknown[]) => auth.signIn(...a),
      signInWithOAuth: (...a: unknown[]) => auth.oauth(...a),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { AhaEvent } from "@/lib/analytics";
import { signInWithTimeout } from "@/lib/loginTransport";
import { buyNow, makeOffer, publishItem, setWatch } from "@/lib/declutter/api";
import { trackStripeReturn } from "@/lib/declutter/stripeReturn";
import { signInWithProvider } from "@/lib/socialAuth";

const EMAIL = "someone@example.com";
const sent = () => track.mock.calls.map(([e, p]) => [e, p ?? {}] as [string, Record<string, unknown>]);
const noPii = () => { for (const [, p] of sent()) expect(JSON.stringify(p)).not.toMatch(/@|example\.com|hunter2/); };

beforeEach(() => { track.mockReset(); rpc.mockReset(); auth.signIn.mockReset(); auth.oauth.mockReset(); });

describe("flow audit 11-23: every login / reset / Declutter step sends its event", () => {
  const NEW = ["login_succeeded", "login_failed", "password_reset_sent", "declutter_saved", "declutter_offer_sent", "declutter_cart_added", "declutter_checkout_completed", "declutter_post_live"];
  it("the events are declared", () => {
    const names = Object.values(AhaEvent) as string[];
    for (const n of NEW) expect(names, n).toContain(n);
    expect(NEW.length).toBeGreaterThan(7);
  });

  it("password log in: success, wrong password and offline each send one event with a reason code", async () => {
    auth.signIn.mockResolvedValueOnce({ data: { session: {} }, error: null });
    await signInWithTimeout(EMAIL, "hunter2", undefined);
    auth.signIn.mockResolvedValueOnce({ data: { session: null }, error: { message: "Invalid login credentials", name: "AuthApiError" } });
    await signInWithTimeout(EMAIL, "hunter2", undefined);
    auth.signIn.mockResolvedValueOnce({ data: { session: null }, error: Object.assign(new Error("Load failed"), { name: "AuthRetryableFetchError" }) });
    await signInWithTimeout(EMAIL, "hunter2", undefined);
    auth.signIn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(signInWithTimeout(EMAIL, "hunter2", undefined)).rejects.toThrow();
    expect(sent()).toEqual([
      ["login_succeeded", { method: "password" }],
      ["login_failed", { method: "password", reason: "credentials" }],
      ["login_failed", { method: "password", reason: "transport" }],
      ["login_failed", { method: "password", reason: "transport" }],
    ]);
    noPii();
  });

  it("web Google sign-in counts the redirect; an error counts a failure", async () => {
    auth.oauth.mockResolvedValueOnce({ error: null });
    await signInWithProvider("google");
    auth.oauth.mockResolvedValueOnce({ error: { message: "boom" } });
    await signInWithProvider("google");
    expect(sent()).toEqual([
      ["login_redirect_started", { method: "google" }],
      ["login_failed", { method: "google", reason: "provider_error" }],
    ]);
  });

  it("Declutter save, offer, Buy now and a live post each send their event", async () => {
    rpc.mockResolvedValue({ data: "x", error: null, status: 200 });
    await setWatch("item-1", true);
    await makeOffer("item-1", 500);
    await buyNow("item-1", 900);
    rpc.mockResolvedValue({ data: "live", error: null, status: 200 });
    await publishItem("item-2");
    expect(sent()).toEqual([
      ["declutter_saved", { item_id: "item-1", on: true }],
      ["declutter_offer_sent", { item_id: "item-1" }],
      ["declutter_cart_added", { item_id: "item-1", via: "buy_now" }],
      ["declutter_post_submitted", { item_id: "item-2" }],
      ["declutter_post_live", { item_id: "item-2" }],
    ]);
    noPii();
  });

  it("a refused save sends nothing (the event means it happened)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" }, status: 400 });
    await expect(setWatch("item-1", true)).rejects.toThrow();
    expect(sent()).toEqual([]);
  });

  it("a paid Stripe return counts one completed checkout; a back does not", () => {
    trackStripeReturn("?view=cart&paid=1&order=o-77");
    trackStripeReturn("?view=cart&paid=1&order=o-77");
    trackStripeReturn("?view=cart&back=1");
    expect(sent()).toEqual([["declutter_checkout_completed", { via: "stripe" }]]);
  });
});

// @mutate src/components/declutter/DeclutterGuest.tsx | onClick={() => track(AhaEvent.DeclutterGuestTap, { action: "offer" })} |
describe("a guest's Make offer / Buy now tap is counted before the sign-up wall (A2)", () => {
  it("DeclutterGuestJoin sends declutter_guest_tap with the action", async () => {
    const { render, fireEvent, cleanup } = await import("@testing-library/react");
    const { MemoryRouter } = await import("react-router-dom");
    const { DeclutterGuestJoin } = await import("@/components/declutter/DeclutterGuest");
    const { container } = render(<MemoryRouter initialEntries={["/declutter/item/abc"]}><DeclutterGuestJoin free={false} /></MemoryRouter>);
    fireEvent.click(container.querySelector("[data-guest-offer]")!);
    fireEvent.click(container.querySelector("[data-guest-buy]")!);
    expect(sent().filter(([e]) => e === "declutter_guest_tap")).toEqual([
      ["declutter_guest_tap", { action: "offer" }],
      ["declutter_guest_tap", { action: "buy" }],
    ]);
    cleanup();
  });
});
