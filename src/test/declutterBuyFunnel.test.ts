/**
 * H3 (Declutter buy audit 11-08, High): "We can't see where buyers drop off or why their payments fail." A first-party
 * funnel in our own table (migration 20261108203450), no third-party tracker, no card data, email or IP.
 *
 * Behaviour (real Postgres): src/test/pglite/declutterBuyFunnel.pglite.mjs (2026-11-08: 25 PASS, applied 3x; mutants
 * noserver 2, nocap 2, testcounted 1, nodecline 1, openread 1, otherorder 1 FAIL).
 *
 * This guard holds the wiring: every client step the server accepts is sent from exactly the place it describes, the
 * webhook records paid and payment_failed (with the decline code) without ever throwing, Stripe's cancel page comes
 * back marked, and the admin card reads the counts.
 *
 * @mutate src/lib/declutter/api.ts |   trackFunnel("buy_now_tap", { itemId }); // H3 (audit 11-08) |
 * @mutate src/lib/declutter/api.ts |   if (typeof data.url === "string") trackFunnel("checkout_opened" |   if (false) trackFunnel("checkout_opened"
 * @mutate src/lib/declutter/itemViews.ts |     trackFunnel("item_view", { itemId }); |
 * @mutate src/components/declutter/DeclutterPaySettling.tsx |   useEffect(() => { trackStripeReturn(location.search); }, [location.search]); |
 * @mutate supabase/functions/declutter-checkout/index.ts |       cancel_url: buildRedirectUrl("/declutter?view=cart&back=1", native), |       cancel_url: buildRedirectUrl("/declutter?view=cart", native),
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (answer.result === "paid") await recordDeclutterFunnel(ctx, "paid", orderId); |
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |     await recordDeclutterFunnel(ctx, "payment_failed", pi.metadata?.order_id, err?.code ?? null, err?.decline_code ?? null); |     await recordDeclutterFunnel(ctx, "payment_failed", pi.metadata?.order_id, null, null);
 * @mutate src/lib/declutter/stripeReturn.ts |   if (seen.has(key)) return; |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const track = vi.fn();
vi.mock("@/lib/declutter/funnel", () => ({ trackFunnel: (...a: unknown[]) => track(...a) }));
import { trackStripeReturn } from "@/lib/declutter/stripeReturn";

const src = (p: string) => blankComments(readFileSync(p, "utf8"));
const MIG = blankSqlComments(readFileSync("supabase/migrations/20261108203450_declutter_buy_funnel_events.sql", "utf8"));

beforeEach(() => track.mockReset());

describe("H3: the Declutter buy funnel is wired end to end", () => {
  it("the client steps the server accepts are exactly the client's FunnelStep", () => {
    const fn = /FUNCTION public\.declutter_funnel_event[\s\S]*?p_step NOT IN \(([^)]*)\)/.exec(MIG)?.[1] ?? "";
    const server = [...fn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const type = /export type FunnelStep = ([^;]+);/.exec(src("src/lib/declutter/funnel.ts"))?.[1] ?? "";
    const client = [...type.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(server.length).toBe(4);
    expect(client).toEqual(server);
  });

  it("each step is sent from the place it describes", () => {
    const api = src("src/lib/declutter/api.ts");
    expect(api).toMatch(/export async function buyNow\(itemId: string, seenPriceCents: number\): Promise<string> \{\s*trackFunnel\("buy_now_tap", \{ itemId \}\);/);
    expect(api).toContain('if (typeof data.url === "string") trackFunnel("checkout_opened", { orderId: typeof data.order_id === "string" ? data.order_id : null });');
    expect(src("src/lib/declutter/itemViews.ts")).toMatch(/sent\.add\(key\);\s*void sendItemView\(itemId, signedIn\);\s*trackFunnel\("item_view", \{ itemId \}\);/);
    expect(src("src/components/declutter/DeclutterPaySettling.tsx")).toContain("useEffect(() => { trackStripeReturn(location.search); }, [location.search]);");
    expect(src("src/components/declutter/DeclutterTradeViews.tsx")).toContain('trackFunnel("returned_from_stripe", { detail: "back" })');
  });

  it("Stripe's pages come back marked: paid=1&order on success, back=1 on cancel", () => {
    const checkout = src("supabase/functions/declutter-checkout/index.ts");
    expect(checkout).toContain('success_url: buildRedirectUrl(`/declutter?view=cart&paid=1&order=${order.order_id}`, native),');
    expect(checkout).toContain('cancel_url: buildRedirectUrl("/declutter?view=cart&back=1", native),');
  });

  it("a return is recorded once per page session, with its order when paid", () => {
    trackStripeReturn("?view=cart&paid=1&order=o-1");
    trackStripeReturn("?view=cart&paid=1&order=o-1");
    trackStripeReturn("?view=cart&back=1");
    trackStripeReturn("?view=cart");
    expect(track.mock.calls).toEqual([
      ["returned_from_stripe", { orderId: "o-1", detail: "paid" }],
      ["returned_from_stripe", { orderId: null, detail: "back" }],
    ]);
  });

  it("the webhook records paid and payment_failed (with Stripe's decline code) and never throws for it", () => {
    const paid = src("supabase/functions/stripe-webhook/handlers/declutterCheckout.ts");
    expect(paid).toContain('if (answer.result === "paid") await recordDeclutterFunnel(ctx, "paid", orderId);');
    const failed = src("supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts");
    expect(failed).toMatch(/if \(pi\.metadata\?\.kind === "declutter_order"\) \{[\s\S]{0,300}recordDeclutterFunnel\(ctx, "payment_failed", pi\.metadata\?\.order_id, err\?\.code \?\? null, err\?\.decline_code \?\? null\);\s*return;/);
    const helper = src("supabase/functions/stripe-webhook/handlers/_declutterFunnel.ts");
    expect(helper).toMatch(/try \{[\s\S]*declutter_funnel_server_event[\s\S]*\} catch \(e\) \{\s*ctx\.logStep\(/);
    expect(helper).not.toMatch(/\bthrow\b/);
  });

  it("nothing personal is sent or stored: no email, IP, card or name", () => {
    const sent = src("src/lib/declutter/funnel.ts");
    expect(sent).not.toMatch(/email|\bip\b|card|full_name|navigator\.userAgent|document\.referrer/i);
    const table = /CREATE TABLE IF NOT EXISTS public\.declutter_funnel_events \(([\s\S]*?)\n\);/.exec(MIG)?.[1] ?? "";
    expect(table.length).toBeGreaterThan(100);
    expect(table).not.toMatch(/email|\bip\b|card|name|address|user_agent/i);
  });

  it("the admin card reads the 7-day counts", () => {
    const card = src("src/components/admin/settings/DeclutterFunnelCard.tsx");
    expect(card).toContain('supabase.rpc("declutter_funnel_counts", { p_days: 7 })');
    expect(src("src/components/admin/settings/FeatureSwitchesCard.tsx")).toContain("<DeclutterFunnelCard />");
  });
});
