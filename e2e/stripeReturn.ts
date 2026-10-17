import type { Page, Route } from "@playwright/test";

/**
 * Q1255, for the Stripe payers that are not journeys (prod-audit's funded
 * fixture, the gift-card spec's payWithTestCard, prod-lifecycle): answer the
 * navigation back off Stripe on `page` with an empty document, so the return
 * to create-payment's APP_URL (the DEPLOYED site) is never loaded from
 * Vercel. Install it BEFORE the Pay tap and `stop()` it after. The page URL
 * still changes to the return URL, so a caller's
 * `waitForURL(off checkout.stripe.com)` works unchanged; `returned()` is the
 * path + query Stripe sent the payer back to (empty until it does).
 *
 * Type-only imports, so a src/test that imports stripeCheckoutCard.ts does not
 * drag the Playwright runtime into the app tsconfig. The journeys' wrappers
 * (payInPageAnsweringReturn / payInChromium) live in
 * e2e/journeys/stripeInChromium.ts. Every Stripe payer in e2e/ and scripts/
 * goes through one of the three: src/test/stripeReturnNeverLoadsDeployedSite.test.ts.
 */
export async function answerStripeReturn(page: Page): Promise<{ returned: () => string; stop: () => Promise<void> }> {
  let returned = "";
  const handler = async (route: Route) => {
    const req = route.request();
    const host = new URL(req.url()).host;
    const stripe = /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(host);
    if (req.isNavigationRequest() && !req.frame().parentFrame() && !stripe) {
      const u = new URL(req.url());
      returned = `${u.pathname}${u.search}`;
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>returned</title>" });
      return;
    }
    // fallback, not continue: any other handler on this page or its context
    // (a request block, a meter) still sees the request. A request the page
    // abandoned mid-flight cannot be handled; that is the page's own choice.
    await route.fallback().catch(() => undefined);
  };
  await page.route("**/*", handler);
  return { returned: () => returned, stop: () => page.unroute("**/*", handler).catch(() => undefined) };
}
