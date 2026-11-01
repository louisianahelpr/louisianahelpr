import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useOpenSectionKeys, useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { SECTION_INVITE } from "@/pages/home/homeDashboard/useHomeSummary";
import { sectionByKey } from "./sectionsConfig";
import { KEEP_ONE_OPEN_TOAST, useSectionPrefs } from "./useSectionPrefs";
import { SoonPill } from "@/components/sections/SoonPill";

/**
 * Customize sections = board 90 (2026-10-20; first built 2026-10-19). Home and
 * Messages are ALWAYS ON (one line, no switch; owner 2026-10-25 no-scroll). Each section shows its
 * both-sides line and a switch, or "Coming soon" while it is closed to this
 * viewer. Reorder with the arrows (there is no drag, so the copy never says
 * drag). At least one section stays on. Opened from Home's "Your sections"
 * header and from You.
 */
export function CustomizeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { prefs, setHidden, move } = useSectionPrefs();
  const live = useSectionTabs();
  const openKeys = useOpenSectionKeys();
  const row = "flex items-center gap-2 px-4 py-2 rounded-2xl border border-border/60";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor data-testid="customize-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHero title="Customize sections" />
        {/* Fits without scrolling (owner 2026-10-25, "this doesn't need to scroll"):
            measured 730px of content in a 600px box at a 700px-tall window. Home and
            Messages, which have no control, are one line instead of two rows. */}
        <p className="text-ds-14 text-muted-foreground">
          Use the arrows to reorder. Hidden sections leave Home, Explore and the + menu. Nothing is deleted.
        </p>
        <p className="mt-2 text-ds-14 text-muted-foreground">
          <span className="font-semibold text-foreground" data-always-on="Home">Home</span> and{" "}
          <span className="font-semibold text-foreground" data-always-on="Messages">Messages</span> are always on.
        </p>

        <h3 className="mt-3 mb-2 px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your sections</h3>
        <ul className="flex flex-col gap-2">
          {prefs.order.map((key, i) => {
            const s = sectionByKey(key);
            const shown = !prefs.hidden.includes(key);
            const on = s.feature === null || live.find((t) => t.path === s.path)?.on;
            return (
              <li key={key} className={row} style={{ background: "hsl(var(--card))" }}>
                <span className="flex-1 min-w-0">
                  <span className="block text-ds-15 font-semibold truncate">{s.label}</span>
                  <span className="block text-ds-13 text-muted-foreground truncate">{SECTION_INVITE[key]}</span>
                </span>
                <span className="flex items-center">
                  <Button type="button" variant="ghost" size="iconCompact" aria-label={`Move ${s.label} up`} disabled={i === 0} onClick={() => move(key, -1)} className="text-muted-foreground disabled:invisible [&_svg]:size-4">
                    <ChevronUp className="w-4 h-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="iconCompact" aria-label={`Move ${s.label} down`} disabled={i === prefs.order.length - 1} onClick={() => move(key, 1)} className="text-muted-foreground disabled:invisible [&_svg]:size-4">
                    <ChevronDown className="w-4 h-4" aria-hidden />
                  </Button>
                </span>
                {on ? (
                  <Switch
                    checked={shown}
                    aria-label={`Show ${s.label}`}
                    data-section-toggle={key}
                    onCheckedChange={(next) => {
                      if (!setHidden(key, !next, openKeys)) toast(KEEP_ONE_OPEN_TOAST, { id: "customize-last" });
                    }}
                  />
                ) : (
                  <SoonPill data-section-soon={key} />
                )}
              </li>
            );
          })}
        </ul>

        <SheetFooter className="mt-3">
          <SheetPrimaryAction onClick={() => onOpenChange(false)}>Done</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
