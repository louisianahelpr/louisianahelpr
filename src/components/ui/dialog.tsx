import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Deeper parchment-tinted backdrop with saturate boost so the
      // dialog reads as a clear focal point. Heavier blur than the
      // previous version + warm tint replaces flat black/50.
      "fixed inset-0 z-50 backdrop-blur-[24px] backdrop-saturate-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    style={{
      backgroundColor: "hsla(38, 18%, 12%, 0.45)",
      WebkitBackdropFilter: "blur(24px) saturate(1.5)",
    }}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onOpenAutoFocus, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      // Nine dialogs pass `onOpenAutoFocus={(e) => e.preventDefault()}` to stop
      // Radix focusing their first Input, because on iOS that pops the keyboard
      // the instant the dialog opens. The intent is right; the raw
      // preventDefault was not. It left focus on the TRIGGER — outside the
      // dialog — so a screen reader never announced what had opened and Tab
      // walked the page BEHIND the modal. (Found by the overlay sweep on
      // SavedSearches, SecurityTab's change-email, and TwoFactorCard.)
      //
      // Park focus on the dialog container instead: no field is focused, so no
      // keyboard, but the dialog owns focus and Tab starts inside it. Radix's
      // FocusScope gives Content `tabIndex={-1}`, so it accepts focus. This
      // runs DURING the AUTOFOCUS_ON_MOUNT dispatch, before FocusScope reads
      // `defaultPrevented`, so our focus is the one that sticks.
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) {
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }
      }}
      className={cn(
        // WHY THE FOUR slide-* CLASSES ARE LOAD-BEARING (they are not decoration)
        //
        // tailwindcss-animate's `enter` keyframe writes a whole `transform`:
        //   translate3d(var(--tw-enter-translate-x,0), var(--tw-enter-translate-y,0), 0)
        //   scale3d(var(--tw-enter-scale,1), …)
        // Its `from` frame therefore REPLACES this element's own
        // `translate-x-[-50%] translate-y-[-50%]` centering for the duration of
        // the animation. Without the slide-* utilities those vars default to 0,
        // so the dialog opens with its top-left corner at the viewport centre —
        // pushed right by half its width and down by half its height, hanging
        // off the screen — and then swoops up-left into place as the keyframe
        // ends. At 375px that is a ~171px horizontal travel, and it reads
        // exactly as the owner described it: "when I open this it's big then
        // gets smaller", because the frames where it overhangs the edge look
        // oversized and the landing looks like a correction.
        //
        // `slide-in-from-left-1/2` sets --tw-enter-translate-x to -50% and
        // `slide-in-from-top-[48%]` sets --tw-enter-translate-y to -48%, so the
        // keyframe now runs (-50%, -48%) scale .95 → (-50%, -50%) scale 1: a
        // conventional grow-and-settle from just under, with a 2%-of-height
        // rise and NO positional jump. Resting geometry is unchanged. The
        // matching slide-out-* pair fixes the same inversion on close.
        "glass-modal fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg max-h-[88dvh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 p-5 sm:p-7 duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
        className,
      )}
      // Radix warns once per open when a Content has no `Description` and no
      // explicit `aria-describedby`. Every hero subtitle was removed app-wide
      // (2026-07-25 "one main title"), so that is now the normal case rather
      // than an oversight, and the warning would fire on every dialog in the
      // app. Declaring `undefined` is Radix's own documented way to say "this
      // dialog intentionally has no description" and silences it.
      //
      // `{...props}` comes AFTER, so a dialog that does supply its own
      // `aria-describedby` still wins.
      aria-describedby={undefined}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-3 top-3 w-11 h-11 p-0 box-border rounded-full btn-press flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

// `pr-10` reserves a lane for the close (X) button, which is absolutely
// positioned at right-4 top-4 (a 32px hit target starting 16px from the
// content edge). Without this reserve, a long left-aligned title runs under
// the X and collides with it — the exact defect this padding prevents.
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left pr-10", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-display italic font-bold leading-tight tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

/**
 * DialogHero — the ONE canonical popup header. Every dialog/sheet header
 * should render through this so the eyebrow → title → subtitle stack, its
 * type tokens, and its clearance from the X (close) button are identical
 * app-wide. Do NOT hand-roll a bespoke header stack in individual dialogs;
 * adopt this instead (it wraps DialogHeader, so the X-collision reserve
 * comes for free).
 *
 *   <DialogHero eyebrow="Editing your job" title={`"${title}"`} />
 *
 * The eyebrow is the small burnt-sienna uppercase serif label; the title is
 * the display-italic heading; the optional subtitle is a quiet supporting
 * line. `titleClassName`/`titleStyle` let a caller scale the title where a
 * long name needs it, without forking the structure.
 */
const DialogHero = ({
  title,
  className,
  titleClassName,
  titleStyle,
}: {
  // `eyebrow` and `subtitle` remain ACCEPTED but are not rendered — the
  // 2026-07-25 "one main title" decision: a popup header shows its title and
  // nothing stacked above or below it. Every call site has had the props
  // stripped; they are kept in the type so a stray usage is a no-op rather
  // than a build break, and so restoring either is a one-line change here
  // instead of an edit across ~40 files.
  //
  // Copy a SIGHTED user must read — fee, tax, or payout disclosure — belongs
  // in the dialog body. Four were relocated there rather than dropped:
  // TipDialog, ReviewForm's tip prompt, InstantPayoutDialog, W9CollectionDialog.
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  titleStyle?: React.CSSProperties;
  eyebrowClassName?: string;
  eyebrowStyle?: React.CSSProperties;
}) => (
  <DialogHeader className={cn("space-y-0 text-left", className)}>
    <DialogTitle
      className={cn("font-display italic font-bold leading-tight pt-2", titleClassName)}
      style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em", ...titleStyle }}
    >
      {title}
    </DialogTitle>
  </DialogHeader>
);
DialogHero.displayName = "DialogHero";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogHero,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
