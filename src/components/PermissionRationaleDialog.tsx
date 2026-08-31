/**
 * Mounted once at the app root (App.tsx). Listens to usePermissionRationale
 * state and renders the SHARED confirm shell before any native permission
 * prompt fires — same AlertDialogContent surface, same AlertDialogHero title
 * row, same AlertDialogFooter, as every other confirm in the app.
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import {
  usePermissionRationaleState,
  __resolveRationale,
} from "@/hooks/usePermissionRationale";

export function PermissionRationaleDialog() {
  const { state, subscribe, copy } = usePermissionRationaleState();
  const [, force] = useState(0);

  useEffect(() => subscribe(() => force((n) => n + 1)), [subscribe]);

  if (!state.open || !copy) return null;

  return (
    // ESCAPE / ✕ NOW ACTUALLY CLOSE IT. `open` is controlled and there was no
    // `onOpenChange`, so every dismissal path Radix offers was inert: Escape
    // did nothing, and the corner ✕ that AlertDialogContent renders for every
    // confirm in the app fired its Cancel and left the dialog on screen. A
    // dead ✕ is worse than none. Dismissing resolves the rationale as a
    // decline, exactly like "Not Now".
    <AlertDialog open={state.open} onOpenChange={(next) => { if (!next) __resolveRationale(false); }}>
      <AlertDialogContent>
        {/* NO ICON ROW. This was a bespoke 56px tile rendered ABOVE the Hero,
            which pushed the title off the top row and left the ✕ aligned to an
            icon instead of to a heading — so this was the one popup in the app
            whose header had a different shape (owner, 2026-08-31: "need to
            share the same sheet and design").
            The canonical popup header is the Hero's single title line, with
            the ✕ beside it, and DialogHero/AlertDialogHero deliberately expose
            no slots. Permission rationales are not a separate species: they
            are ordinary confirms that happen to precede an OS prompt, and the
            body copy below already says which permission and why. If icons in
            popup headers are ever wanted, they belong in the shared Hero as
            one documented slot used by ALL popups — not rebuilt here. */}
        <AlertDialogHero
          title={copy.title}
        />
        {/* The rationale BODY is the entire point of this dialog and had been
            dropped: `copy.body` existed in usePermissionRationale but nothing
            rendered it, so the sheet read "Location" followed by two buttons
            and gave the user no reason to say yes. (The file's own header
            comment still described a "Garamond italic body" — comment rot.)

            It went missing as fallout from the app-wide "one main title" pass
            that stripped hero subtitles on 2026-07-25. That rule is right for
            a page header and wrong here: this sheet exists ONLY to explain why
            a permission is being asked for, immediately before the OS prompt.
            Without the explanation it is a bare demand, and Apple's own
            guidance is to say why first. Rendered here rather than by
            restoring subtitles globally, so the wider rule stands. */}
        {/* Same body treatment BrandConfirmDialog gives every other confirm's
            description — `font-serif italic text-ds-12 leading-relaxed` at
            olivewood/0.8. This was ds-14 at full-strength olivewood with a
            `-mt-1` nudge, i.e. a third size and a different rhythm from the
            confirm that opens next to it. */}
        <p
          className="font-serif italic text-ds-12 leading-relaxed"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {copy.body}
        </p>
        {/* Plain AlertDialogFooter. The className restated the footer's own
            `flex-col-reverse sm:flex-row gap-2`, and the `h-11` pinned both
            buttons to 44px while every other popup's footer buttons are the
            shared 56px — so this dialog's controls were visibly shorter than
            the ones in the confirm that might open right after it. */}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => __resolveRationale(false)}>
            Not Now
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => __resolveRationale(true)}>
            {copy.cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
