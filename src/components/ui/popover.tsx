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

// Exposed so a caller can portal a SCRIM into the same layer as the panel
// (see `PopoverScrim`). `PopoverContent` opens its own portal internally, so
// a scrim rendered as its sibling needs one of its own — and it must be a
// portal, not a bare `position: fixed` div, because these panels open inside
// <PageTransition>, whose framer-motion transform would otherwise become the
// fixed element's containing block and pin the scrim to the page instead of
// the viewport.
const PopoverPortal = PopoverPrimitive.Portal;

/**
 * The small notch that points a dropped-down panel back at the control that
 * opened it. Radix positions it along the aligned edge, clamped inside the
 * panel, so it lands under the trigger without any manual math.
 *
 * Paint it with the panel's own surface color (`fill`) — the panel surfaces
 * in this app are translucent + blurred, and an arrow cannot inherit a
 * backdrop-filter, so it renders as the solid version of the same hue rather
 * than trying (and failing) to match the blur.
 */
const PopoverArrow = PopoverPrimitive.Arrow;

/**
 * THE scrim for an anchored panel — the figure/ground layer that makes a
 * dropdown read as a layer ABOVE the page instead of one more band of it.
 *
 * ONE primitive, both panels. Notifications (off the bell) and Filters (off
 * the sliders button) were built hours apart on the same day and shipped two
 * of these — `PopoverScrim` here and an `AnchoredPanelScrim` in
 * `ui/anchoredPanel.tsx`, same tokens, different z-index, each with its own
 * comment block promising to stay in sync with the other. That is the
 * duplication the owner has objected to repeatedly; the second one is gone and
 * this is what both panels mount. Anything a new anchored panel needs belongs
 * here, not in a third copy.
 *
 * Deliberately the SAME recipe as `SheetOverlay`/`DialogOverlay` (warm 8%
 * parchment tint + a 24px blur), not a bespoke one: the owner's note was that
 * the anchored panels "sit on a surface almost identical to the page behind
 * them", and the fix is to join the app's existing overlay family. The tint
 * and blur come from `--scrim-tint` / `--scrim-blur` (`index.css`) rather than
 * a copied literal, so the next global lightening is one edit.
 *
 * Render it inside the popover's own Portal, immediately before the Content,
 * exactly the way `SheetPortal` stacks `SheetOverlay` under `SheetContent`.
 *
 * WHY z-50 AND NOT z-40. It sat at z-40 on the reasoning that the panel is
 * z-50 and a scrim belongs one step under it. But the app's fixed chrome —
 * `MobileNav`'s dock and `DesktopTopNav`/`Navbar` — is ALSO z-50, and it is
 * not inside any stacking context that would confine it, so at z-40 the scrim
 * painted *under* the chrome: measured on 2026-08-31 by A/B-ing the same open
 * panel at both values, the bottom dock (and its green FAB) at 375 and the
 * desktop top bar at 1440 both stayed fully saturated and crisp on top of the
 * blur, while everything else went back. A modal layer sets
 * `body { pointer-events: none }`, so those crisp controls were also inert —
 * the panel advertised five tap targets that did nothing. At z-50 the scrim is
 * a later sibling in `document.body` than the chrome (which lives inside
 * `#root`), so equal z-index resolves in the scrim's favour and the whole page
 * goes back together. The panel still paints over it for the same reason: the
 * Radix content portal mounts AFTER this one, so it is a later sibling again.
 *
 * Dismissal: this element is OUTSIDE the Radix DismissableLayer, so a press on
 * it is an outside-interaction and closes the panel through Radix's normal
 * dismiss path — no click handler of our own, and no second source of truth
 * for "is it open".
 *
 * `pointer-events-auto` is LOAD-BEARING, not a default. Radix Popover passes
 * `deferPointerDownOutside`, so the dismiss fires on the `click`, not the
 * `pointerdown` — which means the very click that closes the panel is also
 * still live on the page underneath. Measured on both panels before this: a
 * tap outside closed the panel AND opened the job card under your finger
 * (`?job=…`), at 320, 375 and 1440. A trailing-click swallower cannot help,
 * because it would have to be registered during the click that is already
 * happening. The scrim has to be the thing that RECEIVES that click. It sits
 * above the page and below the panel, so it absorbs the tap, the page never
 * sees it, and Radix still gets its outside-click and dismisses. `body
 * { pointer-events: none }` on a modal layer is also why this states `auto`
 * rather than relying on the default — it would otherwise inherit `none` and
 * be right back to being transparent to the tap.
 */
const PopoverScrim = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      data-anchored-panel-scrim=""
      className={cn(
        "fixed inset-0 z-50 pointer-events-auto motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200",
        className,
      )}
      style={{
        backgroundColor: "var(--scrim-tint)",
        backdropFilter: "var(--scrim-blur)",
        WebkitBackdropFilter: "var(--scrim-blur)",
      }}
      {...props}
    />
  ),
);
PopoverScrim.displayName = "PopoverScrim";

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
  PopoverArrow,
  PopoverContent,
  PopoverPortal,
  PopoverScrim,
};
