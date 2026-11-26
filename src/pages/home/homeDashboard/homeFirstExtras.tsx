/**
 * Home's first-screen extras (owner polish 11-20), in their own chunk so they never weigh on /home's critical path
 * (Q178 budget): the "Needs you" short list (2-3 to-dos, each with its own action) and the empty "Coming up" buttons
 * (ComingUpCta). HomeDashboard starts this chunk as it mounts (createLazyModule) and, until it lands, draws the single
 * to-do card it already has and a 44px placeholder in Coming up, so nothing moves when it arrives.
 * Guards: src/test/homeBoard7.test.ts, src/test/homeComingUpCta1120.test.tsx.
 */
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import type { TodoItem } from "./needsYouTodos";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enHome";

export { ComingUpCta } from "./ComingUpCta";

export function NeedsYouList({ todos, total, rest, open, onToggle, sectionOf, onGo }: {
  todos: readonly TodoItem[];
  total: number;
  rest: number;
  open: boolean;
  onToggle: () => void;
  sectionOf: (key: string) => { Icon: ComponentType<{ className?: string }>; label: string };
  onGo: (todo: TodoItem) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <ul data-next-up-list="" aria-label={t("home.yourTodos")} className="flex flex-col divide-y divide-border/70">
        {todos.map((td, i) => {
          const { Icon, label } = sectionOf(td.section);
          return (
            <li key={td.id} data-next-up-row={i} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-0">
              <span aria-hidden title={label} className="w-6 h-6 shrink-0 flex items-center justify-center">
                <Icon className="w-5 h-5 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <p data-testid={i === 0 ? "next-up-title" : undefined} className="text-ds-15 font-semibold leading-snug text-foreground line-clamp-2 [overflow-wrap:anywhere]">{td.title}</p>
                <p className="text-ds-13 text-muted-foreground truncate">
                  {td.money && <span className="font-bold" style={{ color: "hsl(var(--accent-ink))" }}>{t("home.orderTotal", { amount: td.money })}</span>}
                  {td.money && " · "}
                  {td.meta}
                </p>
              </div>
              {/* Home keeps ONE primary action: the most urgent row's; the others are outline. */}
              <Button type="button" size="sm" variant={i === 0 ? "primary" : "outline"} data-testid={i === 0 ? "next-up-action" : undefined} data-next-up-row-action={i} onClick={() => onGo(td)} className="px-4 text-ds-14 font-semibold tracking-normal shadow-none shrink-0">
                {td.action}
              </Button>
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        // The shared link Button (owner 11-06 pop-up: switch; 2px narrower, desktop hover underline).
        <Button
          type="button"
          variant="link"
          size="sm"
          data-testid="next-up-see-all"
          aria-expanded={open}
          aria-controls={open ? "home-todo-list" : undefined}
          onClick={onToggle}
          className="self-start px-1 -ml-1 text-ds-13 font-bold text-primary whitespace-nowrap"
        >
          {open ? t("home.hide") : t("home.seeAll", { n: total })}
        </Button>
      )}
    </>
  );
}
