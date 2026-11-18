/**
 * Declutter's one "are you sure?" for a buyer, seller or Helpr moment that moves money, ends a sale or costs a
 * strike: an in-app sheet, never the browser's window.confirm (a grey system box with the page's address for a
 * title; lead walkthrough 2026-10-28). The same parts as the handover sheets (boards 159/160,
 * DeclutterHandoverSheets.tsx): a title, the consequence in the money tint, then "Not now" and the one action.
 * Guard: src/test/declutterNoBrowserConfirm.test.ts.
 */
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDestructiveAction, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { focusSheetItself } from "./focusSheetItself";
import { t } from "@/lib/i18n/language";

export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  testId,
  destructive = false,
  plain = false,
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
  /** Area 06 M6 (11-18): an action that costs a strike or can't be undone uses the red commit, as Delete does. */
  destructive?: boolean;
  /** Area 05 #21 (11-18): nothing to warn about (no money, no strike): the body is plain text, not the tinted note. */
  plain?: boolean;
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
        <p className={plain ? "mt-2 text-ds-14 text-foreground" : "mt-2 rounded-xl px-3 py-2 text-ds-14 text-foreground"}
          style={plain ? undefined : { background: "hsl(var(--burnt-sienna) / 0.08)" }} data-sheet-note={plain ? "plain" : ""}>
          {children}
        </p>
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose} disabled={pending}>{cancelLabel ?? t("core.notNow")}</SheetSecondaryAction>
          {destructive
            ? <SheetDestructiveAction onClick={onConfirm} disabled={pending || confirmDisabled} data-confirm-destructive="">{confirmLabel}</SheetDestructiveAction>
            : <SheetPrimaryAction onClick={onConfirm} disabled={pending || confirmDisabled}>{confirmLabel}</SheetPrimaryAction>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
