import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import type { SectionKey } from "@/components/sections/sectionsConfig";

/**
 * FIRST RUN (board 53) + THE SHORT TOUR (owner 2026-10-20; replaces the old
 * 7-step OnboardingTour).
 *
 * 1. "What brings you to Helpr?": multi-select cards covering both sides. The
 *    picks ONLY reorder Home's sections (useSectionPrefs.putFirst); nothing is
 *    locked, and Skip is always top right. Only open sections are offered.
 * 2. Three or four coach marks on the REAL chrome (the bottom bar on a phone,
 *    the sidebar on desktop), worded for the picks: one line, dots, Skip and
 *    Next, "Done" on the last. Olive actions, sentence case, no rust.
 * Seen state: firstRunGate (the old tour's account column + device key), held by
 * ./FirstRunHost, which loads these screens only when the gate opens.
 * Replay: /home?tour=1 (Help's "Take the tour again") runs step 2 again.
 */

type Pick = "hire" | "earn" | "sell" | "deal";
export const FIRST_RUN_OPTIONS: { id: Pick; title: string; sub: string; section: SectionKey }[] = [
  { id: "hire", title: "Get help with a job", sub: "Yard, cleaning, moving, assembly and more", section: "jobs" },
  { id: "earn", title: "Earn by helping neighbors", sub: "Pick up jobs near you", section: "jobs" },
  { id: "sell", title: "Sell things I don't need", sub: "List an item for neighbors to buy", section: "declutter" },
  { id: "deal", title: "Find a good deal", sub: "Local items from your neighbors", section: "declutter" },
];

/** Where each coach mark points: the phone dock first, then the desktop sidebar. */
const TARGETS = {
  home: ['nav[aria-label="Bottom navigation"] button[aria-label="Home"]', '[data-sidebar-item="/home"]'],
  create: ['[aria-label="Create"]', '[data-testid="sidebar-create"]'],
  explore: ['nav[aria-label="Bottom navigation"] button[aria-label="Explore"]', '[data-sidebar-item="/explore"]'],
  messages: ['nav[aria-label="Bottom navigation"] button[aria-label="Messages"]', '[data-sidebar-item="/messages"]'],
} as const;
type Target = keyof typeof TARGETS;

export function tourSteps(picks: Pick[], declutterOpen: boolean): { target: Target; text: string }[] {
  const sells = declutterOpen;
  const explore =
    picks.includes("earn") && picks.includes("deal") && declutterOpen ? "Find jobs and deals near you"
    : picks.includes("earn") ? "Find jobs near you"
    : picks.includes("deal") && declutterOpen ? "Find deals near you"
    : sells ? "Browse jobs and deals near you" : "Browse jobs near you";
  // A3-I2: someone who came only to earn or to shop still has Create (every
  // account posts; never role-based), but "Post a job" read as if they had
  // picked hiring. With picks and none of them hire/sell, word it for themselves.
  const cameToPost = picks.length === 0 || picks.includes("hire") || picks.includes("sell");
  const create = cameToPost
    ? (sells ? "Post a job or sell an item" : "Post a job")
    : (sells ? "Need a hand, or selling something? Start here" : "Need a hand yourself? Post a job here");
  return [
    { target: "home", text: "Home shows what needs you" },
    { target: "create", text: create },
    { target: "explore", text: explore },
    { target: "messages", text: "Chats live here. Money and settings are under You" },
  ];
}

function findTarget(t: Target): HTMLElement | null {
  for (const sel of TARGETS[t]) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/** The first run's screens. Loaded only when the gate opens (./FirstRunHost holds the gate). */
export default function FirstRunScreens({ startInTour, onDone }: { startInTour: boolean; onDone: () => void }) {
  const [phase, setPhase] = useState<"pick" | "tour">(startInTour ? "tour" : "pick");
  const [picks, setPicks] = useState<Pick[]>([]);
  const live = useSectionTabs();
  const { putFirst } = useSectionPrefs();
  const declutterOpen = !!live.find((t) => t.path === "/declutter")?.on;
  const options = FIRST_RUN_OPTIONS.filter((o) => o.section === "jobs" || declutterOpen);

  if (phase === "pick") {
    return (
      <FirstRunPicker
        options={options}
        picks={picks}
        onToggle={(id) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
        onSkip={() => setPhase("tour")}
        onContinue={() => {
          putFirst(FIRST_RUN_OPTIONS.filter((o) => picks.includes(o.id)).map((o) => o.section));
          setPhase("tour");
        }}
      />
    );
  }
  return <CoachMarks steps={tourSteps(picks, declutterOpen)} onDone={onDone} />;
}

function FirstRunPicker({ options, picks, onToggle, onSkip, onContinue }: {
  options: typeof FIRST_RUN_OPTIONS; picks: Pick[]; onToggle: (id: Pick) => void; onSkip: () => void; onContinue: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="first-run-title" data-first-run="pick" className="fixed inset-0 z-[70] flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[480px] px-5 pt-[calc(var(--safe-area-top,0px)+12px)] pb-6">
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={onSkip} className="px-2 text-ds-15" style={{ color: "hsl(var(--bark))" }}>Skip</Button>
          </div>
          <h1 id="first-run-title" ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="font-moment text-page-title text-foreground mt-2">
            What brings you to Helpr?
          </h1>
          <p className="text-ds-14 text-muted-foreground mt-1">Pick any. You can do all of it with one account.</p>
          <ul className="mt-4 flex flex-col gap-3">
            {options.map((o) => {
              const on = picks.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => onToggle(o.id)}
                    data-first-run-option={o.id}
                    className="btn-press w-full flex items-center gap-3 rounded-[20px] bg-card px-4 py-3.5 text-left min-h-[64px] transition-colors"
                    style={{ border: `1px solid hsl(var(${on ? "--bark" : "--border"}))`, boxShadow: on ? "inset 0 0 0 1px hsl(var(--bark))" : undefined }}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-ds-16 font-bold text-foreground">{o.title}</span>
                      <span className="block text-ds-13 text-muted-foreground">{o.sub}</span>
                    </span>
                    <span
                      aria-hidden
                      className="shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center"
                      style={on ? { background: "hsl(var(--bark))" } : { border: "1.5px solid hsl(var(--border))" }}
                    >
                      {on && <Check className="w-3 h-3" style={{ color: "hsl(var(--primary-foreground))" }} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-ds-13 text-muted-foreground mt-3">This only sets what you see first on Home. Nothing is locked.</p>
        </div>
      </div>
      <div className="border-t border-border bg-background px-5 pt-3 pb-[max(1rem,var(--safe-area-bottom,0px))]">
        <div className="mx-auto w-full max-w-[480px]">
          <Button type="button" variant="primary" onClick={onContinue} className="w-full">
            Continue
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CoachMarks({ steps, onDone }: { steps: { target: Target; text: string }[]; onDone: () => void }) {
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

  // The card sits above a bottom-dock target and beside a sidebar target.
  const pos = useMemo(() => {
    if (!rect) return { left: 16, right: 16, bottom: 120 } as React.CSSProperties;
    const vw = window.innerWidth;
    if (rect.top > window.innerHeight / 2) {
      const w = Math.min(340, vw - 32);
      const left = Math.max(16, Math.min(vw - w - 16, rect.left + rect.width / 2 - w / 2));
      return { left, width: w, bottom: window.innerHeight - rect.top + 16 } as React.CSSProperties;
    }
    return { left: rect.right + 16, top: Math.max(16, rect.top + rect.height / 2 - 60), width: 320 } as React.CSSProperties;
  }, [rect]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Quick tour" data-first-run="tour" className="fixed inset-0 z-[70]">
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
