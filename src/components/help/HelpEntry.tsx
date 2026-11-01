import { useRef, useState, type ComponentType, type ComponentProps } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type HelpEntryPanel from "./HelpEntryPanel";
import { loadModule } from "@/lib/loadModule";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const helpEntryPanel = () => loadModule(() => import("./HelpEntryPanel"));

const SUPPORT_PATH = "/support?topic=message";

/**
 * The ONE Help entry (owner approved 2026-10-29, audit page UX-6): a lifebuoy in the signed-in top bars that opens
 * Get help now and its promise, "We usually answer within a few hours." The button goes to /support with "Talk to a
 * real person" chosen, the same form and the same email + Slack + ledger path as the job page's GetHelpNow. That
 * one stays on an active job because it names the job in the subject, which a global entry cannot know.
 *
 * Signed in only (never the guest shell), and not in Admin, where the member IS the support desk.
 * Mounted from DesktopTopNav (every desktop rail route), AppTopBar (phone) and PageHeader (phone back-arrow screens).
 *
 * The panel is a dynamic import on the first tap: this file is on every signed-in screen's first load (lead,
 * 2026-10-30, page speed first). If that chunk cannot load, the tap goes straight to the form instead of doing nothing.
 * Guard: src/test/oneHelpEntry.test.tsx.
 */
export function HelpEntry({ triggerClassName = "h-11 w-11" }: { triggerClassName?: string }) {
  const { user } = useCurrentUser();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [Panel, setPanel] = useState<ComponentType<ComponentProps<typeof HelpEntryPanel>> | null>(null);
  const [open, setOpen] = useState(false);
  if (!user || pathname.startsWith("/admin")) return null;

  const onTap = () => {
    if (Panel) {
      setOpen(true);
      return;
    }
    helpEntryPanel().then(
      (mod) => {
        if (!mod) return; // a recovery reload is under way
        setPanel(() => mod.default);
        setOpen(true);
      },
      () => navigate(SUPPORT_PATH),
    );
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="iconCompact"
        aria-label="Help"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="help-entry"
        onClick={onTap}
        className={cn("shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-[22px]", triggerClassName)}
      >
        <LifeBuoy aria-hidden="true" />
      </Button>
      {Panel && open && (
        <Panel
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
          onGetHelp={() => {
            setOpen(false);
            navigate(SUPPORT_PATH);
          }}
        />
      )}
    </>
  );
}
