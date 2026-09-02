import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  POPUP_FOOTER_ROW,
  POPUP_SECONDARY_CLS,
  POPUP_COMMIT_CLS,
} from "@/components/ui/popupFooter";

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
  }
>(({ className, children, onOpenAutoFocus, topRightSlot, ...props }, ref) => (
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
        // focus:outline-none (not focus-visible:) — this element is a Radix
        // FocusScope focus-parking target (tabIndex={-1} from onOpenAutoFocus
        // above), not a real keyboard-navigable widget. It never has a
        // meaningful "visible focus" state to preserve, so the browser's
        // default ring must be suppressed for every focus source, including
        // the mouse-click case where FocusScope re-parks focus here.
      // WIDTH: `w-auto` cannot be used with `left-1/2` on a fixed element.
      // A fixed box positioned at left:50% gets a shrink-to-fit available
      // width of (viewport − 187.5px) at 375, so `max-w-[calc(100%-2rem)]`
      // (343px) was unreachable and every dialog in the app rendered at
      // ~188–250px on a phone — measured 219px here, 58% of the screen with
      // 78px of dead margin each side, and long option labels bleeding
      // outside the card ("Inapprop… conte…"). The translate-based centring
      // from the 2026-08-30 "fit contents" change is what introduced it.
      //
      // Give it an explicit viewport-relative width on phones and keep
      // shrink-to-fit only from `sm` up, where there is room for it.
              // ONE MEASURE, NOT SHRINK-TO-FIT (2026-08-31).
      //
      // `sm:w-auto` made the card hug its content, which sounds tidy and is
      // the direct cause of the complaint it was meant to help with. Measured
      // in Chromium across the harness: at 1440 the same app rendered dialogs
      // at 285px, 297px, 384px, 435px, 494px and 512px — six different card
      // widths — because each one sized to whatever copy it happened to hold.
      // Two confirms opened one after another are visibly different objects,
      // and a multi-step dialog RESIZES between its own steps (the report
      // dialog measured 512 -> 327.5 -> 512 walking its three steps).
      //
      // `sm:w-full` + `sm:max-w-lg` pins every popup to the same 512px card
      // from `sm` up, and the phone rule is unchanged
      // (`w-[calc(100vw-2rem)]`, a 16px inset each side).
      //
      // This reverses the narrow reading of "center center and fit contents"
      // (owner, 2026-08-30) in favour of the instruction repeated five times
      // since ("all these need to share the same shell"). Content still
      // controls HEIGHT, which is what makes a short confirm feel short; only
      // the measure is shared. Change one primitive, change both.
        "glass-modal fixed left-1/2 top-1/2 [translate:-50%_-50%] z-50 grid w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:w-full sm:max-w-lg max-h-[86vh] overflow-y-auto gap-3 p-4 sm:p-5 duration-300 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
      {/* `topRightSlot` (Share/Save/Report, when a caller passes them) sits to
          the left of the close X in its own absolute container, while keeping
          the close X independently absolute (required — see next comment).

          THE OFFSET IS THE X'S OUTER EDGE PLUS THE GAP, and it must be
          recomputed whenever the X's box changes — it is a hand-computed
          magic number, which is precisely why it is spelled out here:
            default  right-1.5(6px)  + 44px + gap-0.5(2px) = 52px
            compact  right-3 (12px)  + 32px + gap-0.5(2px) = 46px
          (Both offsets resolve against the same padding box, so the 1px
          `.glass-modal` border shifts the X and this container together and
          the 2px gap survives it. Measured 2026-09-02: last icon to X box,
          exactly 2px, at all four breakpoints.)
          Getting this wrong does not look broken: the X's transparent hit
          area simply overlaps the last icon, and `elementFromPoint` on that
          icon returns the CLOSE BUTTON. The dialog then closes when the user
          meant to Share. Verified 2026-09-02 by elementFromPoint at all four
          corners of every icon in the row. */}
      {topRightSlot && (
        <div
          className="absolute right-[52px] top-2 z-10 flex items-center gap-0.5"
        >
          {topRightSlot}
        </div>
      )}
      {/* Bare X — no filled disc, border, or shadow, matching SheetContent's
          close and BackButton's bare chevron. `rounded-md` shapes the focus
          ring only; nothing is painted at rest.

          ── THE BOX IS 44x44. IT IS STATED, NOT DERIVED. ──────────────────
          This comment used to say "44x44 by default (the HIG tap-target
          floor)". It was wrong, and had been since the box was written: the
          class list carried `w-8` (32px) and the inline style carried
          `{ minHeight: "44px", minWidth: "32px" }`, so the rendered box
          measured 32 x 44 — under the HIG floor in WIDTH, on the one close
          button shared by all 55 `<DialogContent>` instances in the app.
          The claim read as a measurement and was a wish; nothing in the file
          could contradict it, because a `min-width` of 32 and a width of 32
          agree.

          So the size is now asserted OUTRIGHT — `width`/`height` in the
          inline style, no `w-*` utility, one source — rather than assembled
          from a utility plus two mins that have to be read together to know
          what they add up to. (`min-*` is kept alongside only to beat the
          global `button { min-height: 44px }` in index.css, which does NOT
          cover width: that rule's own selector list excludes `[role="radio"]`
          and has never had a width half, so "a global covers it" is not a
          thing that can be assumed here.)

          Growing from 32 to 44 is SYMMETRIC, so the glyph does not move: the
          box gains 6px on each side and `right` gives 6px back, 12px -> 6px.

          BUT DO NOT TRUST THAT ARITHMETIC, AND DO NOT TRUST THE `right-*`
          CLASS AS A DISTANCE. `right` resolves against the containing block's
          PADDING box, and `.glass-modal` carries a 1px border, so every one
          of these offsets is 1px further in than its class name reads: the
          old box sat 13..45 from the dialog's border edge (centre 29), and
          the new one sits 7..51 (centre 29). The class-name arithmetic says
          28 both times and is wrong both times — it happens to be wrong by
          the same 1px, which is the only reason the conclusion survives. This
          is the same trap that had a `Switch` measuring 41px under a comment
          claiming 45.

          So it is MEASURED, not derived. Playwright, at 320/375/768/1440,
          with a control element carrying the old `right-3 w-8` geometry
          rendered in the same stacking context: new box 44x44 (was 32x44),
          glyph centre identical to the control's to the pixel on both axes,
          in both the plain and the `topRightSlot` layouts.

          It does not reach the title either. `DialogHeader` reserves a
          `pr-10` (40px) lane inside the content box; measured clearance from
          the title's right edge to the X's box is 6px at `p-4` (<=640px) and
          10px at `sm:p-5`. (It was 12px / 16px before — the lane absorbs the
          change, it does not need widening. If the X grows again, this is the
          number that runs out first.)

          There is no opt-out. A `compactClose` prop used to shrink this to
          32x32 at `right-3`; it was removed on 2026-09-02 having never
          been passed by anything — its own doc comment recorded that.
          32x32 is below the 44x44 HIG floor, so the prop's only possible
          effect was to make the one control every dialog shares harder to hit.

          MUST BE `position: absolute` (not a flex child): the apply-dialog-fit
          e2e spec detects frame-chrome buttons via
          `getComputedStyle(btn).position === "absolute"` and exempts them from
          the content-box edge assertion — the X intentionally spans the padding
          gutter, so it needs that exemption. */}
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
        className={`absolute right-1.5 z-10 ${topRightSlot ? "top-2" : "top-3"} group p-0 box-border rounded-md btn-press flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none`}
        style={{ width: "44px", height: "44px", minWidth: "44px", minHeight: "44px" }}
      >
        <X className="h-[18px] w-[18px] transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={2} />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

// `pr-10` (40px) reserves a lane for the close (X) button. The numbers this
// comment used to quote — "right-4 top-4, a 32px hit target" — were never the
// ones in the code (the X is `top-3`, and its `right` offset has changed
// twice), which is how a stale reserve goes unnoticed: the lane is generous
// enough that a wrong premise still clears.
//
// The live geometry, MEASURED 2026-09-02 (Playwright, a 95-character title, at
// 320/375/768/1440): the X is 44x44 and its inner edge sits 51px from the
// dialog's border edge — `right-1.5` is 6px against the PADDING box plus
// `.glass-modal`'s 1px border, so 7 + 44, not 6 + 44. That leaves 34px into
// the content box at `p-4` and 30px at `sm:p-5`, and the 40px reserve clears
// the title by 6px / 10px respectively. Without the reserve a long
// left-aligned title runs under the X and collides with it — the defect this
// padding prevents. If the X's box changes again, re-measure; do not
// re-derive from the class names, which are each 1px optimistic.
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left pr-10", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

// THE SHARED ROW — see popupFooter.ts for the shape and why the owner chose
// it. Declared there, not here, because this exact layout also has to be
// AlertDialogFooter's and SheetFooter's; three literals kept in agreement by a
// test is how they drifted apart last time (SheetFooter was missing `gap-2`).
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(POPUP_FOOTER_ROW, className)} {...props} />
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


/**
 * ─── THE POPUP GRAMMAR ──────────────────────────────────────────────────────
 *
 * `DialogHero` unified the popup HEADER (2026-07-25) and every dialog in the
 * app adopted it. What it never covered is everything BELOW the title, and
 * that is what the owner is looking at now (2026-08-31, five screenshots side
 * by side): "Every single pop up like this needs to be styled the same.
 * Globally no excuses."
 *
 * The shell was already one shell — glass material, 512px measure, 28px
 * radius, serif title, bare X in the corner. The GRAMMAR inside it was not.
 * Measured across all 51 <DialogContent> blocks in `src/`:
 *
 *   BODY   24 dialogs spoke the house voice (serif italic) at SEVEN different
 *          sizes (ds-9 … ds-15); 21 spoke `text-ds-11 text-muted-foreground`
 *          (upright sans, grey) — including "Report No-Show", whose
 *          consequence list is the one a poster reads before ending someone's
 *          booking.
 *   FOOTER 5 dialogs, 5 different footers. The SECONDARY action alone shipped
 *          as a ghost (24x), an `outline` button (6x: Timeline's "Close",
 *          SavedSearches, CancelSurvey, CompletionPrompts x2, ReportDialog),
 *          and a bespoke inline-styled slab (CancellationDialog). The PRIMARY
 *          shipped as the glossy green, as `variant="destructive"` red, as a
 *          hand-rolled burnt-sienna button with `backgroundImage:"none"`
 *          explicitly switching the gloss OFF, and as nothing at all.
 *          Fourteen footer buttons carried a `className` — mostly
 *          `rounded-ds-md`, restating the radius `buttonVariants` already
 *          applies, which is how a no-op today becomes a divergence tomorrow.
 *
 * WHY THESE PARTICULAR RULES, AND NOT SOMEONE'S TASTE. Each one is the
 * treatment the app ALREADY applies to the largest number of popups — in
 * every case the confirm primitives, `AlertDialogContent` +
 * `BrandConfirmDialog`, which sit behind ~26 call sites (Log Out, Delete
 * Account, Decline This Job, Ban Permanently, every permission rationale).
 * That family was canonicalised first; this is the Dialog family being made
 * its twin, exactly as `AlertDialogHero` is `DialogHero`'s twin. Where the two
 * files state one value twice, the comment says "change one, change both" —
 * and `dialogShell.test.ts` fails if they drift.
 *
 *   HEADER  `<DialogHero title>` and NOTHING above it. No icon tile.
 *           PermissionRationaleDialog was the only popup in the app with one
 *           (a bespoke 56px tile above the Hero); it was removed earlier the
 *           same day because it pushed the title off the top row and left the
 *           X aligned to an icon instead of to a heading. So "no tile" is not
 *           a new rule — it is what 51 of 51 dialogs now do. If icons in popup
 *           headers are ever wanted they belong in the Hero, as one slot, used
 *           by all of them.
 *   BODY    `<DialogBody>` — serif italic, ds-12, olivewood/0.8. Byte-identical
 *           to the treatment `BrandConfirmDialog` gives every confirm's
 *           description, which is the single largest cohort of popups in the
 *           product. The 21 grey-sans bodies were never a decision: they are
 *           shadcn's `text-muted-foreground` default, copied dialog to dialog.
 *   FOOTER  `<DialogFooter>` holding at most one `<DialogSecondaryAction>` and
 *           at most one `<DialogPrimaryAction>` OR `<DialogDestructiveAction>`,
 *           DISMISS FIRST — small and hard-left, commit at the right end.
 *           Four shapes, no fifth. See popupFooter.ts for the full rationale.
 *
 * None of these primitives accepts `className`, `variant`, or `size` — same
 * reason DialogHero accepts no `titleClassName`: an escape hatch on a shared
 * popup primitive is how ~150 popups become 150 designs, and this is the third
 * time that has had to be undone.
 */

/**
 * DialogBody — the ONE body voice for popup prose.
 *
 * Renders a container, not a `<p>`, so a dialog whose body is a list (the
 * no-show consequences, the block-user effects) or two paragraphs inherits the
 * same font, size, colour and rhythm without restating them. Children are
 * plain `<p>` / `<ul className="list-disc pl-5 space-y-1">` — no type classes
 * of their own.
 *
 * NOT for field labels, data rows, or money tables: those are UI chrome, they
 * are already consistent, and setting them in editorial italic would be a
 * change nobody asked for. This is for the prose a dialog uses to explain
 * itself.
 *
 * The type token, colour and leading are AlertDialogDescription's, as applied
 * by BrandConfirmDialog — change one, change both.
 */
const DialogBody = ({ children }: { children: React.ReactNode }) => (
  <div
    className="font-serif italic text-ds-12 leading-relaxed space-y-2"
    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
  >
    {children}
  </div>
);
DialogBody.displayName = "DialogBody";

/**
 * DialogCallout — the sienna consequence box.
 *
 * BrandConfirmDialog's `callout` prop, lifted so the Dialog family can render
 * the identical object. JobConfirmation ("No-shows or last-minute
 * cancellations…") had already hand-built this exact box — same 8% sienna
 * fill, same ~22% sienna hairline, same AlertTriangle — one radius token and
 * one border width off. Two copies of one thing is how they drift; this is the
 * one.
 *
 * Reserved for a stated CONSEQUENCE. If every dialog gets a sienna box, the
 * sienna box stops meaning anything.
 */
const DialogCallout = ({ icon: Icon = AlertTriangle, children }: {
  icon?: LucideIcon;
  children: React.ReactNode;
}) => (
  <div
    className="my-2 rounded-ds-md p-3 text-ds-11 flex items-start gap-2"
    style={{
      background: "hsl(var(--burnt-sienna) / 0.08)",
      border: "1px solid hsl(var(--burnt-sienna) / 0.25)",
      color: "hsl(var(--burnt-sienna))",
    }}
  >
    <Icon className="w-4 h-4 shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);
DialogCallout.displayName = "DialogCallout";

/**
 * The three footer actions. A dialog's footer is built from these and nothing
 * else.
 *
 * Each is the Dialog-family twin of an AlertDialog primitive that already
 * exists and is already the app's most-used treatment:
 *
 *   DialogSecondaryAction    <- AlertDialogCancel  (ghost)
 *   DialogPrimaryAction      <- AlertDialogAction  (glossy `btn-grad-primary`)
 *   DialogDestructiveAction  <- AlertDialogAction variant="destructive"
 *
 * Their widths and alignment come from `popupFooter.ts`, which is also where
 * AlertDialogAction/Cancel and the Sheet footer get theirs — one contract, one
 * file, so a change to the footer cannot land on two of the three popup
 * families and miss the third.
 *
 * NO `className`, `variant`, `size` or `asChild`. They are omitted from the
 * prop type AND destructured off at runtime, so neither a `@ts-expect-error`
 * nor a plain-JS caller can reintroduce the `rounded-ds-md` restatements or
 * the inline-styled sienna slab these replaced.
 */
type DialogActionProps = Omit<
  ButtonProps,
  "variant" | "className" | "size" | "asChild" | "shimmer"
>;

const stripOverrides = (props: Record<string, unknown>) => {
  const { className: _c, variant: _v, size: _s, asChild: _a, shimmer: _sh, ...rest } = props;
  void _c; void _v; void _s; void _a; void _sh;
  return rest;
};

/**
 * The dismiss. Ghost, `size="sm"`, hard-left — the owner's choice, 2026-08-31:
 * "Small, I feel like left aligned makes more sense than right." 44px tall, so
 * still on the HIG tap-target floor while reading a clear step down from the
 * 56px commit beside it.
 */
const DialogSecondaryAction = React.forwardRef<HTMLButtonElement, DialogActionProps>(
  ({ children, ...props }, ref) => (
    <Button ref={ref} variant="ghost" size="sm" className={POPUP_SECONDARY_CLS} {...stripOverrides(props)}>
      {children}
    </Button>
  ),
);
DialogSecondaryAction.displayName = "DialogSecondaryAction";

/** The commit. Always the glossy green `btn-grad-primary` CTA. */
const DialogPrimaryAction = React.forwardRef<HTMLButtonElement, DialogActionProps>(
  ({ children, ...props }, ref) => (
    <Button ref={ref} variant="primary" className={POPUP_COMMIT_CLS} {...stripOverrides(props)}>
      {children}
    </Button>
  ),
);
DialogPrimaryAction.displayName = "DialogPrimaryAction";

/**
 * The commit, when it is irreversible or takes something away — solid
 * `--destructive` red, deliberately NOT glossy so it cannot be tapped by
 * muscle memory for the green one (button.tsx: "keep red flat-looking so it
 * doesn't get accidentally pressed").
 *
 * ONE destructive colour app-wide. `--burnt-sienna` is the brand ACCENT — it
 * paints eyebrows, callout borders, and things that are merely notable — so a
 * sienna commit button says "notable" in the same breath it says "permanent".
 * BrandConfirmDialog gave up its sienna tone for this reason; CancellationDialog's
 * hand-styled sienna button (`backgroundImage: "none"`, i.e. gloss explicitly
 * switched off) was the last one left.
 */
const DialogDestructiveAction = React.forwardRef<HTMLButtonElement, DialogActionProps>(
  ({ children, ...props }, ref) => (
    <Button ref={ref} variant="destructive" className={POPUP_COMMIT_CLS} {...stripOverrides(props)}>
      {children}
    </Button>
  ),
);
DialogDestructiveAction.displayName = "DialogDestructiveAction";

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
  DialogBody,
  DialogCallout,
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogDestructiveAction,
};
