import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import type { SectionDef, SectionKey } from "@/components/sections/sectionsConfig";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionIsOn } from "@/components/sections/ExploreSwitcher";
import { sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { fetchMyShopId } from "@/lib/shops/api";
import { hapticLight } from "@/lib/haptics";

/** The AI post-a-job path (EntryChoice opens its builder on `?start=ai`). */
const DESCRIBE_IT_PATH = "/post-job?start=ai";

interface CreateAction {
  label: string;
  path: string;
  /** Post a job and "describe it" keep the under-18 gate their own entry points have. */
  gated?: boolean;
}

/**
 * The actions per section, only paths that EXIST today (measured 2026-10-20):
 * - Jobs: Post a job. "Get quotes" is a choice inside the post-job form with
 *   no entry route yet, so it is not offered here until one exists.
 * - Declutter: Sell an item; Moving out sale only while 'declutter_moving_out'
 *   is on for the viewer (/declutter/move is the 404 otherwise).
 * - Shops: Open a shop, or, once the member has one, Add a product or service
 *   (both /shops/mine, whose items section adds them).
 * - Homes: List for rent (Owning's add property, the first step of a rent listing). "List for
 *   sale" needs a property id (/rentals/listings/new?sell=<id>), so not here yet.
 */
function useCreateRows() {
  const isOn = useSectionIsOn();
  const movingOut = useFeature("declutter_moving_out");
  const shopsOn = useFeature("shops");
  const myShop = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId, enabled: shopsOn });
  const hasShop = !!myShop.data;
  const actions: Record<SectionKey, CreateAction[]> = {
    jobs: [{ label: "Post a job", path: "/post-job", gated: true }],
    declutter: [{ label: "Sell an item", path: "/declutter/sell" }, ...(movingOut ? [{ label: "Moving out sale", path: "/declutter/move" }] : [])],
    shops: [{ label: hasShop ? "Add a product or service" : "Open a shop", path: "/shops/mine" }],
    homes: [{ label: "List for rent", path: "/rentals?tab=own&add=1" }],
  };
  return { isOn, actions, note: (s: SectionDef) => (s.key === "shops" && shopsOn && myShop.isSuccess && !hasShop ? "No shop yet" : null) };
}

/**
 * THE CENTER "+" SHEET (owner-approved mock-up 20, 2026-10-20; HELPR-DESIGN-SPEC
 * v2 §6): "What are we doing?" and ONE ROW PER SECTION in the member's
 * Customize order: the section's icon and name, its main action (olive) and a
 * second action (outline) when one really exists. A section closed to the
 * viewer shows its row greyed with "Opening soon" and no actions; it never
 * routes into a closed section. "Or just describe it" opens the AI job builder.
 * Guard: src/test/centerCreateNav.test.tsx.
 */
export function CreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  const { visible } = useSectionPrefs();
  const { isOn, actions, note } = useCreateRows();
  const go = (path: string) => {
    hapticLight();
    onOpenChange(false);
    navigate(path);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor data-testid="create-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHero moment title="What are we doing?" />
        <p className="text-ds-14 text-muted-foreground">One account, four ways to get things done.</p>
        <ul className="mt-4 liquid-glass overflow-hidden">
          {visible.map((s, i) => {
            const on = isOn(s);
            const Icon = s.icon;
            const side = on ? note(s) : null;
            return (
              <li
                key={s.key}
                data-create-row={s.key}
                aria-disabled={on ? undefined : true}
                className={`px-4 py-3 flex flex-col gap-2.5 ${i === visible.length - 1 ? "" : "border-b border-border/70"}`}
              >
                <div className="flex items-center gap-2.5 min-h-6">
                  <Icon className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden style={{ color: on ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))" }} />
                  <span className={`flex-1 min-w-0 text-ds-16 font-bold truncate ${on ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
                  {!on && (
                    <button
                      type="button"
                      data-create-soon={s.key}
                      onClick={() => sayComingSoon(s.label)}
                      className="min-h-11 -my-2.5 px-1 flex items-center"
                    >
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-ds-12 font-semibold text-muted-foreground">Opening soon</span>
                    </button>
                  )}
                  {side && <span className="text-ds-13 text-muted-foreground shrink-0">{side}</span>}
                </div>
                {on && (
                  <div className="flex flex-wrap gap-2">
                    {actions[s.key].map((a, j) => (
                      <button
                        key={a.label}
                        type="button"
                        data-create-action={`${s.key}:${j}`}
                        onClick={a.gated ? gate.gate("post", () => go(a.path)) : () => go(a.path)}
                        {...(a.gated ? gate.gatedProps("post") : {})}
                        className={`btn-press rounded-full min-h-11 px-3 min-[360px]:px-4 text-ds-13 min-[360px]:text-ds-14 font-semibold ${
                          j === 0 ? "btn-grad-primary" : "border text-foreground"
                        }`}
                        // No `bg-card` on the outline pill: index.css T2 strips a .bg-card border (looked: it vanished).
                        style={j === 0 ? { color: "hsl(var(--primary-foreground))" } : { borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          data-testid="create-describe"
          onClick={gate.gate("post", () => go(DESCRIBE_IT_PATH))}
          {...gate.gatedProps("post")}
          className="btn-press mt-3 w-full flex items-center gap-3 rounded-full px-4 min-h-11 py-3 text-left bg-muted"
        >
          <Sparkles className="w-4 h-4 shrink-0" aria-hidden style={{ color: "hsl(var(--bark))" }} />
          <span className="text-ds-14 text-foreground">Or describe a job: "gutters cleaned Saturday"</span>
        </button>
      </SheetContent>
    </Sheet>
  );
}
