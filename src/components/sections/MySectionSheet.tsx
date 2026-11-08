import { Link } from "react-router-dom";
import { ChevronRight, Settings, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { formatUnreadBadge } from "@/lib/format";
import type { SectionMineMenu } from "./sectionMine";

const ROW = "flex min-h-14 items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ctl-tint";

/**
 * "MY DECLUTTER" (owner 11-08, the Vinted header): opened from the profile photo on a section screen. The section's
 * own lists, each with its to-do count, then its settings, then the member's profile (the photo used to go straight
 * there). Loaded on the first tap (AppTopBar), never on the first screen. Guard: src/test/declutterHeaderVinted.test.tsx.
 */
export default function MySectionSheet({ menu, open, onOpenChange }: { menu: SectionMineMenu; open: boolean; onOpenChange: (o: boolean) => void }) {
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor className="max-h-[88dvh] overflow-y-auto" data-testid="my-section-sheet">
        <SheetHero title={menu.title} />
        <nav aria-label={menu.title} className="mt-2 overflow-hidden rounded-[20px] border border-border bg-card">
          <ul className="divide-y divide-border/60">
            {menu.items.map((i) => (
              <li key={i.key}>
                <Link to={i.to} onClick={close} data-mine-item={i.key} className={ROW}
                  aria-label={i.count && i.count > 0 ? `${i.label}, ${formatUnreadBadge(i.count)} to do` : i.label}>
                  <span className="min-w-0 flex-1 text-ds-16 font-semibold text-foreground">{i.label}</span>
                  {i.quiet !== undefined && i.quiet > 0 && <span aria-hidden className="tabular-nums text-ds-14 text-muted-foreground">{i.quiet}</span>}
                  {i.count !== undefined && i.count > 0 && (
                    <span aria-hidden data-mine-count={i.key} className="min-w-[20px] h-5 rounded-full px-1.5 text-ds-11 font-bold leading-5 text-center" style={{ background: "hsl(var(--alert))", color: "#fff" }}>
                      {formatUnreadBadge(i.count)}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 mb-4 overflow-hidden rounded-[20px] border border-border bg-card divide-y divide-border/60">
          {menu.settings && (
            <Link to={menu.settings.to} onClick={close} data-mine-settings="" className={ROW}>
              <Settings className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-ds-16 font-semibold text-foreground">{menu.settings.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          )}
          <Link to="/profile" onClick={close} data-mine-profile="" className={ROW}>
            <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 text-ds-16 font-semibold text-foreground">Your profile</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
