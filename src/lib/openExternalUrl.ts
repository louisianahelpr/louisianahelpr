/**
 * Opening an off-app URL (Stripe Checkout, Connect onboarding, the Express
 * dashboard) from BOTH surfaces.
 *
 * THE BUG THIS EXISTS FOR (found in the native audit, 2026-08-25): every money
 * hand-off in the app did `window.location.href = data.url`. On the web that is
 * correct. Inside the iOS/Android Capacitor shell it is not: the WebView serves
 * the app from `capacitor://localhost`, so navigating it to an `https://` origin
 * is handed to the SYSTEM browser. Tapping "Buy" literally threw the user out of
 * the app into Safari, and Stripe's `success_url` points at the marketing site —
 * so after paying they landed on louisianahelpr.com in Safari, signed out, while
 * the app sat in the background none the wiser. The purchase still settled via
 * `stripe-webhook`, but the person who just paid us got no confirmation.
 *
 * `Browser.open()` presents SFSafariViewController *over* the app instead: the
 * app stays alive underneath, the sheet has a Done button, and dismissing it
 * fires `browserFinished` so the caller can refetch whatever the payment changed.
 *
 * Why a shared helper rather than a fix per call site: there are 14 of these and
 * they are the entire money surface (escrow, membership, tips, boosts, payouts,
 * IDV, background check, Pay It Forward). One of them drifting back to a raw
 * `window.location.href` silently breaks that flow on native only — which is
 * exactly the class of bug that survived to this audit.
 */
import { Browser } from "@capacitor/browser";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Send the user to an external URL, then run `onReturn` when they come back.
 *
 * Native: opens an in-app browser sheet. `onReturn` fires when the sheet is
 * dismissed — by the user tapping Done, or by us closing it.
 * Web: a normal navigation. `onReturn` never fires because the page is gone;
 * the return trip is the browser landing on `success_url`.
 *
 * Callers must therefore treat `onReturn` as "refetch, the state may have
 * changed", never as "the payment succeeded" — the webhook is the only source of
 * truth for that.
 */
export async function openExternalUrl(
  url: string,
  onReturn?: () => void,
): Promise<void> {
  if (!isNativePlatform) {
    window.location.href = url;
    return;
  }

  // Listener is registered BEFORE open() so a very fast dismiss can't land
  // between the two and leave the caller waiting for a callback that never comes.
  let handle: { remove: () => Promise<void> } | undefined;
  if (onReturn) {
    handle = await Browser.addListener("browserFinished", () => {
      void handle?.remove();
      onReturn();
    });
  }

  try {
    await Browser.open({ url, presentationStyle: "popover" });
  } catch (err) {
    // The sheet failed to present, so `browserFinished` will never fire and the
    // listener would leak for the life of the session. Drop it and rethrow so
    // the caller's own catch shows its error copy and clears its pending state.
    await handle?.remove();
    throw err;
  }
}
