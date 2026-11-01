import { useId, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BackButton from "@/components/BackButton";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

/**
 * THE ONE PAGE HEADER ROW (owner, 2026-10-21): back arrow, page title, page
 * actions. On the DESKTOP WEBSITE it is drawn INSIDE the global top bar
 * (DesktopTopNav), title on the left level with the bell and photo, the page's
 * actions immediately left of the bell, so a page never adds a second row under
 * the bar. On a phone (and native) it is the page's own single row.
 *
 * Every signed-in page header goes through here: PageHeader (every sub-screen,
 * Profile tab and AppPage) and AppTopBar (the sections). Guard:
 * src/test/oneHeaderRow.test.ts.
 *
 * The slot is a DOM node DesktopTopNav registers; a page portals into it. With
 * no slot (phone, native, a route without the desktop bar) the row renders in
 * place, so nothing is ever lost.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** DesktopTopNav's ref callback for its left area. */
export function registerDesktopTitleSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  listeners.forEach((l) => l());
}

/*
 * Only the FIRST mounted title bar goes up into the desktop bar. A screen opened
 * on top of a page (Applicants over Jobs) draws its own back + title row at the
 * top of its own content, under the bar (owner, 2026-10-28: "applicants and back
 * arrow go under jobs"; two titles side by side squeezed the page's "+" and gear
 * into the middle, and the overlay covered the bar so its back arrow could not be
 * clicked).
 */
let mounted: string[] = [];
const stackListeners = new Set<() => void>();
function useIsFirstTitleBar(id: string): boolean {
  useLayoutEffect(() => {
    mounted = [...mounted, id];
    stackListeners.forEach((l) => l());
    return () => {
      mounted = mounted.filter((m) => m !== id);
      stackListeners.forEach((l) => l());
    };
  }, [id]);
  return useSyncExternalStore(
    (l) => {
      stackListeners.add(l);
      return () => stackListeners.delete(l);
    },
    () => mounted.length === 0 || mounted[0] === id,
    () => true,
  );
}

function useDesktopTitleSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slot,
    () => null,
  );
}

export interface PageTitleBarProps {
  /** The page title, the one `h1`. */
  title: ReactNode;
  /** A back arrow before the title (sub-screens). */
  back?: { onBack?: () => void; backTo?: string };
  /** Page actions ("+", gear, menus): on desktop right before the bell and photo. */
  actions?: ReactNode;
  /** The page's own row on a phone / native / a route without the desktop bar, unchanged. */
  phone: ReactNode;
  /**
   * Desktop: the shell's gap between the bar and the page's first content.
   * False where the page sits in PageScaffold's title card, which pads itself.
   */
  desktopGap?: boolean;
  /** A MOMENT title (Home's greeting; same face as every title since 2026-10-25). */
  moment?: boolean;
  /**
   * Desktop: the h1 stays for screen readers but is not painted, because the page paints its own title in its body
   * (the Declutter item page, owner mockup 11-01: the title with Save and Share in the right column). Back and the
   * actions stay in the bar.
   */
  titleHidden?: boolean;
}

/** The desktop bar's row: back, title, then the actions pushed right. */
function DesktopRow({ title, back, actions, moment, titleHidden }: Pick<PageTitleBarProps, "title" | "back" | "actions" | "moment" | "titleHidden">) {
  return (
    <div className="flex items-center gap-3 min-w-0 w-full" data-page-title-row="">
      {back && (
        <div className="shrink-0">
          <BackButton onClick={back.onBack} to={back.backTo} />
        </div>
      )}
      <h1 className={`${moment ? "font-moment " : ""}text-page-title leading-tight min-w-0 truncate text-foreground${titleHidden ? " sr-only" : ""}`}>{title}</h1>
      {actions && <div className="ml-auto flex items-center gap-1.5 shrink-0 pr-1">{actions}</div>}
    </div>
  );
}

/** True while page headers are drawn in the desktop bar (a page drops its own top inset). */
export function useHeaderInDesktopBar(): boolean {
  const isWebDesktop = useIsWebDesktop();
  const target = useDesktopTitleSlot();
  return isWebDesktop && !!target;
}

export function PageTitleBar({ title, back, actions, phone, desktopGap = true, moment = false, titleHidden = false }: PageTitleBarProps) {
  const isWebDesktop = useIsWebDesktop();
  const target = useDesktopTitleSlot();
  const first = useIsFirstTitleBar(useId());
  if (isWebDesktop && target && !first) {
    // A screen on top of a page: its own row, under the bar, inside the screen.
    return (
      <div className="pt-5 pb-5" data-page-title-nested="">
        <DesktopRow title={title} back={back} actions={actions} moment={moment} titleHidden={titleHidden} />
      </div>
    );
  }
  if (isWebDesktop && target) {
    return (
      <>
        {createPortal(<DesktopRow title={title} back={back} actions={actions} moment={moment} titleHidden={titleHidden} />, target)}
        {/* The ONE gap between the bar and a page's first content, every page: 8px under the 70px bar, so a
            section's tabs row is level with the rail's Create (src/lib/desktopBar.ts). */}
        {desktopGap && <div aria-hidden className="h-2 shrink-0" data-page-title-gap="" />}
      </>
    );
  }
  return <>{phone}</>;
}
