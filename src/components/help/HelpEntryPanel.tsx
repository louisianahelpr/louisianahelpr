import { type RefObject } from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverDismissLayer, PopoverPortal } from "@/components/ui/popover";
import { SUPPORT_REPLY_PROMISE } from "@/lib/supportTopics";

/** What the Help lifebuoy opens: loaded on the first tap, so it adds nothing to a screen's first load. See HelpEntry. */
export default function HelpEntryPanel({
  anchorRef,
  onClose,
  onGetHelp,
}: {
  anchorRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onGetHelp: () => void;
}) {
  return (
    <Popover open onOpenChange={(next) => !next && onClose()}>
      <PopoverAnchor virtualRef={anchorRef} />
      {/* The paint-free layer takes the tap that closes the panel, so it never lands on the page beneath. */}
      <PopoverPortal>
        <PopoverDismissLayer />
      </PopoverPortal>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-2xl"
        data-testid="help-entry-panel"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          anchorRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="flex flex-col items-start gap-2">
          <Button type="button" size="sm" className="w-full gap-1.5 rounded-full" onClick={onGetHelp}>
            <LifeBuoy className="w-4 h-4" aria-hidden="true" />
            Get help now
          </Button>
          <p className="text-ds-13 text-muted-foreground">{SUPPORT_REPLY_PROMISE}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
