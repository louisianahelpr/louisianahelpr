import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  POPUP_FOOTER_ROW,
  POPUP_SECONDARY_CLS,
  POPUP_COMMIT_CLS,
} from "@/components/ui/popupFooter";

const Sheet = SheetPrimitive.Root;



const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      // Identical to DialogOverlay. Sheets used `bg-black/80`, a near-opaque
      // black slab, while every Dialog used the parchment tint
      // + 24px blur that the owner lightened three times (45% -> 26% -> 14% ->
      // 8%). Two scrims meant a Sheet and a Dialog opened over the same page
      // looked like two different apps.
      "fixed inset-0 z-50 backdrop-blur-[24px] backdrop-saturate-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    style={{
      backgroundColor: "hsla(38, 22%, 22%, 0.08)",
      WebkitBackdropFilter: "blur(24px) saturate(1.5)",
    }}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  // `glass-modal` is THE shared popup surface (index.css) — 0.95 background,
  // 40px blur, 28px radius, one shadow. Its own comment says "every dialog
  // uses this class so every dialog gets the same card"; sheets were the
  // exception, painting an opaque `bg-background` with `p-6` and their own
  // `rounded-2xl`. Same padding ramp as DialogContent
  // (p-4 sm:p-5) so a sheet and a dialog are indistinguishable as surfaces.
  "glass-modal fixed z-50 gap-4 p-4 sm:p-5 transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 rounded-none border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          // CENTERED MODAL, at every width — not a bottom-anchored phone
          // sheet any more (owner, 2026-08-30, after reviewing centered
          // modal / inset slide-up / anchored-panel options side by side:
          // "lets do middle" for this group — Filters alone got the
          // anchored-panel treatment instead, see FilterSheet.tsx). This
          // used to be a true bottom sheet under `md`, centering only from
          // `md` up because a sheet glued to the bottom edge read as a
          // 448px panel stuck to the floor on a desktop window. That same
          // reasoning now applies at every width: `inset-y-0 + h-fit +
          // my-auto` centers vertically (not a translate, so Radix's own
          // fade/zoom transform on enter/exit doesn't fight a second
          // transform), rounds all four corners, and drops the bottom-edge
          // padding a floor-anchored sheet needed for iOS home-indicator
          // clearance — a centered card has no bottom edge to protect.
          "inset-x-0 inset-y-0 top-0 h-fit my-auto max-w-[calc(100%-2rem)] sm:max-w-lg mx-auto data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        left: "inset-y-0 left-0 h-full w-3/4 rounded-none border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 rounded-none border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
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

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => {
    // For side="right" / "left" / "top" the sheet reaches the top of
    // the viewport so the close button needs to clear the iOS safe-area
    // inset (notch / Dynamic Island) — otherwise it ends up under the
    // status bar and effectively un-tappable. `side="bottom"` is a
    // centered modal now (see sheetVariants), never touching the top
    // edge, so a flat top-4 is correct there too. Right side also bumps by
    // safe-area-right so landscape notches don't clip it either.
    const closeTop =
      side === "bottom"
        ? "1rem"
        : "calc(var(--safe-area-top, 0px) + 1rem)";
    const closeRight = "calc(var(--safe-area-right, 0px) + 1rem)";

    return (
      <SheetPortal>
        <SheetOverlay />
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
          {children}
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
 * Media overlays (PhotoLightbox) keep their translucent disc on purpose:
 * those Xs sit on arbitrary user photos, where a bare glyph can land on a
 * matching-colour region and disappear.
 */
const SheetCloseButton = ({ top, right }: { top: string; right: string }) => (
  <SheetPrimitive.Close
    // `focus-visible:`, NOT `focus:` — this was the only close button in the
    // app still on plain `focus:`, which fires the ring on every MOUSE CLICK,
    // not just keyboard navigation. The owner asked for exactly that ring to
    // stop appearing on click (2026-08-31); dialog.tsx and alert-dialog.tsx
    // were changed and this one was missed, so the behaviour he reported as
    // fixed still happened on every sheet.
    //
    // h-11 w-11 (44x44), matching DialogContent. It was
    // h-10 w-10 with a 20px glyph — a third size and a third glyph in a set of
    // three controls that do one job.
    className="absolute inline-flex h-11 w-11 items-center justify-center rounded-md ring-offset-background transition-colors hover:text-foreground active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
    style={{
      top,
      right,
      // Theme-aware: `--olivewood` flips to near-white on dark, so the glyph
      // stays legible against the sheet's own background in both themes.
      color: "hsl(var(--olivewood))",
    }}
  >
    <X className="h-[18px] w-[18px]" strokeWidth={2} />
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
  // `space-y-1.5` matches DialogHeader. `pr-12` (not its
  // `pr-10`) because the sheet close button is a larger floating disc.
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left pr-12", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // THE SHARED ROW, from popupFooter.ts. This was a third hand-written copy of
  // the layout string and had already lost `gap-2` from it once, so a sheet's
  // stacked buttons touched on a phone while a dialog's sat 8px apart. There
  // is now nothing to keep in sync.
  <div className={cn(POPUP_FOOTER_ROW, className)} {...props} />
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
}: {
  // TITLE ONLY. `eyebrow` and `subtitle` used to be ACCEPTED-BUT-DISCARDED, on
  // the reasoning that keeping them in the type made a stray usage "a no-op
  // rather than a build break". That is the wrong way round: a no-op is
  // SILENT. A caller could pass a subtitle, ship it, and never learn the line
  // had been thrown away — and the doc block above actively told them to,
  // worked example included. Eyebrows were deleted globally (owner,
  // 2026-09-02) and are not coming back, so the type now says so and a stray
  // usage is a compile error that names the file and line.
  //
  // Copy a SIGHTED user must read — fee, tax, or payout disclosure — belongs
  // in the dialog body. Four were relocated there rather than dropped:
  // TipDialog, ReviewForm's tip prompt, InstantPayoutDialog, W9CollectionDialog.
  title: React.ReactNode;
  // NO className / titleClassName / titleStyle / eyebrow* escape hatches.
  // DialogHero had these deleted (and `dialogShell.test.ts`
  // bans them coming back) precisely because they are how one popup ends up
  // looking unlike the rest — SheetHero simply never got the same treatment,
  // and three sheets were already using `className` to nudge their header
  // padding by a different amount each (`pl-1 pb-2`, `mb-4`, `pt-0`). A popup
  // header is ONE layout; if it changes, it changes here.
}) => (
  // The close-button lane lives on an INNER element, not on the merged outer
  // className. It used to be `cn("… pr-12", className)`, which put the reserve
  // in the same tailwind-merge slot as the caller's padding — so a perfectly
  // ordinary `className="px-1 pb-2"` silently DELETED it. Three of the eleven
  // adopters were passing exactly that, and on the dashboard's long-press sheet
  // (whose title is arbitrary user text) the title painted under the X. The
  // reserve is not a suggestion; a caller must not be able to merge it away.
  <SheetHeader className="space-y-0 text-left pr-0">
    <div className="pr-12">
      <SheetTitle
        // NO `pt-2`. DialogHero had that exact class
        // removed on 2026-08-29 ("the container's own padding already clears
        // the X") and SheetHero kept it, so every sheet title in the app sat
        // 8px lower in its card than every dialog title.
        className="font-display italic font-bold leading-tight"
        style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
      >
        {title}
      </SheetTitle>
    </div>
  </SheetHeader>
);
SheetHero.displayName = "SheetHero";


/**
 * The sheet's footer actions — DialogSecondaryAction / DialogPrimaryAction /
 * DialogDestructiveAction's twins, exactly as SheetHero is DialogHero's.
 *
 * A bottom sheet is a popup. The owner's 2026-08-31 instruction was "every
 * single pop up like this needs to be styled the same, globally, no excuses",
 * and the previous pass that unified popup HEADERS stopped at dialogs and left
 * sheets to hand-copy the stack — which is how they ended up with four
 * different title sizes. Sheets get the footer contract from the start this
 * time, rather than three call sites each writing `<Button variant="ghost">`
 * and drifting from there.
 *
 * Width, alignment and size come from `popupFooter.ts`; no `className`,
 * `variant` or `size` prop, for the same reason the Dialog twins have none.
 */
type SheetActionProps = Omit<
  ButtonProps,
  "variant" | "className" | "size" | "asChild" | "shimmer"
>;

const stripSheetOverrides = (props: Record<string, unknown>) => {
  const { className: _c, variant: _v, size: _s, asChild: _a, shimmer: _sh, ...rest } = props;
  void _c; void _v; void _s; void _a; void _sh;
  return rest;
};

const SheetSecondaryAction = React.forwardRef<HTMLButtonElement, SheetActionProps>(
  ({ children, ...props }, ref) => (
    // No `size="sm"`. The dismiss matches the commit's height (h-14, 56px)
    // rather than stepping down to 44 — in a ROW the WIDTH already carries the
    // hierarchy (a quarter against three quarters), so a shorter box reads as
    // mismatched rather than ranked. Dialog's dismiss lost `size="sm"` on
    // 2026-09-02 when the footer became a row; the Sheet's kept it, so a sheet
    // Cancel was 44px beside a 56px commit while every dialog's was 56 — the
    // third family drifting the moment the other two were fixed, which is the
    // exact failure mode that ended alert-dialog.tsx. Asserted for BOTH files
    // in dialogShell.test.ts now, not just dialog.tsx.
    <Button ref={ref} variant="ghost" className={POPUP_SECONDARY_CLS} {...stripSheetOverrides(props)}>
      {children}
    </Button>
  ),
);
SheetSecondaryAction.displayName = "SheetSecondaryAction";

const SheetPrimaryAction = React.forwardRef<HTMLButtonElement, SheetActionProps>(
  ({ children, ...props }, ref) => (
    <Button ref={ref} variant="primary" className={POPUP_COMMIT_CLS} {...stripSheetOverrides(props)}>
      {children}
    </Button>
  ),
);
SheetPrimaryAction.displayName = "SheetPrimaryAction";


export {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetTitle,
  SheetSecondaryAction,
  SheetPrimaryAction,
};
