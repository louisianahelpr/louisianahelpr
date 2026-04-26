/**
 * Native share sheet wrapper.
 *
 * - On iOS/Android (Capacitor native): uses the OS share sheet via @capacitor/share.
 * - On the web: falls back to navigator.share if available, else copies the URL.
 *
 * Always returns a boolean indicating whether *some* share/copy action succeeded
 * so callers can show a toast either way.
 */
import { toast } from "sonner";

const isNative =
  typeof window !== "undefined" &&
  (window as any).Capacitor?.isNativePlatform?.() === true;

export interface ShareOptions {
  title?: string;
  text?: string;
  url: string;
  /** Sheet title shown on Android share dialog. */
  dialogTitle?: string;
}

export async function nativeShare(opts: ShareOptions): Promise<boolean> {
  // Native: real OS share sheet
  if (isNative) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: opts.title,
        text: opts.text,
        url: opts.url,
        dialogTitle: opts.dialogTitle ?? opts.title,
      });
      return true;
    } catch (err: any) {
      // User canceling counts as a no-op, not an error
      const msg = String(err?.message ?? err ?? "");
      if (/cancel|abort/i.test(msg)) return false;
      // Fall through to web fallback if native plugin is unavailable
    }
  }

  // Web: try Web Share API first
  try {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      await (navigator as any).share({
        title: opts.title,
        text: opts.text,
        url: opts.url,
      });
      return true;
    }
  } catch {
    // user cancelled or share unavailable — fall through to clipboard
  }

  // Last resort: copy URL to clipboard
  try {
    await navigator.clipboard.writeText(opts.url);
    toast.success("Link copied!");
    return true;
  } catch {
    toast.error("Couldn't share — try copying the link manually.");
    return false;
  }
}
