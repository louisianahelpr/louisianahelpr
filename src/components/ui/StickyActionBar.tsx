/**
 * THE sticky action bar (design audit 11-08 B §4.5 StickyActionBar; owner pick 1, 11-08): a screen's one or two
 * main actions, always in thumb reach. Item page (Make offer / Buy now), checkout, sell. Jobs and Dashboard reuse it.
 *
 * - Phone (under 640 px): fixed on the bottom edge, portaled to <body> (a fixed bar inside the page would be placed by
 *   a transformed ancestor), surface background, hairline top, safe-area padding. The dock yields the strip to it
 *   (useDockYield, Q1646), and an in-flow spacer of the bar's height keeps the page's last line clear of it.
 * - Wider: the same buttons sit in the page where the bar is placed, in one row; nothing is fixed (a desktop has room).
 *
 * The children render ONCE, in whichever place applies, so a screen reader and a test see one set of buttons.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDockYield } from "@/components/mobileNav/useDockYield";

const PHONE_QUERY = "(max-width: 639px)";

function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PHONE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia?.(PHONE_QUERY);
    if (!mql) return;
    const onChange = () => setPhone(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return phone;
}

/** The phone bar's height above the safe area (48 px buttons + 8 px padding top and bottom), for the spacer. */
const BAR_BODY_PX = 64;

/** The in-flow room the phone bar covers, for a page that places the bar inside a card (spacer={false}). */
export function StickyActionSpacer({ className = "" }: { className?: string }) {
  return <div aria-hidden data-sticky-action-spacer="" className={className} style={{ height: `calc(${BAR_BODY_PX}px + var(--safe-area-bottom, 0px))` }} />;
}

export function StickyActionBar({ children, label, note, active = true, spacer = true, ...rest }: {
  /** The buttons, primary LAST (right) as on Vinted / Mercari: secondary first, then the one filled primary. */
  children: ReactNode;
  /** The group's accessible name ("Buy or make an offer"). */
  label: string;
  /** One small line under the buttons (a fee note), or nothing. */
  note?: ReactNode;
  /** False hides the bar (and gives the dock back). */
  active?: boolean;
  /** False when the page draws its own StickyActionSpacer at its end (the bar sits inside a card: the job page). */
  spacer?: boolean;
} & Record<`data-${string}`, string | undefined>) {
  const phone = usePhoneWidth();
  useDockYield(active && phone);
  if (!active) return null;
  const row = (
    <div role="group" aria-label={label} className="mx-auto flex w-full max-w-xl gap-2 [&>*]:min-w-0 [&>*]:flex-1">
      {children}
    </div>
  );
  if (!phone) {
    return (
      <div {...rest} data-sticky-action-bar="inline" className="space-y-1">
        {row}
        {note}
      </div>
    );
  }
  return (
    <>
      {spacer && <StickyActionSpacer />}
      {typeof document !== "undefined" && createPortal(
        <div
          {...rest}
          data-sticky-action-bar="fixed"
          data-rail-inset=""
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 pt-2 pb-[calc(var(--safe-area-bottom,0px)+0.5rem)]"
        >
          {row}
          {note}
        </div>,
        document.body,
      )}
    </>
  );
}
