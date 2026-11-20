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

/**
 * VERIFY 11-20 #8 (~/.lh-shots/declutter-top5-1120/VERIFY.md): the shared footer stacks the two actions when either label
 * is wider than half the card (min-w-max), so at 375/390 "Pause my shop" and Spanish "Terminar oferta" sat on top of
 * "Not now" while the other new sheets sat side by side. A `pair` sheet keeps the two halves side by side at every width
 * (the shared footer's 2-column grid, as the trade sheet's footer) and lets a long label wrap INSIDE its half, centred,
 * with less side padding; the button grows taller, never narrower than the 56px commit height.
 */
export const PAIR_FOOTER =
  "grid grid-cols-2 [&>button]:!min-w-0 [&>button]:!h-auto [&>button]:min-h-14 [&>button]:!px-3 [&>button]:py-2 " +
  "[&>button]:whitespace-normal [&>button]:text-center [&>button]:leading-tight";

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
  pair = false,
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
  /** VERIFY 11-20 #8: the two actions stay side by side on a phone, long labels wrapping inside their half. */
  pair?: boolean;
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
        <SheetFooter className={pair ? `mt-4 ${PAIR_FOOTER}` : "mt-4"} data-sheet-pair={pair ? "" : undefined}>
          <SheetSecondaryAction onClick={onClose} disabled={pending}>{cancelLabel ?? t("core.notNow")}</SheetSecondaryAction>
          {destructive
            ? <SheetDestructiveAction onClick={onConfirm} disabled={pending || confirmDisabled} data-confirm-destructive="">{confirmLabel}</SheetDestructiveAction>
            : <SheetPrimaryAction onClick={onConfirm} disabled={pending || confirmDisabled}>{confirmLabel}</SheetPrimaryAction>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
