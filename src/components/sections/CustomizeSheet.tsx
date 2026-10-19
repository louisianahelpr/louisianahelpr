import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { sectionByKey } from "./sectionsConfig";
import { useSectionPrefs } from "./useSectionPrefs";

/**
 * Customize (owner, 2026-10-19): show or hide each section in the bottom nav
 * and on Home, and move it up or down. Home and Messages always show; at least
 * one section stays on. Opened from Home's "Your sections" header and from
 * Profile settings.
 */
export function CustomizeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { prefs, setHidden, move } = useSectionPrefs();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor data-testid="customize-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHero title="Your sections" />
        <p className="text-ds-14 text-muted-foreground">Hide the ones you don't use. They leave the bottom bar and Home. Home and Messages always stay.</p>
        <ul className="mt-4 liquid-glass overflow-hidden">
          {prefs.order.map((key, i) => {
            const s = sectionByKey(key);
            const shown = !prefs.hidden.includes(key);
            const Icon = s.icon;
            return (
              <li key={key} className={`flex items-center gap-2 px-3 py-3 ${i === prefs.order.length - 1 ? "" : "border-b border-border/70"}`}>
                <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-[18px] h-[18px]" aria-hidden />
                </span>
                <span className="flex-1 min-w-0 text-ds-15 font-semibold truncate">{s.label}</span>
                <span className="flex items-center">
                  <button type="button" aria-label={`Move ${s.label} up`} disabled={i === 0} onClick={() => move(key, -1)} className="w-8 h-9 flex items-center justify-center rounded-full text-muted-foreground disabled:invisible">
                    <ChevronUp className="w-4 h-4" aria-hidden />
                  </button>
                  <button type="button" aria-label={`Move ${s.label} down`} disabled={i === prefs.order.length - 1} onClick={() => move(key, 1)} className="w-8 h-9 flex items-center justify-center rounded-full text-muted-foreground disabled:invisible">
                    <ChevronDown className="w-4 h-4" aria-hidden />
                  </button>
                </span>
                <Switch
                  checked={shown}
                  aria-label={`Show ${s.label}`}
                  data-section-toggle={key}
                  onCheckedChange={(on) => {
                    if (!setHidden(key, !on)) toast("Keep at least one section on", { id: "customize-last" });
                  }}
                />
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
