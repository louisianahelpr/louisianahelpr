import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { X } from "lucide-react";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      // THE SAME BACKDROP DialogOverlay uses (owner: "and background
      // consistency also"). This was `bg-black/50 backdrop-blur-md` — a plain
      // black scrim at half opacity — while every regular dialog got a
      // parchment-tinted one at 26% with a 24px blur. So a confirm sheet
      // opening on top of a dialog visibly darkened the page, and the two
      // modals read as belonging to different apps.
      //
      // The tint was deliberately lightened once already: "was 45% of a
      // near-black brown, which on the light parchment canvas read as a heavy
      // grey slab" (owner, 2026-08-22: "i also dont like the dark
      // background"). Alert dialogs never received that change. Values below
      // are DialogOverlay's verbatim — change one, change both.
      "fixed inset-0 z-50 backdrop-blur-[24px] backdrop-saturate-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    style={{
      backgroundColor: "hsla(38, 22%, 22%, 0.26)",
      WebkitBackdropFilter: "blur(24px) saturate(1.5)",
    }}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    /** Disable the corner close — for a dialog mid-submit, where dismissing
     *  would abandon an in-flight action. The footer Cancel this replaced
     *  carried the same guard, so it travels with it. */
    closeDisabled?: boolean;
  }
>(({ className, closeDisabled, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        // The four slide-* classes restore this element's -50%/-50% centering
        // THROUGH the enter/exit keyframes — see the long note in dialog.tsx.
        // Without them tailwindcss-animate's `transform` keyframe clobbers the
        // centering and the modal swoops in from off-centre.
        // Top-anchored and `gap-4 p-5 sm:p-7`, both matched to DialogContent — see
        // the long note there on why centring made dialogs jump as their content
        // arrived, and why the vertical slide pair goes with the vertical
        // transform. An alert dialog and a dialog appearing at two different
        // sizes with two different internal rhythms is the same defect the
        // per-call-site overrides were.
        "glass-modal fixed left-[50%] top-[7vh] z-50 grid w-[calc(100%-2rem)] max-w-lg max-h-[86vh] overflow-y-auto translate-x-[-50%] gap-4 p-5 sm:p-7 duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-4 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-4",
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
      {props.children}
      {/* THE SAME top-right close DialogContent renders (owner: "look for
          consistency globally — like the X in the top corner, not the bottom
          left").

          Alert dialogs had none, so each one improvised its dismiss: the apply
          sheet put a round X in the FOOTER's bottom-left, beside "Apply Now",
          while the job dialog it opens from has a bare X top-right. Two modals
          one tap apart, closing from opposite corners.

          Rendered as `Cancel`, not `Close` — AlertDialog has no Close
          primitive, and Cancel is the dismiss: it runs whatever onClick the
          caller already attached to their Cancel action, so nothing is bypassed
          by leaving through the corner instead of the button.

          Classes are copied verbatim from DialogContent's close; change one,
          change both. */}
      <AlertDialogPrimitive.Cancel
        aria-label="Close"
        disabled={closeDisabled}
        className="absolute right-3 top-3 w-11 h-11 p-0 box-border rounded-md btn-press flex items-center justify-center bg-transparent border-transparent shadow-none text-muted-foreground hover:text-foreground hover:bg-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none mt-0"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </AlertDialogPrimitive.Cancel>
    </AlertDialogPrimitive.Content>
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-display italic font-bold leading-tight", className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

/**
 * AlertDialogHero — the confirm-box twin of DialogHero. AlertDialogs can't use
 * DialogHero (different Radix primitive, no X close button), so this mirrors its
 * eyebrow → title → subtitle stack and type tokens EXACTLY, using the AlertDialog
 * Title/Description primitives Radix requires for a11y. Adopt this instead of
 * hand-rolling a header inside an AlertDialog so every confirm box reads identical
 * to every other popup app-wide.
 *
 *   <AlertDialogHero eyebrow="Safety" title="Block Sarah?" subtitle="They won't…" />
 */
const AlertDialogHero = ({ title }: {
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
  // NO className / titleClassName / style escape hatches. They existed, and
  // three dialogs used them to centre a title the other ~147 left-aligned —
  // which is exactly the drift this component was created to prevent. A popup
  // header is one layout; if it needs to change, it changes here, once.
}) => (
  <AlertDialogHeader className="space-y-0 text-left">
    <AlertDialogTitle
      className="font-display italic font-bold leading-tight pt-2"
      style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
    >
      {title}
    </AlertDialogTitle>
  </AlertDialogHeader>
);
AlertDialogHero.displayName = "AlertDialogHero";

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants({ size: "lg" }), "rounded-2xl w-full sm:w-auto font-semibold", className)}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-2xl w-full sm:w-auto mt-0 font-semibold border-border/60", className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogHero,
  AlertDialogAction,
  AlertDialogCancel,
};
