import * as React from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";

// Moved out of dialog.tsx unchanged (Q806 god-component ratchet, pure move);
// dialog.tsx re-exports both, so every caller keeps importing them from
// "@/components/ui/dialog".
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
    className="font-sans text-ds-12 leading-relaxed space-y-2"
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

export { DialogBody, DialogCallout };
