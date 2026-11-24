import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useStartPicks, type StartPick } from "./startPicks";

/**
 * THE SHORT TOUR (owner 2026-10-20): four or five coach marks on the REAL chrome (the dock and the top row's
 * Messages on a phone, the sidebar on desktop; owner 11-14), worded for the member's old start picks
 * (./startPicks): one line, dots, Skip and Next, "Done" on the last. Olive actions, sentence case, no rust.
 *
 * It opens ONLY from Help's "Take the tour again" (/home?tour=1, ./TourReplayHost), never by itself (owner
 * 2026-11-24 removed the first-run picker that used to lead into it, C11).
 * Guard: src/test/newMemberHome1114.test.tsx, src/test/whatBringsYouHereRemoved.test.tsx.
 */

type Pick = StartPick;

/** Where each coach mark points: the phone first, then the desktop sidebar (owner 11-14: the phone dock is Home, Jobs,
 *  Declutter, Shops, Homes and Messages is the top row's chat button). Dock tabs and rail rows are found by their path
 *  (`data-dock-tab` / `data-sidebar-item`), never by their words, so a mark finds its tab in Spanish and with a count
 *  badge. Create is Home's floating "+ Create" pill on a phone and the rail's Create button on desktop.
 *  Guard: src/test/newMemberHome1114.test.tsx. */
export const TARGETS = {
  home: ['[data-dock-tab="/home"]', '[data-sidebar-item="/home"]'],
  jobs: ['[data-dock-tab="/jobs"]', '[data-sidebar-item="/jobs"]'],
  declutter: ['[data-dock-tab="/declutter"]', '[data-sidebar-item="/declutter"]'],
  create: ['[data-testid="section-create-fab"]', '[data-testid="sidebar-create"]'],
  messages: ['[data-testid="top-bar-inbox"]', '[data-sidebar-item="/messages"]'], // the Inbox icon (owner 11-15)
} as const;
type Target = keyof typeof TARGETS;

export function tourSteps(picks: Pick[], declutterOpen: boolean, desktop = false): { target: Target; text: string }[] {
  const sells = declutterOpen;
  const earn = picks.includes("earn");
  const hire = picks.includes("hire");
  const jobs =
    earn && hire ? "Find work near you, or follow the jobs you post, in Jobs"
    : earn ? "Find jobs near you and apply here"
    : hire ? "The jobs you post and the Helprs who apply live in Jobs"
    : "Find work near you, or follow the jobs you post, in Jobs";
  const sell = picks.includes("sell");
  const deal = picks.includes("deal");
  const declutter =
    sell && deal ? "Sell what you don't need and find deals here"
    : sell ? "Sell what you don't need here"
    : deal ? "Find deals from your neighbors here"
    : "Buy and sell with your neighbors here";
  // A3-I2: someone who came only to earn or to shop still has Create (every
  // account posts; never role-based), but "Post a job" read as if they had
  // picked hiring. With picks and none of them hire/sell, word it for themselves.
  const cameToPost = picks.length === 0 || hire || sell;
  const create = cameToPost
    ? (sells ? "Post a job or sell an item" : "Post a job")
    : (sells ? "Need a hand, or selling something? Start here" : "Need a hand yourself? Post a job here");
  // The step for the section they came for comes first (owner 11-14: point new members at Jobs or Declutter by their picks).
  const declutterFirst = sells && (sell || deal) && !earn && !hire;
  const sections: { target: Target; text: string }[] = [{ target: "jobs", text: jobs }];
  if (sells) sections[declutterFirst ? "unshift" : "push"]({ target: "declutter", text: declutter });
  return [
    { target: "home", text: "Home shows what needs you, and what's new near you" },
    ...sections,
    { target: "create", text: create },
    { target: "messages", text: desktop ? "Chats live here. Money and settings are under You" : "Chats live up here. Money and settings are under your photo" },
  ];
}

/** Where the coach card goes for a target's box (exported for the guard). */
export function coachCardPosition(rect: Pick4 | null, vw: number, vh: number): React.CSSProperties {
  const w = Math.min(340, vw - 32);
  if (!rect) return { left: 16, right: 16, bottom: 120 };
  const centred = Math.max(16, Math.min(vw - w - 16, rect.left + rect.width / 2 - w / 2));
  if (rect.top > vh / 2) return { left: centred, width: w, bottom: vh - rect.top + 16 };
  if (rect.right + 16 + 320 <= vw - 16) return { left: rect.right + 16, top: Math.max(16, rect.top + rect.height / 2 - 60), width: 320 };
  return { left: centred, width: w, top: rect.top + rect.height + 16 };
}
type Pick4 = { top: number; left: number; right: number; width: number; height: number };

function findTarget(t: Target): HTMLElement | null {
  for (const sel of TARGETS[t]) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/** The tour's screens. Loaded only when Help asks for it (./TourReplayHost). */
export default function ShortTour({ onDone, userId, paused = false }: { onDone: () => void; userId?: string; paused?: boolean }) {
  const picks = useStartPicks(userId);
  const desktop = useIsWebDesktop();
  const live = useSectionTabs();
  const declutterOpen = !!live.find((t) => t.path === "/declutter")?.on;
  return <CoachMarks steps={tourSteps(picks, declutterOpen, desktop)} onDone={onDone} paused={paused} />;
}

function CoachMarks({ steps, onDone, paused }: { steps: { target: Target; text: string }[]; onDone: () => void; paused: boolean }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];
  const last = i === steps.length - 1;
  const nextRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const measure = () => setRect(findTarget(step.target)?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step.target]);
  useEffect(() => { nextRef.current?.focus(); }, [i]);

  // The card sits above a bottom-dock target, beside a sidebar target, and below a top-row target (the phone's
  // Messages button), always inside the screen with a 16px gutter.
  const pos = useMemo(() => coachCardPosition(rect, window.innerWidth, window.innerHeight), [rect]);

  if (paused) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Quick tour" data-tour="coach" className="fixed inset-0 z-[70]">
      {rect ? (
        <div
          aria-hidden
          data-coach-spotlight
          className="fixed rounded-full pointer-events-none transition-all duration-200"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px hsl(30 10% 10% / 0.55)" }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0" style={{ background: "hsl(30 10% 10% / 0.55)" }} />
      )}
      <div className="fixed rounded-[20px] bg-card p-4 shadow-[0_4px_18px_rgba(32,30,26,0.06)]" style={pos} data-coach-card={step.target}>
        <p className="text-ds-16 font-bold text-foreground" aria-live="polite">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-label={`Step ${i + 1} of ${steps.length}`} role="img">
            {steps.map((s, n) => (
              <span key={s.target} className="h-1.5 rounded-full transition-all" style={{ width: n === i ? 18 : 6, background: n === i ? "hsl(var(--bark))" : "hsl(var(--muted-foreground) / 0.35)" }} />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {!last && (
              <Button type="button" variant="ghost" size="sm" onClick={onDone} className="px-3 font-semibold text-muted-foreground">Skip</Button>
            )}
            <Button
              ref={nextRef}
              type="button"
              variant="primary"
              size="sm"
              onClick={() => (last ? onDone() : setI(i + 1))}
              className="px-5"
            >
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
