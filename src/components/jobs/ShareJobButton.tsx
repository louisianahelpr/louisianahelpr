import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";

interface ShareJobButtonProps {
  /** The job being shared — only the title/budget/category/id/city are referenced. */
  job: {
    id: string;
    title: string;
    budget?: number;
    category?: string;
    /** City string (no state suffix) shown in the share text. */
    city?: string;
  };
  /**
   * Optional className passthrough so the host action row can size and
   * tint the button consistently with its siblings (Edit/Cancel, Save,
   * etc.). Keep host styling outside the component so each mount can
   * match its row.
   */
  className?: string;
  /**
   * Render mode — defaults to a full pill-style button (label + icon)
   * suitable for the customer-side action row beside Edit / Cancel.
   * Use `"icon"` for icon-only mounts like the helper-side dialog
   * footer where the row is a sequence of equal-square icon buttons.
   */
  variant?: "default" | "icon";
  /**
   * Layout of the default (pill) variant. `"row"` keeps the icon and
   * "Share" label side-by-side (the standard full-width mount). `"stack"`
   * centers a small icon over a tiny label so the button fits a tight
   * multi-column action grid (e.g. the My Posts Boost/Edit/Share/Cancel
   * row at 375px). Ignored by the icon-only variant.
   */
  layout?: "row" | "stack";
  /** Optional aria-label override for the icon-only variant. */
  ariaLabel?: string;
  /**
   * Inline style passthrough for the default (pill) variant so a host
   * row can recolor the button (e.g. the muted-blue Share in the My
   * Posts action grid) without the component baking a single tint in.
   * Ignored by the icon-only variant, which owns its glass-chip look.
   */
  style?: React.CSSProperties;
}

/**
 * Share a job to whoever the user wants — neighbor, friend, social.
 *
 * Tiered fallback chain so the affordance still works on every surface
 * the app ships to:
 *
 *  1. **Capacitor native** — on iOS/Android, hand off to the OS Share
 *     Sheet via `@capacitor/share`. This gets us AirDrop, Messages,
 *     Mail, Instagram DM, etc., for free.
 *  2. **`navigator.share`** — modern Chrome/Safari implements the Web
 *     Share API which mimics the native sheet.
 *  3. **Clipboard fallback** — copy the URL and toast a hint. Works
 *     everywhere else (desktop Firefox, older browsers, embedded
 *     webviews without the API).
 *
 * User-cancellation of the OS sheet is normal — we silently ignore it
 * rather than toasting an error.
 *
 * WHY THE CONFIRMATION IS INLINE AND NOT A TOAST
 * ----------------------------------------------
 * The clipboard rung used to confirm with `toast.success("Link copied…")`.
 * `src/lib/toastPolicy.ts` neuters `toast.success` / `.info` / `.message`
 * app-wide at boot (owner decision: confirmations don't surface), so that call
 * was a guaranteed no-op: the URL landed on the clipboard and NOTHING on
 * screen changed. That is precisely the reported "share button does nothing" —
 * the share worked, the feedback didn't. The confirmation is therefore owned by
 * the button itself (icon + label flip to "Copied" for 2s, plus an sr-only live
 * region), which cannot be suppressed by the toast policy. `toast.error` is
 * still used for genuine failures — that channel is NOT neutered.
 *
 * The URL points at the public `/jobs/:id` preview route. Guests who tap
 * get a read-only job preview (apply gated to /signup); signed-in
 * recipients are redirected into the dashboard apply flow. See
 * `src/pages/JobDetail.tsx`.
 */
export function ShareJobButton({
  job,
  className,
  variant = "default",
  layout = "row",
  ariaLabel,
  style,
}: ShareJobButtonProps) {
  // Disable the button while a share is in flight so impatient
  // double-taps don't queue duplicate share sheets.
  const [sharing, setSharing] = useState(false);
  // Inline "Copied" confirmation for the clipboard rungs — see the note above
  // on why this cannot be a toast.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  /**
   * Will this device open a share sheet, or just copy?
   *
   * `navigator.share` does not exist in desktop Safari or in Chrome on macOS,
   * so on a computer the button ALWAYS falls through to the clipboard — and a
   * control labelled "Share" that answers with "Copied" reads as the wrong
   * thing having happened (owner: "I don't understand why it says copied when
   * it's clicked"). Nothing about the behaviour changes; the label just stops
   * promising a sheet the browser cannot open. Phones and the native app have
   * `navigator.share`, so they keep "Share" and the real sheet.
   *
   * Read once at mount rather than per render: it cannot change for the life
   * of the page, and calling it in render would make the label depend on
   * whether a re-render happened to run before hydration finished.
   */
  const [canNativeShare] = useState(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  const restLabel = canNativeShare ? "Share" : "Copy link";

  const confirmCopied = () => {
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  /**
   * Copy `text`, returning whether it actually landed.
   *
   * Two rungs: the async Clipboard API, then the legacy `execCommand("copy")`
   * off a detached textarea — still the only clipboard available in some
   * embedded WebViews and on insecure origins, where `navigator.clipboard` is
   * undefined. Returning a boolean (rather than throwing) is what lets the
   * caller tell "copied" from "could not copy" and show the right thing.
   */
  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof document === "undefined" || typeof document.execCommand !== "function") {
      return false;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Off-screen but still selectable. `display:none` would make the
    // selection — and therefore the copy — fail silently.
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  };

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    // Light haptic on press — confirms the tap on native, no-ops on web.
    void hapticLight();
    const location = job.city || "Louisiana";
    // Append ?ref=share so recipients who tap the link are attributed to
    // the share surface (OS Share Sheet / clipboard) when they open the job.
    const url = `https://www.louisianahelpr.com/jobs/${job.id}?ref=share`;
    const title = `${job.title} — Need help in ${location}`;
    // Every job now has a set budget — bidding (and its "Open to bids" share
    // wording) was removed after zero production usage.
    const priceLabel = `$${job.budget != null ? job.budget : "?"}`;
    const text = `${job.title} · ${priceLabel} · ${location}\n\nApply on Helpr:`;
    const clipText = `${text}\n${url}`;

    try {
      // 1. Native Share Sheet — only on actual iOS/Android shells.
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title, text, url, dialogTitle: "Share this job" });
        return;
      }

      // 2. Web Share API — modern browsers, often on mobile web.
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        return;
      }

      // 3. Clipboard fallback — paste-to-share, confirmed on the button.
      if (await copyToClipboard(clipText)) {
        confirmCopied();
        return;
      }

      // 4. No clipboard at all. Surface the URL through the one toast
      //    channel the policy leaves alive, so the tap is never a no-op.
      toast.error(`Couldn't copy automatically — the link is ${url}`, {
        duration: 10_000,
      });
    } catch (err) {
      // The user dismissing the share sheet throws an AbortError on
      // both the Web Share API and Capacitor's bridge. That's not an
      // error to surface — they decided not to share. Treat any
      // cancellation-shaped error as silent.
      const isCancel =
        err instanceof Error &&
        (err.name === "AbortError" ||
          /cancel/i.test(err.message) ||
          /dismiss/i.test(err.message));
      if (isCancel) return;
      // A real failure of the share sheet (OS bridge down, permission
      // refused, WebView without a share provider). Don't dead-end on an
      // error toast — the user asked to share a link and the clipboard can
      // still deliver one, so try that before admitting defeat.
      try {
        if (await copyToClipboard(clipText)) {
          confirmCopied();
          return;
        }
      } catch {
        /* clipboard unavailable too — fall through to the error below */
      }
      toast.error("Couldn't share — try again");
    } finally {
      setSharing(false);
    }
  };

  /** sr-only live region so the copy is announced, not just drawn. */
  const liveRegion = (
    <span className="sr-only" role="status" aria-live="polite">
      {copied ? "Link copied to clipboard" : ""}
    </span>
  );

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={
        copied
          ? "Link copied to clipboard"
          : (ariaLabel ?? (canNativeShare ? "Share this job" : "Copy a link to this job"))
      }
        disabled={sharing}
        onClick={handleShare}
        className={cn(
          "group glass-press rounded-full h-11 w-11 sm:h-12 sm:w-12 shrink-0 motion-safe:transition-all motion-safe:duration-200 motion-safe:hover:scale-105 motion-safe:active:scale-95",
          className,
        )}
        style={{
          backgroundColor: "hsla(0, 0%, 100%, 0.32)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          border: "0.5px solid hsla(0, 0%, 100%, 0.4)",
          color: "hsl(var(--olivewood) / 0.80)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04)",
          // Transition is handled by motion-safe:transition-all in className
        }}
      >
        {copied ? (
          <Check className="w-4 h-4" strokeWidth={2.5} />
        ) : (
          <Share2 className="w-4 h-4 motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:-translate-y-0.5" />
        )}
        {liveRegion}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      // The default variant pins its text to parchment-cream with
      // `!important`, which an inline `style.color` can't beat. When a host
      // recolors via `style`, drop to the ghost variant (no forced text) so
      // the override actually renders; the no-style mount keeps `default`.
      variant={style ? "ghost" : "default"}
      aria-label={copied ? "Link copied to clipboard" : (ariaLabel ?? "Share this job")}
      disabled={sharing}
      onClick={handleShare}
      style={style}
      className={cn(
        "border-0",
        // Default tint: neutral parchment-green via the bark token. When
        // the host passes an inline `style` (e.g. the muted-blue Share in
        // My Posts) the green is dropped so the override wins cleanly,
        // including on hover.
        !style && "bg-[hsl(var(--bark)/0.10)] text-[hsl(var(--bark))] hover:bg-[hsl(var(--bark)/0.20)]",
        className,
      )}
    >
      {layout === "stack" ? (
        <>
          {copied ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <Share2 className="w-4 h-4" />}
          {/* The flip is label→confirmation, and both stay short enough that
              the 4-up action grid does not reflow. */}
          <span className="text-ds-11 leading-none font-medium">
            {copied ? "Copied" : restLabel}
          </span>
        </>
      ) : (
        <>
          {copied ? (
            <Check className="w-4 h-4 mr-1" strokeWidth={2.5} />
          ) : (
            <Share2 className="w-4 h-4 mr-1" />
          )}
          {copied ? "Copied" : restLabel}
        </>
      )}
      {liveRegion}
    </Button>
  );
}

export default ShareJobButton;
