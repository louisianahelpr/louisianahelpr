/**
 * Posting audit 10-30 #1: before the job form, what hiring a Helpr to help you list really means. Nothing here is a
 * new promise: it is an ordinary Helpr job, the seller posts from their own account (src/lib/declutter/sellForMe.ts),
 * the seller keeps the sale (src/lib/declutter/money.ts), the setup fee is BunchFeeGate's, and haul-away is in the Terms.
 * Both ways in use this one sheet: the sell chooser and "Sell it for me" on the One item page (#21).
 * Guard: src/components/declutter/declutterSellChooser.test.tsx.
 */
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { sellForMePostJobPath } from "@/lib/declutter/sellForMe";
import { focusSheetItself } from "./focusSheetItself";

const ROWS: readonly { title: string; line: string }[] = [
  { title: "What the Helpr does", line: "Comes to you and helps take the photos and write the listings." },
  { title: "What you do", line: "Be there, and post the listings from your own account. A Helpr never gets into your account." },
  { title: "What you pay", line: "You set a price for the Helpr's time, like any job, and see the total before you pay. The Helpr gets that price, not a share of your sales." },
  { title: "Who keeps the sale money", line: "You keep the whole price of what sells. Your first paid listing has a one-time setup fee, unless you already paid it for Jobs." },
  { title: "What doesn't sell", line: "It stays yours. You can lower the price, give it away free or book a haul-away." },
];

export function HelprListExplainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const webDesktop = useIsWebDesktop();
  const navigate = useNavigate();
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-helpr-explain="">
        <SheetHero title="How a Helpr helps you list" />
        <dl className="mt-2 space-y-3">
          {ROWS.map((r) => (
            <div key={r.title}>
              <dt className="text-ds-15 font-semibold">{r.title}</dt>
              <dd className="text-ds-14 text-muted-foreground">{r.line}</dd>
            </div>
          ))}
        </dl>
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Not now</SheetSecondaryAction>
          <SheetPrimaryAction onClick={() => { onClose(); navigate(sellForMePostJobPath()); }}>Continue</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
