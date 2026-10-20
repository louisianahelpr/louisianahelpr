import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { SECTION_INVITE } from "@/pages/home/homeDashboard/useHomeSummary";
import { sectionByKey } from "./sectionsConfig";
import { useSectionPrefs } from "./useSectionPrefs";

/**
 * Customize sections = board 90 (2026-10-20; first built 2026-10-19). Home and
 * Messages are ALWAYS ON (their own group, no switch). Each section shows its
 * both-sides line and a switch, or "Opening soon" while it is closed to this
 * viewer. Reorder with the arrows (there is no drag, so the copy never says
 * drag). At least one section stays on. Opened from Home's "Your sections"
 * header and from You.
 */
export function CustomizeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { prefs, setHidden, move } = useSectionPrefs();
  const live = useSectionTabs();
  const row = "flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-border/60";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor data-testid="customize-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHero title="Customize sections" />
        <p className="text-ds-14 text-muted-foreground">
          Use the arrows to reorder. Hidden sections leave Home, Explore and the + menu. Nothing is deleted, and open
          chats stay in Messages.
        </p>

        <h3 className="mt-4 mb-2 px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Always on</h3>
        <ul className="flex flex-col gap-2">
          {[
            { label: "Home", line: "Your Next up card" },
            { label: "Messages", line: "Every chat, every section" },
          ].map((r) => (
            <li key={r.label} className={row} style={{ background: "hsl(var(--card))" }} data-always-on={r.label}>
              <span className="flex-1 min-w-0">
                <span className="block text-ds-15 font-semibold">{r.label}</span>
                <span className="block text-ds-13 text-muted-foreground">{r.line}</span>
              </span>
              <span className="text-ds-13 font-semibold text-muted-foreground">Always on</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-4 mb-2 px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your sections</h3>
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
                  <button type="button" aria-label={`Move ${s.label} up`} disabled={i === 0} onClick={() => move(key, -1)} className="w-8 h-9 flex items-center justify-center rounded-full text-muted-foreground disabled:invisible">
                    <ChevronUp className="w-4 h-4" aria-hidden />
                  </button>
                  <button type="button" aria-label={`Move ${s.label} down`} disabled={i === prefs.order.length - 1} onClick={() => move(key, 1)} className="w-8 h-9 flex items-center justify-center rounded-full text-muted-foreground disabled:invisible">
                    <ChevronDown className="w-4 h-4" aria-hidden />
                  </button>
                </span>
                {on ? (
                  <Switch
                    checked={shown}
                    aria-label={`Show ${s.label}`}
                    data-section-toggle={key}
                    onCheckedChange={(next) => {
                      if (!setHidden(key, !next)) toast("Keep at least one section on", { id: "customize-last" });
                    }}
                  />
                ) : (
                  <span className="text-ds-13 font-semibold text-muted-foreground" data-section-soon={key}>Opening soon</span>
                )}
              </li>
            );
          })}
        </ul>

        <SheetFooter className="mt-4">
          <SheetPrimaryAction onClick={() => onOpenChange(false)}>Done</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
