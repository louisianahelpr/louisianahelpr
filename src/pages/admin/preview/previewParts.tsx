/**
 * Pieces every admin stage preview shares (the job preview, the Messages preview): the inert navigation, the crash
 * boundary that sits INSIDE the preview backend, the note a blocked tap shows, and the dock that gets out of the
 * way. The Declutter preview (DeclutterPreviewPage.tsx) carries its own copies of the first three (B172).
 */
import { Component, useContext, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { UNSAFE_NavigationContext, type To } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

function toText(to: To | number): string {
  if (typeof to === "number") return to < 0 ? "the previous screen" : "the next screen";
  if (typeof to === "string") return to;
  return `${to.pathname ?? ""}${to.search ?? ""}` || "another screen";
}

/** Says what a tap would have done; a burst of the same note shows once. */
export function sayWouldHave(what: string) {
  toast(`Preview: this would ${what}.`, { id: `preview-${what}` });
}

/** The page's navigation, kept on this screen: the router's own navigator, with every move turned into a note. */
export function InertNavigation({ children }: { children: ReactNode }) {
  const outer = useContext(UNSAFE_NavigationContext);
  const value = useMemo(() => ({
    ...outer,
    navigator: {
      ...outer.navigator,
      push: (to: To) => sayWouldHave(`open ${toText(to)}`),
      replace: (to: To) => sayWouldHave(`open ${toText(to)}`),
      go: (n: number) => sayWouldHave(`go to ${toText(n)}`),
    },
  }), [outer]);
  // A plain <a href> (or a router Link, which yields to an earlier preventDefault) is caught before it leaves.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || a.closest("[data-preview-controls]")) return;
      e.preventDefault();
      sayWouldHave(`open ${a.getAttribute("href")}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return <UNSAFE_NavigationContext.Provider value={value}>{children}</UNSAFE_NavigationContext.Provider>;
}

/**
 * A crash inside the previewed page must never reach the route's error boundary: that one unmounts the preview
 * backend, which puts the window's own fetch back, so the page would read PROD and its "Go Home" would navigate for
 * real (Declutter audit 1102c P2). This sits INSIDE the backend and the inert navigation; its fallback has no link.
 * A new stage or side (resetKey) draws again.
 */
export class PreviewErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state: { error: Error | null; key: string } = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Shown on screen below; the console keeps the stack for whoever fixes the page.
    console.error("Admin preview: the page crashed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" data-preview-crashed="" className="space-y-3 rounded-2xl border border-border bg-card p-4 pb-56">
        <p className="text-ds-15 font-semibold">This stage hit a problem in the preview.</p>
        <p className="break-words text-ds-13 text-muted-foreground">{this.state.error.message || String(this.state.error)}</p>
        <p className="text-ds-13 text-muted-foreground">Nothing was sent. Pick another stage or side, or draw it again.</p>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => this.setState({ error: null })}>Draw it again</Button>
      </div>
    );
  }
}

/**
 * Whether one of the page's own sheets or pop-ups is open (Q2617: the dock sat above every sheet, and at 375 it
 * covered each sheet's second button). The dock steps aside while one is.
 */
export function usePageSheetOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const read = () => {
      const any = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some((d) => !d.closest("[data-preview-controls]"));
      setOpen((was) => (was === any ? was : any));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return open;
}

/**
 * The preview's three marks (eye, chevron down/up), drawn inline instead of from lucide-react (B111, 11-01): a new
 * importer of lucide icons regroups the entriesAware icon chunks, and the extra group was named in the entry's preload
 * lists (entry 5363 -> 5383 B gz, over budget; ~/.lh-shots/b111/cp-prev1.log). Same 24-unit stroke style as lucide.
 */
export function PreviewGlyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const EYE_GLYPH = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z";
