import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

// Positions a popover against an element that is NOT its trigger. Needed
// when the button and the panel live in different components and cannot be
// wrapped in one <Popover> subtree — pass the button's ref as `virtualRef`
// (a Radix Popper prop: RefObject<Measurable | null>). Purely additive; no
// existing popover changes behaviour.
const PopoverAnchor = PopoverPrimitive.Anchor;

// Exposed so a caller can portal a DISMISS LAYER into the same layer as the
// panel (see `PopoverDismissLayer`). `PopoverContent` opens its own portal
// internally, so a layer rendered as its sibling needs one of its own — and it
// must be a portal, not a bare `position: fixed` div, because these panels open
// inside <PageTransition>, whose framer-motion transform would otherwise become
// the fixed element's containing block and pin the layer to the page instead of
// the viewport.
const PopoverPortal = PopoverPrimitive.Portal;

/* NO ARROW RE-EXPORT. `PopoverPrimitive.Arrow` used to be re-exported here as
   `PopoverArrow` for the anchored panels' notch. Both panels are now bands
   pinned to the screen edges (owner, 2026-08-31: "it should be anchored to
   screen"), and a band that spans the viewport has nothing to point back at.
   Re-export it again only if a panel that genuinely floats over the page
   arrives; adding a notch to these two is a regression, not a feature. */

/**
 * THE dismiss layer for an anchored panel — a full-bleed sheet that PAINTS
 * NOTHING and exists only to catch the tap that closes the panel.
 *
 * IT IS NOT A SCRIM ANY MORE. It used to be one: warm 8% parchment tint over a
 * 24px blur, the same recipe as `DialogOverlay`/`SheetOverlay`, read from
 * `--scrim-tint` / `--scrim-blur`. The owner rejected that on device
 * (2026-08-31, on the Filters panel: "This blur is not correct it should be
 * anchored to screen remove the blur", and on Notifications: "Same for this.
 * No blur", then "Yes — both the same"). An anchored panel is now a
 * screen-level band that hangs under the header, not a floating card that
 * needs the page dimmed behind it to read as a layer — the full-bleed edge and
 * the opaque surface do that job on their own. Dialogs keep their backdrop;
 * this change is scoped to the two anchored panels.
 *
 * WHAT SURVIVED THE SCRIM, AND WHY THIS ELEMENT STILL EXISTS.
 *
 * `pointer-events-auto` is the whole point of the element and is LOAD-BEARING.
 * Radix Popover passes `deferPointerDownOutside`, so the dismiss fires on the
 * `click`, not the `pointerdown` — which means the very click that closes the
 * panel is still live on the page underneath. Measured on both panels before
 * this layer existed: a tap outside closed the panel AND opened the job card
 * under your finger (`/dashboard` -> `/dashboard?job=…`), at 320, 375, 768 and
 * 1440. A trailing-click swallower cannot help, because it would have to be
 * registered during the click that is already happening. Something has to
 * RECEIVE that click, and this is it: it sits above the page and below the
 * panel, absorbs the tap, and Radix still sees an outside-interaction and
 * dismisses. Deleting the scrim's PAINT is safe; deleting the ELEMENT
 * reintroduces the tap-through.
 *
 * A modal layer also sets `body { pointer-events: none }`, which is the second
 * reason `auto` is stated rather than inherited — it would otherwise inherit
 * `none` and be transparent to the tap again.
 *
 * WHY z-50 AND NOT z-40. Kept from the scrim, and still true even though this
 * layer paints nothing, because z-index is what decides who receives the
 * click. The app's fixed chrome — `MobileNav`'s dock and
 * `DesktopTopNav`/`Navbar` — is z-50 and is not inside any stacking context
 * that would confine it. At z-40 this layer sits UNDER the dock, so a tap on a
 * bottom-nav item goes to the dock instead of dismissing (and, on a modal
 * layer, to a control that `body { pointer-events: none }` has already made
 * inert — a tap target that does nothing). At z-50 it is a later sibling in
 * `document.body` than the chrome (which lives inside `#root`), so equal
 * z-index resolves in this layer's favour. The panel still paints over it for
 * the same reason: the Radix content portal mounts AFTER this one.
 *
 * Dismissal: this element is OUTSIDE the Radix DismissableLayer, so a press on
 * it is an outside-interaction and closes the panel through Radix's normal
 * dismiss path — no click handler of our own, and no second source of truth
 * for "is it open".
 *
 * Render it inside a portal of its own, immediately before the Content — the
 * way `SheetPortal` stacks `SheetOverlay` under `SheetContent`.
 */
const PopoverDismissLayer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      data-anchored-panel-dismiss=""
      className={cn("fixed inset-0 z-50 pointer-events-auto bg-transparent", className)}
      {...props}
    />
  ),
);
PopoverDismissLayer.displayName = "PopoverDismissLayer";

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverDismissLayer,
};
