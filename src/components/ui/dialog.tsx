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
      // Parchment-tinted backdrop. The 24px blur — not the tint — is what
      // separates the dialog from the page, so the tint only has to knock the
      // background back, not black it out.
      //
      // Was 45% of a near-black brown, which on the light parchment canvas
      // read as a heavy grey slab (owner, 2026-08-22: "i also dont like the
      // dark background"). Dropped to 26% and warmed toward the brand olive:
      // the page behind stays legibly Helpr-coloured instead of going muddy,
      // and the blur still does the focal work. Contrast against the white
      // .glass-modal surface is unaffected — the card is opaque enough that
      // its edge never depended on the scrim.
      "fixed inset-0 z-50 backdrop-blur-[24px] backdrop-saturate-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    style={{
      // Lightened a THIRD time 2026-08-30 (owner: "lighten background
      // again globally for this") — 14% still read as too dark on top of
      // the 24px blur. History: 45% (near-black) -> 26% -> 14% -> 8%.
      backgroundColor: "hsla(38, 22%, 22%, 0.08)",
      WebkitBackdropFilter: "blur(24px) saturate(1.5)",
    }}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Extra icon buttons (Share/Save/Report, etc.) rendered in the SAME
     * flex row as the close X, immediately to its left — not a second,
     * independently-positioned element the caller has to hand-offset to
     * line up beside it (owner, 2026-08-30: "it does not belong to the
     * component ... not pieced together" — JobDetailDialog used to render
     * its own icon row at a magic-number `right-[2.875rem]` so it wouldn't
     * collide with this button's own `right-3`, two siblings faking one
     * toolbar). Pass the icon buttons here instead; this component owns
     * the single row they all share.
     */
    topRightSlot?: React.ReactNode;
    /**
     * Shrinks the close X's tap target from the default 44px down to 32px,
     * matching `topRightSlot`'s own compact icons (owner, 2026-08-30:
     * "should be same size and spacing" — the X's 44px floor made it
     * visibly larger than the 32px Share/Save/Report buttons beside it in
     * the same row). Only affects THIS dialog instance — every other
     * dialog's X keeps the full 44px accessible target.
     */
    compactClose?: boolean;
  }
>(({ className, children, onOpenAutoFocus, topRightSlot, compactClose = false, ...props }, ref) => (
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
        // ANCHORED TO THE TOP, NOT VERTICALLY CENTRED.
        //
        // Matched verbatim to AlertDialogContent — change one, change both.
        //
        // CENTRED, and SHRINK-TO-FIT (owner, 2026-08-30: "center center and fit
        // contents"). Was top-anchored at `top-[7vh]` on a fixed
        // `w-[calc(100%-2rem)] max-w-lg`, so a short dialog sat high on the
        // screen in a slab sized for a paragraph. Now `left-1/2 top-1/2` with
        // `w-auto` + a max, so the box hugs its content.
        //
        // Centering rides the standalone `translate` property, NOT
        // `-translate-x-1/2`/`-translate-y-1/2`. tailwindcss-animate's
        // enter/exit keyframes WRITE `transform`, so transform-based centering
        // is clobbered mid-animation and the modal swoops in from off-centre.
        // That is why the old class list carried four `slide-*` classes — they
        // existed only to restate the centering inside the keyframes.
        // `translate` is a separate property the keyframes never touch, so the
        // slide pairs are gone and the animation is just zoom + fade.
        //
        // KNOWN TRADE-OFF, recorded so it is not rediscovered as a bug: a
        // vertically-centred box re-centres when its content grows, so a dialog
        // whose body arrives late (an image decoding, a lazy chunk, a fee query)
        // shifts up by half the added height. Top-anchoring was originally
        // chosen to avoid exactly that ("opens small then gets bigger"). The
        // owner asked for centred; if the jump becomes a problem the fix is to
        // reserve the content's height, not to re-anchor one shell and split
        // the two dialog primitives apart again.
        "glass-modal fixed left-1/2 top-1/2 [translate:-50%_-50%] z-50 grid w-auto max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[86vh] overflow-y-auto gap-3 p-4 sm:p-5 duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
      {/* ONE row, not two siblings faking one: `topRightSlot` (Share/Save/
          Report, when a caller passes them) and the close X share this same
          flex container instead of each being independently `absolute`-
          positioned with a magic-number offset tuned to not collide with
          the other. `top-2`, not `top-3` (owner, 2026-08-30: "move up so
          it's not so close to money") when a slot is present — that content
          usually sits directly above a price chip near the dialog's top
          edge, and the default offset crowded it. */}
      <div className={`absolute right-3 z-10 flex items-center gap-0.5 ${topRightSlot ? "top-2" : "top-3"}`}>
        {topRightSlot}
        {/* Bare X — no filled disc, border, or shadow, matching SheetContent's
            close and BackButton's bare chevron. `rounded-md` shapes the focus
            ring only; nothing is painted at rest.
            44x44 by default (the HIG tap-target floor) — `compactClose`
            shrinks it to 32x32 to match a `topRightSlot`'s own compact icons
            (owner, 2026-08-30: "the 4 icons do not follow the same rules and
            they need to" / "should be same size and spacing" — JobDetailDialog's
            Share/Save/Flag are `compact` 32px, so the X was the one
            inconsistent tile in that row). This is the shared close button
            for every dialog in the app, so the inline min-height/min-width
            override (needed to beat the global `button { min-height: 44px }`
            floor) applies everywhere; `compactClose` only opts a specific
            dialog instance INTO the smaller target, it never shrinks the
            floor for dialogs that don't pass it. */}
        <DialogPrimitive.Close
          // `group` + the icon's own hover transform match the small lift every
          // other chrome icon (Share/Save/Flag) gets on hover (owner,
          // 2026-08-30: "make x do the same globally") — applied here since
          // this X is the one shared by every dialog in the app.
          // `focus-visible:`, not `focus:` (owner, 2026-08-31: "there
          // shouldn't be a box around it when it's clicked") — plain
          // `focus:` fires the ring on every mouse click, not just keyboard
          // navigation. Matches the shared `Button` component's own
          // convention (button.tsx uses `focus-visible:` throughout).
          className="group w-8 p-0 box-border rounded-md btn-press flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
          style={compactClose ? { minHeight: "32px", minWidth: "32px" } : { minHeight: "44px", minWidth: "32px" }}
        >
          <X className="h-[18px] w-[18px] transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={2} />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>
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
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
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
const DialogHero = ({ title }: {
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
  // NO className / titleClassName / style escape hatches — same reason as
  // AlertDialogHero's. A popup header is ONE layout; if it changes, it changes
  // here, once, for all ~149 of them.
}) => (
  <DialogHeader className="space-y-0 text-left">
    <DialogTitle
      // TIGHTENED (owner, 2026-08-29): was `pt-2`, matched to AlertDialogHero
      // — see the note there. Change one, change both.
      className="font-display italic font-bold leading-tight"
      style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
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
