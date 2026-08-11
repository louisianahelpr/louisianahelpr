import { useState } from "react";
import { Share2 } from "lucide-react";
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
    /** When "accept_bids" the job has no posted price, so the share text
     *  says "Open to bids" instead of a dollar figure. */
    pricingMode?: string;
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
    const priceLabel =
      job.pricingMode === "accept_bids"
        ? "Open to bids"
        : `$${job.budget != null ? job.budget : "?"}`;
    const text = `${job.title} · ${priceLabel} · ${location}\n\nApply on Helpr:`;

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

      // 3. Clipboard fallback — paste-to-share.
      const clipText = `${text}\n${url}`;
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipText);
        toast.success("Link copied. Paste it anywhere.");
        return;
      }

      // 4. Last-ditch: no clipboard API. Toast the URL itself so the
      // user can long-press to copy from the notification.
      toast.message("Share this link", { description: url });
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
      // Anything else: clipboard fell over, OS bridge failed, etc.
      // Show a soft toast rather than a blank failure.
      toast.error("Couldn't share — try again");
    } finally {
      setSharing(false);
    }
  };

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={ariaLabel ?? "Share this job"}
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
        <Share2 className="w-4 h-4 motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:-translate-y-0.5" />
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
      aria-label={ariaLabel ?? "Share this job"}
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
          <Share2 className="w-4 h-4" />
          <span className="text-ds-11 leading-none font-medium">Share</span>
        </>
      ) : (
        <>
          <Share2 className="w-4 h-4 mr-1" /> Share
        </>
      )}
    </Button>
  );
}

export default ShareJobButton;
