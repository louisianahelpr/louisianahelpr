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
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "glass-modal fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg max-h-[88dvh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 p-5 sm:p-7 duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
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
  subtitle,
  className,
  titleClassName,
  titleStyle,
}: {
  // `eyebrow`/`eyebrowClassName`/`eyebrowStyle` remain in the type for
  // call-site compatibility but are intentionally not rendered — see the
  // 2026-07-25 app-wide eyebrow-removal decision. Kept as accepted props so
  // the many existing <DialogHero eyebrow="…"> call sites don't have to churn
  // and the label is a one-line restore if ever wanted.
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
    {subtitle && (
      <p
        className="font-serif italic leading-relaxed pt-1.5"
        style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.85)" }}
      >
        {subtitle}
      </p>
    )}
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
