import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { SECTIONS, type SectionDef, type SectionKey } from "@/components/sections/sectionsConfig";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionIsOn, useSectionIsPreview } from "@/components/sections/ExploreSwitcher";
import { sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { fetchMyShopId } from "@/lib/shops/api";
import { SELL_CHOOSER_PATH, SELL_MOVE_PATH } from "@/lib/declutter/sellChooser";
import { hapticLight } from "@/lib/haptics";
import { SoonPill } from "@/components/sections/SoonPill";
import { PreviewPill } from "@/components/sections/PreviewPill";

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
 * - Declutter: Sell an item (the "What do you want to sell?" chooser, owner 2026-10-30); Moving out sale only while 'declutter_moving_out'
 *   is on for the viewer (Sell a bunch with a move-out date).
 * - Shops: Open a shop, or, once the member has one, Add a product or service
 *   (both /shops/mine, whose items section adds them).
 * - Homes: List for rent (Owning's add property, the first step of a rent listing). "List for
 *   sale" needs a property id (/rentals/listings/new?sell=<id>), so not here yet.
 */
function useCreateRows() {
  const isOn = useSectionIsOn();
  const isPreview = useSectionIsPreview();
  const movingOut = useFeature("declutter_moving_out");
  const shopsOn = useFeature("shops");
  const myShop = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId, enabled: shopsOn });
  const hasShop = !!myShop.data;
  const actions: Record<SectionKey, CreateAction[]> = {
    jobs: [{ label: "Post a job", path: "/post-job", gated: true }],
    declutter: [{ label: "Sell an item", path: SELL_CHOOSER_PATH }, ...(movingOut ? [{ label: "Moving out sale", path: SELL_MOVE_PATH }] : [])],
    shops: [{ label: hasShop ? "Add a product or service" : "Open a shop", path: "/shops/mine" }],
    homes: [{ label: "List for rent", path: "/rentals?tab=own&add=1" }],
  };
  return { isOn, isPreview, actions, note: (s: SectionDef) => (s.key === "shops" && shopsOn && myShop.isSuccess && !hasShop ? "No shop yet" : null) };
}

/**
 * THE CENTER "+" SHEET (owner-approved mock-up 20, 2026-10-20; HELPR-DESIGN-SPEC
 * v2 §6): "What are we doing?" and ONE ROW PER SECTION in the member's
 * Customize order: the section's icon and name, its main action (olive) and a
 * second action (outline) when one really exists. A section closed to the
 * viewer shows its row greyed with "Coming soon" and no actions; it never
 * routes into a closed section. "Or describe it" opens the AI job builder; it
 * is a Jobs action, so it sits INSIDE the Jobs row as a small link under "Post
 * a job" (owner 2026-10-21: it used to sit under the whole menu, below
 * Declutter, Shops and Homes). Guard: src/test/centerCreateNav.test.tsx.
 */
export function CreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  const { visible, prefs, setHidden } = useSectionPrefs();
  const { isOn, isPreview, actions, note } = useCreateRows();
  // A3-C13: a member who hid every OPEN section (allowed before the rule
  // counted open sections) saw only "Coming soon" rows here, with no reason.
  // Say why, and offer to show them again.
  const hiddenOpen = visible.some(isOn) ? [] : SECTIONS.filter((s) => isOn(s) && prefs.hidden.includes(s.key));
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
        {hiddenOpen.length > 0 && (
          <div className="mt-4 liquid-glass px-4 py-3 flex flex-col items-start gap-2" data-testid="create-all-hidden">
            <p className="text-ds-14 text-foreground">
              You hid {hiddenOpen.map((s) => s.label).join(" and ")} in Settings, so there's nothing to start here yet.
            </p>
            <div className="flex flex-wrap gap-2">
              {hiddenOpen.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  data-create-unhide={s.key}
                  onClick={() => setHidden(s.key, false)}
                  className="btn-press btn-grad-primary rounded-full min-h-11 px-4 text-ds-14 font-semibold"
                  style={{ color: "hsl(var(--primary-foreground))" }}
                >
                  Show {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
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
                  {on && isPreview(s) && <PreviewPill data-create-preview={s.key} />}
                  {!on && (
                    <button
                      type="button"
                      data-create-soon={s.key}
                      onClick={() => sayComingSoon(s.label)}
                      className="min-h-11 -my-2.5 px-1 flex items-center"
                    >
                      <SoonPill />
                    </button>
                  )}
                  {side && <span className="text-ds-13 text-muted-foreground shrink-0">{side}</span>}
                </div>
                {on && (
                  <div className="flex flex-col items-start gap-1">
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
                  {s.key === "jobs" && (
                    <button
                      type="button"
                      data-testid="create-describe"
                      onClick={gate.gate("post", () => go(DESCRIBE_IT_PATH))}
                      {...gate.gatedProps("post")}
                      className="btn-press min-h-11 -mb-2 inline-flex items-center gap-1.5 px-1 text-ds-13 font-semibold"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      or describe it
                    </button>
                  )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
