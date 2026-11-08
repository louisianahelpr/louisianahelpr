/**
 * H3 (Declutter buy audit 11-08, High): first-party buy funnel events, so we can see where buyers drop off. Our own
 * table (declutter_funnel_events, migration 20261108203450), no third-party tracker. The client records four steps:
 * item_view, buy_now_tap, checkout_opened (Stripe's page was opened for an order), returned_from_stripe ('paid' or
 * 'back'); stripe-webhook records paid and payment_failed (with Stripe's decline code) on the server.
 *
 * What is sent: the step, the item or order id, a guest's random device id (viewerDevice.ts; ignored for a member, who
 * is counted by account on the server) and, on a return, 'paid' or 'back'. Never card data, an email or an IP.
 * Fire-and-forget: it never throws and never blocks the page (the Supabase client is imported lazily).
 *
 * Guard: src/test/declutterBuyFunnel.test.ts.
 */
import { viewerDeviceId } from "@/lib/declutter/viewerDevice";

export type FunnelStep = "item_view" | "buy_now_tap" | "checkout_opened" | "returned_from_stripe";

export function trackFunnel(step: FunnelStep, opts: { itemId?: string | null; orderId?: string | null; detail?: "paid" | "back" } = {}): void {
  void (async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.rpc("declutter_funnel_event", {
        p_step: step,
        ...(opts.itemId ? { p_item_id: opts.itemId } : {}),
        ...(opts.orderId ? { p_order_id: opts.orderId } : {}),
        ...(opts.detail ? { p_detail: opts.detail } : {}),
        ...(() => { const d = viewerDeviceId(); return d ? { p_device_id: d } : {}; })(),
      });
    } catch {
      // fire-and-forget by design (H3 lead call 11-08): a lost funnel event costs the buyer nothing
    }
  })();
}
