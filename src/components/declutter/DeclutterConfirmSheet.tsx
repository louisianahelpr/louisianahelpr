/**
 * Declutter's one "are you sure?" for a buyer, seller or Helpr moment that moves money, ends a sale or costs a
 * strike: an in-app sheet, never the browser's window.confirm (a grey system box with the page's address for a
 * title; lead walkthrough 2026-10-28). The same parts as the handover sheets (boards 159/160,
 * DeclutterHandoverSheets.tsx): a title, the consequence in the money tint, then "Not now" and the one action.
 * Guard: src/test/declutterNoBrowserConfirm.test.ts.
 */
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { focusSheetItself } from "./focusSheetItself";

export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Not now",
  pending = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  testId,
}: {
  open: boolean;
  title: string;
  /** What happens if they go ahead, in plain words (money, strikes, what comes back). */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Not ready to send yet (a required choice or words are missing). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testId?: string;
}) {
  const webDesktop = useIsWebDesktop();
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <SheetContent
        side="bottom"
        floor={!webDesktop}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[440px]" : ""}`}
        onOpenAutoFocus={focusSheetItself}
        data-confirm-sheet={testId ?? ""}
      >
        <SheetHero title={title} />
        <p className="mt-2 rounded-xl px-3 py-2 text-ds-14 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-sheet-note="">
          {children}
        </p>
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose} disabled={pending}>{cancelLabel}</SheetSecondaryAction>
          <SheetPrimaryAction onClick={onConfirm} disabled={pending || confirmDisabled}>{confirmLabel}</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
