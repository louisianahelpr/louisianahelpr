import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useMotionValue, useDragControls, type PanInfo } from "framer-motion";
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
          //
          // `max-w-md mx-auto rounded-t-2xl` is the SHARED bottom-sheet shell
          // and lives here, not at the call sites. Twelve sheets used to
          // hand-carry these two tokens and five had lost one or both: two
          // rendered square-cornered next to ten rounded ones, and eight
          // stretched the full desktop width (a two-button action list
          // becoming a 1400px band with a 13px label adrift in the middle).
          // A caller that genuinely needs a different width/radius still wins
          // via tailwind-merge — but it now has to say so on purpose.
          // md+ : STOP being a bottom sheet. A sheet glued to the bottom edge
          // is a phone idiom — on a desktop window it read as a 448px panel
          // stuck to the floor under a full-screen dim, with the content it
          // filters scrolled away above it. From md up it centres instead and
          // rounds all four corners, i.e. it becomes the dialog it already
          // behaves like. Vertical centring is done with `inset-y-0 + h-fit +
          // my-auto` rather than a translate, because Radix animates the
          // slide-in with a transform and a second transform would fight it.
          "inset-x-0 bottom-0 max-w-md mx-auto border-t rounded-t-2xl pb-[calc(1.5rem_+_var(--safe-area-bottom,0px))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom md:top-0 md:h-fit md:my-auto md:rounded-2xl md:border md:pb-6",
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
        : "calc(var(--safe-area-top, 0px) + 1rem)";
    const closeRight = "calc(var(--safe-area-right, 0px) + 1rem)";

    // A hidden Radix Close lets us commit the dismiss using Radix's own
    // close path (focus restore, onOpenChange) without threading the
    // controlling setter down into this primitive.
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const y = useMotionValue(0);
    // Drag-to-dismiss must NOT own the whole sheet: framer's drag listener
    // sets `touch-action: none` on its element, which on iOS swallowed every
    // upward swipe before the inner `overflow-y-auto` could scroll — a tall
    // sheet (Filters) was simply unscrollable in the app while desktop kept
    // working via wheel events. The drag now starts only from the grab-handle
    // strip at the sheet's top; everywhere else the finger scrolls content.
    const dragControls = useDragControls();

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
        {/* aria-describedby={undefined}: Radix warns once per open when a
            Content has no `Description` and no explicit `aria-describedby`.
            Every hero subtitle was removed app-wide (2026-07-25 "one main
            title"), so that is the normal case now, not an oversight, and the
            warning would fire on every sheet. Declaring `undefined` is Radix's
            documented way to say "intentionally no description". `{...props}`
            comes after, so a caller supplying its own still wins. */}
        <SheetPrimitive.Content
          ref={ref}
          className={cn(sheetVariants({ side }), className)}
          aria-describedby={undefined}
          {...props}
        >
          {enableDragDismiss ? (
            <motion.div
              className="relative"
              // Only the downward direction pulls the sheet; an upward drag
              // is clamped to 0 so the sheet can't be flung off-screen up.
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.9 }}
              dragMomentum={false}
              onDragEnd={handleDragEnd}
              style={{ y }}
            >
              {/* The drag-dismiss capture strip — covers the grab-handle zone
                  every bottom sheet paints at its top. Stops short of the
                  right edge so it never sits over the close button. */}
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-8 z-10"
                style={{ touchAction: "none", right: "3.5rem" }}
                onPointerDown={(e) => dragControls.start(e)}
              />
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

/**
 * Bare close (X) shared by every sheet side.
 *
 * Deliberately a BARE glyph — no filled circle, border, backdrop-blur, or
 * shadow. It used to be a frosted-glass disc, which read as a heavy chrome
 * "chip" floating over the sheet on every bottom sheet in the app. The disc
 * existed to keep the glyph legible when it overlapped sheet content, but
 * every sheet paints its own opaque `bg-background`, so the glyph has a solid
 * ground already and the disc bought nothing but visual weight. Same reasoning
 * as `BackButton` (bare chevron, no chrome) and `DialogContent`'s close.
 *
 * The 40x40 box stays — that is the tap target (>= 44pt with the surrounding
 * p-6), independent of whether anything is painted behind the glyph.
 *
 * Media overlays (PhotoLightbox, VideoPreviewModal) keep their translucent
 * disc on purpose: those Xs sit on arbitrary user photos/video, where a bare
 * glyph can land on a matching-colour region and disappear.
 */
const SheetCloseButton = ({ top, right }: { top: string; right: string }) => (
  <SheetPrimitive.Close
    className="absolute inline-flex h-10 w-10 items-center justify-center rounded-md ring-offset-background transition-colors hover:opacity-70 active:scale-[0.94] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
    style={{
      top,
      right,
      // Theme-aware: `--olivewood` flips to near-white on dark, so the glyph
      // stays legible against the sheet's own background in both themes.
      color: "hsl(var(--olivewood))",
    }}
  >
    <X className="h-5 w-5" strokeWidth={2} />
    <span className="sr-only">Close</span>
  </SheetPrimitive.Close>
);

// `pr-12` reserves the lane the floating close (X) occupies — a 40x40 box
// inset 1rem from the right edge. `DialogHeader` has carried the equivalent
// `pr-10` since it was written, so ANY dialog header clears the X for free
// even when it's hand-rolled; the sheet side had no reserve at all, so a sheet
// that skipped `SheetHero` got zero protection and a long title ran straight
// under the glyph. This closes that asymmetry.
//
// A caller passing `px-*` still merges this away (tailwind-merge, same slot) —
// that is why `SheetHero` does NOT rely on it and owns its own inner lane.
const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left pr-12", className)} {...props} />
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
  // No weight in the base. `cn()` is tailwind-merge and `font-semibold` sits in
  // the same slot as a caller's `font-bold`, at equal specificity with the base
  // emitted later in the stylesheet — so `SheetHero`'s `font-bold` was losing
  // and every sheet title computed at 600 while every dialog title computed at
  // 700. Invisible today only because the app requests Bodoni Moda italic at a
  // single weight, so 600 resolves to the 700 face; the day a 600 face is added
  // to the font URL, every sheet title in the app goes lighter than every
  // dialog title. `DialogTitle` carries no weight of its own either.
  <SheetPrimitive.Title ref={ref} className={cn("text-lg text-foreground", className)} {...props} />
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
 *   <SheetHero eyebrow="Filters" title="Refine Your Search" subtitle="…" />
 */
const SheetHero = ({
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
  // The close-button lane lives on an INNER element, not on the merged outer
  // className. It used to be `cn("… pr-12", className)`, which put the reserve
  // in the same tailwind-merge slot as the caller's padding — so a perfectly
  // ordinary `className="px-1 pb-2"` silently DELETED it. Three of the eleven
  // adopters were passing exactly that, and on the dashboard's long-press sheet
  // (whose title is arbitrary user text) the title painted under the X. The
  // reserve is not a suggestion; a caller must not be able to merge it away.
  <SheetHeader className={cn("space-y-0 text-left pr-0", className)}>
    <div className="pr-12">
      <SheetTitle
        className={cn("font-display italic font-bold leading-tight pt-2", titleClassName)}
        style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em", ...titleStyle }}
      >
        {title}
      </SheetTitle>
    </div>
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
