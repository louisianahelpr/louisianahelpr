import { useEffect, useRef, type ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";
import { declutterRows } from "./constants";
import type { Row } from "./types";

/**
 * The "Declutter" group on the Notifications screen (owner 2026-10-28, via the
 * lead: "Yes, build them"): one switch per declutter_* notification kind
 * (migration 20261028162048). Shown only to a member who has Declutter, and
 * every row, Wanted matches included: it also governs saved Declutter searches (Q2464), so it shows even while
 * Wanted is off for them. Its own component
 * so the switch reads happen only where the group can show.
 */
/** How long, and how often, the ?show=declutter scroll follows the group while the rows above it load (Q2566). */
const FOLLOW_MS = 6000;
const FOLLOW_EVERY_MS = 150;

/** The element's distance from the top of its scrolling page: unchanged by scrolling, changed by content above it. */
function pagePosition(el: HTMLElement): number {
  let scroller: HTMLElement | null = el.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  const top = el.getBoundingClientRect().top;
  return scroller ? top - scroller.getBoundingClientRect().top + scroller.scrollTop : top + window.scrollY;
}

export function DeclutterNotificationGroup({ renderRow }: { renderRow: (row: Row) => ReactNode }) {
  const declutterOn = useFeature("declutter");
  const heading = useRef<HTMLDivElement>(null);
  // Declutter settings' Notifications row links here with ?show=declutter: open at this group, not the top of the screen.
  // Q2566 (Auditor 1, audit 1102a): one scroll when the switch read landed was not enough, because the rows ABOVE
  // this group (job reminders, the text alerts card) load afterwards and pushed it ~1500 px down, leaving the member
  // in the middle of the job reminders. So the group is followed: while it keeps moving down the page (its position
  // in the page, not on screen), it is scrolled to again, for up to FOLLOW_MS, and never after the member touches,
  // scrolls with a wheel or presses a key (their own scroll always wins).
  useEffect(() => {
    if (!declutterOn || new URLSearchParams(window.location.search).get("show") !== "declutter") return;
    const el = heading.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
    let last = pagePosition(el);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const now = pagePosition(el);
      if (Math.abs(now - last) > 2) el.scrollIntoView?.({ block: "start", behavior: "auto" });
      last = now;
      if (Date.now() - started > FOLLOW_MS) stop();
    }, FOLLOW_EVERY_MS);
    const userMoved = () => stop();
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    function stop() {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, userMoved, true);
    }
    for (const e of events) window.addEventListener(e, userMoved, { capture: true, passive: true });
    return stop;
  }, [declutterOn]);
  if (!declutterOn) return null;
  return (
    <>
      <div
        ref={heading}
        className="px-3 min-[360px]:px-4 pt-3 pb-1.5 shrink-0"
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
        data-testid="declutter-notification-group"
      >
        <h3 className="font-sans font-semibold text-ds-13 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
          Declutter
        </h3>
        <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Buying and selling your things. Everything still lands in the bell icon.
        </p>
      </div>
      {declutterRows.map((r) => renderRow(r))}
    </>
  );
}
