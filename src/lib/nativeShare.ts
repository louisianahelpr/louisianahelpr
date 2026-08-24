import { toast } from "sonner";
import { isNativePlatform } from "@/lib/nativeInit";

export interface ShareContent {
  title?: string;
  text: string;
  url: string;
  /** Title shown on the native Android share chooser. */
  dialogTitle?: string;
  /** Combined text+url used for the clipboard fallback. */
  clipboardText?: string;
}

/**
 * Tiered share with a native-first chain so the affordance works on
 * every surface the app ships to:
 *
 *  1. Capacitor native (@capacitor/share) — the OS Share Sheet on
 *     iOS/Android (AirDrop, Messages, Mail, Instagram DM, …).
 *  2. Web Share API (navigator.share) — modern mobile browsers.
 *  3. Clipboard — copy the link + toast a hint.
 *  4. Last-ditch toast of the URL itself.
 *
 * User-cancellation of the sheet throws an AbortError on both the Web
 * Share API and the Capacitor bridge — that's a normal "no thanks," not
 * a failure, so it's swallowed silently.
 *
 * Dynamic import keeps the plugin chunk off the web critical-path bundle.
 */
export async function shareNative(content: ShareContent): Promise<void> {
  const { title, text, url, dialogTitle } = content;
  const clipboardText = content.clipboardText ?? `${text}\n${url}`;
  try {
    /* CALL navigator.share BEFORE ANY await — this is the whole bug.
       The web Share API is gated on user activation, and activation is
       consumed by the first await in the handler. This function used to open
       with `await import("@capacitor/core")` purely to ask which platform it
       was on, so by the time it reached `navigator.share` the browser no
       longer considered the click live and rejected with NotAllowedError. The
       catch below then tried the clipboard, which needs document focus and
       often fails too, and the tap read as doing nothing.

       `isNativePlatform` is a synchronous const from nativeInit, so the branch
       costs no await. The @capacitor/share import still happens lazily — but
       only on native, where the plugin bridge has no gesture requirement. */
    if (!isNativePlatform && typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text, url });
      return;
    }
    if (isNativePlatform) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, url, dialogTitle });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(clipboardText);
      return;
    }
  } catch (err) {
    const isCancel =
      err instanceof Error &&
      (err.name === "AbortError" || /cancel/i.test(err.message) || /dismiss/i.test(err.message));
    if (isCancel) return;
    // NotAllowedError is what a gesture-less or permission-blocked share
    // throws. It is NOT a cancellation, so it must not be swallowed — the
    // fallbacks below are what turn it back into something the user sees.
    // Fall back to clipboard before surfacing a hard failure.
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardText);
        return;
      }
    } catch {
      /* clipboard also unavailable — fall through to the error toast */
    }
    toast.error("Couldn't share — try again.");
  }
}
