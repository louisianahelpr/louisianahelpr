import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { SECTIONS, type SectionDef } from "@/components/sections/sectionsConfig";
import { useSectionTabs, sayComingSoon, comingSoonLabel } from "@/components/mobileNav/useSectionTabs";
import { useAgeGate } from "@/hooks/useAgeGate";
import { hapticLight } from "@/lib/haptics";

/** Where each tile goes: the section's own "+" destination, so the two never disagree. */
export const createPath = (s: SectionDef) => s.add.path;

/** The AI post-a-job path (EntryChoice opens its builder on `?start=ai`). */
export const DESCRIBE_IT_PATH = "/post-job?start=ai";

/**
 * THE CENTER "+" SHEET (owner-approved mock-up, 2026-10-20): "What are we
 * doing?" and the four ways to start something, one tile per section, in the
 * SECTIONS order (Post a job, Sell an item, Open a shop, List a home). A
 * section whose switch is off for the viewer shows "Coming soon" on its tile
 * and a tap says so; it never routes into a closed section. Post a job keeps
 * the under-18 gate its own "+" has. "Or just describe it" opens the AI job
 * builder on the post-a-job entry screen.
 * Guard: src/test/centerCreateNav.test.tsx.
 */
export function CreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const live = useSectionTabs();
  const gate = useAgeGate();
  const isOn = (s: SectionDef) => s.feature === null || !!live.find((t) => t.path === s.path)?.on;
  const go = (path: string) => {
    hapticLight();
    onOpenChange(false);
    navigate(path);
  };
  const firstLive = SECTIONS.find(isOn)?.key;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor data-testid="create-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHero moment title="What are we doing?" />
        <p className="text-ds-14 text-muted-foreground">One account, four ways to get things done.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {SECTIONS.map((s) => {
            const on = isOn(s);
            const Icon = s.icon;
            const primary = on && s.key === firstLive;
            const isPost = s.key === "jobs";
            const onClick = !on
              ? () => sayComingSoon(s.label)
              : isPost
                ? gate.gate("post", () => go(createPath(s)))
                : () => go(createPath(s));
            return (
              <button
                key={s.key}
                type="button"
                data-create-tile={s.key}
                aria-label={on ? s.create.title : comingSoonLabel(s.create.title)}
                aria-disabled={on ? undefined : true}
                onClick={onClick}
                {...(isPost && on ? gate.gatedProps("post") : {})}
                className={`btn-press relative text-left rounded-[22px] p-4 min-h-[132px] flex flex-col gap-1.5 min-w-0 border ${
                  primary ? "btn-grad-primary border-transparent" : "bg-card border-border/80"
                }`}
                style={primary ? { color: "hsl(var(--primary-foreground))" } : undefined}
              >
                <span className="flex items-center justify-between gap-2">
                  <Icon
                    className="w-6 h-6 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                    style={primary ? undefined : { color: on ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))" }}
                  />
                  {!on && <span className="text-ds-11 font-semibold text-muted-foreground">Coming soon</span>}
                </span>
                <span className={`mt-auto text-ds-15 min-[360px]:text-ds-16 font-bold leading-tight ${on ? "" : "text-muted-foreground"}`}>{s.create.title}</span>
                <span className={`text-ds-13 leading-snug ${primary ? "opacity-90" : "text-muted-foreground"}`}>{s.create.blurb}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          data-testid="create-describe"
          onClick={gate.gate("post", () => go(DESCRIBE_IT_PATH))}
          {...gate.gatedProps("post")}
          className="btn-press mt-3 w-full flex items-center gap-3 rounded-full px-4 py-3 text-left bg-muted"
        >
          <Sparkles className="w-4 h-4 shrink-0" aria-hidden style={{ color: "hsl(var(--bark))" }} />
          <span className="text-ds-14 text-foreground">Or just describe the job you need done</span>
        </button>
      </SheetContent>
    </Sheet>
  );
}
