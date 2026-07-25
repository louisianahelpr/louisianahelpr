import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useMotionValue, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import * as React from "react";

import { prefersReducedMotion } from "@/lib/accessibility";
import { hapticLight } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          // Pad the bottom past the iOS home indicator so a sheet's last
          // control isn't tucked under it. (calc spacing must use `_` —
          // Tailwind converts it to the whitespace CSS calc() requires.)
          "inset-x-0 bottom-0 border-t pb-[calc(1.5rem_+_env(safe-area-inset-bottom,0px))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

// Drag-to-dismiss tuning for bottom sheets — mirrors the iOS sheet "flick
// down to dismiss" gesture: commit on either enough distance or a fast
// enough downward flick, otherwise spring back to rest.
const SHEET_DISMISS_DISTANCE_PX = 120;
const SHEET_DISMISS_VELOCITY = 600;

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => {
    // For side="right" / "left" / "top" the sheet reaches the top of
    // the viewport so the close button needs to clear the iOS safe-area
    // inset (notch / Dynamic Island) — otherwise it ends up under the
    // status bar and effectively un-tappable. Bottom sheets start
    // mid-screen so safe-area-top is irrelevant; keep the close
    // anchored at a flat top-4 for those. Right side also bumps by
    // safe-area-right so landscape notches don't clip it either.
    const closeTop =
      side === "bottom"
        ? "1rem"
        : "calc(env(safe-area-inset-top, 0px) + 1rem)";
    const closeRight = "calc(env(safe-area-inset-right, 0px) + 1rem)";

    // A hidden Radix Close lets us commit the dismiss using Radix's own
    // close path (focus restore, onOpenChange) without threading the
    // controlling setter down into this primitive.
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const y = useMotionValue(0);

    const enableDragDismiss = side === "bottom" && !prefersReducedMotion();

    const handleDragEnd = (_e: unknown, info: PanInfo) => {
      const committed =
        info.offset.y > SHEET_DISMISS_DISTANCE_PX ||
        info.velocity.y > SHEET_DISMISS_VELOCITY;
      if (committed) {
        hapticLight();
        closeRef.current?.click();
        return;
      }
      // Released before threshold — snap back to rest.
      y.set(0);
    };

    return (
      <SheetPortal>
        <SheetOverlay />
        {/* Keep Radix's open/close slide animations on Content; the drag
            transform lives on an inner motion.div so the two don't fight
            over `transform` (Radix animates enter/exit, framer animates the
            live drag). */}
        <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
          {enableDragDismiss ? (
            <motion.div
              // Only the downward direction pulls the sheet; an upward drag
              // is clamped to 0 so the sheet can't be flung off-screen up.
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.9 }}
              dragMomentum={false}
              onDragEnd={handleDragEnd}
              style={{ y }}
            >
              {children}
              <SheetPrimitive.Close ref={closeRef} className="sr-only" aria-hidden tabIndex={-1} />
            </motion.div>
          ) : (
            children
          )}
          <SheetCloseButton top={closeTop} right={closeRight} />
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

/** Frosted-glass round close button shared by every sheet side. */
const SheetCloseButton = ({ top, right }: { top: string; right: string }) => (
  <SheetPrimitive.Close
    className="absolute inline-flex h-10 w-10 items-center justify-center rounded-full opacity-90 ring-offset-background transition-all hover:opacity-100 active:scale-[0.94] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
    style={{
      top,
      right,
      background: "hsla(0, 0%, 100%, 0.65)",
      border: "1px solid hsl(var(--olivewood) / 0.18)",
      color: "hsl(var(--olivewood))",
      backdropFilter: "blur(10px) saturate(150%)",
      WebkitBackdropFilter: "blur(10px) saturate(150%)",
      boxShadow:
        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
        "0 1px 2px hsl(var(--olivewood) / 0.06), " +
        "0 4px 10px -4px hsl(var(--olivewood) / 0.10)",
    }}
  >
    <X className="h-4 w-4" strokeWidth={2.25} />
    <span className="sr-only">Close</span>
  </SheetPrimitive.Close>
);

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

/**
 * SheetHero — the bottom/side-sheet twin of DialogHero. Sheets use the same
 * Radix dialog primitive but their own Title/Description components and a
 * floating round close button (SheetCloseButton) anchored top-right, so this
 * mirrors DialogHero's eyebrow → title → subtitle stack and type tokens
 * EXACTLY while reserving a `pr-12` lane so the title never collides with that
 * close button. Adopt this for any sheet that has a real titled header (filters,
 * NPS, notifications, mute, attach) so every titled sheet reads identical to
 * every dialog. (Tiny tap-a-row action menus intentionally keep their own
 * compact label — a full hero on a 2-button menu reads overbuilt.)
 *
 *   <SheetHero eyebrow="Filters" title="Refine your search" subtitle="…" />
 */
const SheetHero = ({
  title,
  subtitle,
  className,
  titleClassName,
  titleStyle,
}: {
  // `eyebrow`/`eyebrowClassName`/`eyebrowStyle` kept in the type for call-site
  // compatibility but intentionally not rendered — 2026-07-25 app-wide
  // eyebrow-removal decision (mirrors DialogHero).
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  titleStyle?: React.CSSProperties;
  eyebrowClassName?: string;
  eyebrowStyle?: React.CSSProperties;
}) => (
  <SheetHeader className={cn("space-y-0 text-left pr-12", className)}>
    <SheetTitle
      className={cn("font-display italic font-bold leading-tight pt-2", titleClassName)}
      style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em", ...titleStyle }}
    >
      {title}
    </SheetTitle>
    {subtitle && (
      <SheetDescription
        className="font-serif italic leading-relaxed pt-1.5"
        style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.85)" }}
      >
        {subtitle}
      </SheetDescription>
    )}
  </SheetHeader>
);
SheetHero.displayName = "SheetHero";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetHero,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
