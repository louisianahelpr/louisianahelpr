import { chromium, type Page } from "../prodTest";

/**
 * Pay a `cs_test_` Checkout Session in a throwaway Chromium and return the
 * path + query Stripe sent the payer back to.
 *
 * Why a second engine at all: see `payCheckoutSession` in ./fixtures.ts. The
 * app never renders Stripe inside its WKWebView, and Stripe's hosted page
 * errors in Playwright's WebKit on every journeys-webkit run measured.
 *
 * Stripe's own pages load normally. The navigation BACK off Stripe (to the
 * configured app URL, create-payment's buildRedirectUrl, i.e. the deployed
 * site) is answered here with an empty document and only its path is kept, so
 * nothing in this file reaches the deployed site or the backend; the caller
 * opens that path on this run's local build. Lives in its own module because
 * it answers a request itself (`route.fulfill`), and that answer is never a
 * Supabase one (src/test/e2eNoSupabaseMocks.test.ts reads per file).
 */
export async function payInChromium(checkoutUrl: string, pay: (page: Page) => Promise<void>): Promise<string> {
  if (!/\/cs_test_[A-Za-z0-9]+/.test(checkoutUrl)) {
    throw new Error(`refusing to pay ${checkoutUrl.slice(0, 80)}: not a cs_test_ session`);
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let returned = "";
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const host = new URL(req.url()).host;
      const stripe = /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(host);
      if (req.isNavigationRequest() && !req.frame().parentFrame() && !stripe) {
        const u = new URL(req.url());
        returned = `${u.pathname}${u.search}`;
        await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>returned</title>" });
        return;
      }
      // A request the page abandoned mid-flight (Stripe navigating away) cannot
      // be continued; that is the page's own choice, not a failure of the pay.
      await route.continue().catch(() => undefined);
    });
    const page = await ctx.newPage();
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
    await pay(page);
    if (!returned) throw new Error(`Stripe Checkout was paid but never navigated back (last url ${page.url().slice(0, 120)})`);
    return returned;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
