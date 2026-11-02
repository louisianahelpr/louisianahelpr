/**
 * Pieces every admin stage preview shares (the job preview, the Messages preview): the inert navigation, the crash
 * boundary that sits INSIDE the preview backend, the note a blocked tap shows, and the dock that gets out of the
 * way. The Declutter preview (DeclutterPreviewPage.tsx) carries its own copies of the inert navigation and note (B172)
 * and uses this crash boundary.
 */
import { Component, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { UNSAFE_NavigationContext, type To } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { forgetAllBlockReads } from "@/lib/userBlocks";
import { forgetActivityCoresRead } from "@/lib/activityCores";
import { isChunkLoadError, isRecoveryReloadInFlight, recoverFromChunkError } from "@/lib/chunkReload";
import { ChunkRecoveringState } from "@/components/ChunkRecoveringState";

/**
 * The reads app modules share outside React Query (userBlocks' 2-second block read, activityCores' in-flight read),
 * dropped. Called when a preview's backend goes in and again when it comes out (b177 handoff, lead 11-02): nothing a
 * preview answered from its sample carries into the real app, and nothing real is drawn inside the preview.
 */
export function forgetSharedReads(): void {
  forgetAllBlockReads();
  forgetActivityCoresRead();
}

function toText(to: To | number): string {
  if (typeof to === "number") return to < 0 ? "the previous screen" : "the next screen";
  if (typeof to === "string") return to;
  return `${to.pathname ?? ""}${to.search ?? ""}` || "another screen";
}

/** Says what a tap would have done; a burst of the same note shows once. */
export function sayWouldHave(what: string) {
  toast(`Preview: this would ${what}.`, { id: `preview-${what}` });
}

/**
 * The page's navigation, kept on this screen: the router's own navigator, with every move turned into a note.
 * `rewrite` may turn a move WITHIN the previewed page (Messages opening a thread at /messages?chat=...) into one on
 * the preview's own address; every other move stays a note.
 */
export function InertNavigation({ children, rewrite }: { children: ReactNode; rewrite?: (to: To) => To | null }) {
  const outer = useContext(UNSAFE_NavigationContext);
  const rewriteRef = useRef(rewrite);
  rewriteRef.current = rewrite;
  const value = useMemo(() => {
    const move = (how: "push" | "replace") => (to: To, state?: unknown) => {
      const inPreview = rewriteRef.current?.(to) ?? null;
      if (inPreview !== null) outer.navigator[how](inPreview, state);
      else sayWouldHave(`open ${toText(to)}`);
    };
    return {
      ...outer,
      navigator: {
        ...outer.navigator,
        push: move("push"),
        replace: move("replace"),
        go: (n: number) => sayWouldHave(`go to ${toText(n)}`),
      },
    };
  }, [outer]);
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
 * A new stage or side (resetKey) draws again. All three previews (job, Messages, Declutter) use this one boundary.
 */
type PreviewBoundaryState = { error: Error | null; key: string; recovering: boolean };
export class PreviewErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null, key: this.props.resetKey, recovering: false };
  static getDerivedStateFromError(error: Error) { return { error, recovering: isRecoveryReloadInFlight() }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: PreviewBoundaryState) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey, recovering: false };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Q286: a stale chunk mid-deploy is not a crash of the page. While the app's recovery reload is starting or
    // scheduled, this shows the same quiet reloading state as every other boundary, never the crash card.
    if (isRecoveryReloadInFlight()) {
      if (!this.state.recovering) this.setState({ recovering: true });
      return;
    }
    if (isChunkLoadError(error) && recoverFromChunkError()) {
      this.setState({ recovering: true });
      return;
    }
    // Shown on screen below; the console keeps the stack for whoever fixes the page. No report: a report is a
    // backend call the inert preview must never make (errorSurfacesReport PREVIEW_BOUNDARIES).
    console.error("Admin preview: the page crashed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.state.recovering) return <ChunkRecoveringState compact />;
    return (
      <div role="alert" data-preview-crashed="" className="space-y-3 rounded-2xl border border-border bg-card p-4 pb-56">
        <p className="text-ds-15 font-semibold">This stage hit a problem in the preview.</p>
        <p className="break-words text-ds-13 text-muted-foreground">{this.state.error.message || String(this.state.error)}</p>
        <p className="text-ds-13 text-muted-foreground">Nothing was sent. Pick another stage or side, or draw it again.</p>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => this.setState({ error: null, recovering: false })}>Draw it again</Button>
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
      const any = Array.from(document.querySelectorAll("[role=dialog], [role=alertdialog]")).some((d) => !d.closest("[data-preview-controls]"));
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

/** Tailwind's lg breakpoint: from here the dock opens by default (below it, it starts as the small Preview button). */
export const DESKTOP_MIN_WIDTH = 1024;

export const EYE_GLYPH = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z";

const INERT_CHANNEL = Symbol("preview-inert-channel");

/** A realtime channel that never connects: every binding is kept and never fires; subscribe reports SUBSCRIBED. */
function inertChannel(topic: string): unknown {
  const ch: Record<string | symbol, unknown> = {
    [INERT_CHANNEL]: true,
    topic,
    state: "joined",
    on: () => ch,
    subscribe: (cb?: (status: string) => void) => { if (cb) queueMicrotask(() => cb("SUBSCRIBED")); return ch; },
    unsubscribe: async () => "ok",
    send: async () => "ok",
    track: async () => "ok",
    untrack: async () => "ok",
    presenceState: () => ({}),
    // The realtime client's own removal path (should one ever reach it) tears the channel down.
    teardown: () => undefined,
  };
  return ch;
}

/**
 * While a preview is open, a NEW realtime channel (a chat's live thread, presence, reactions) never connects: it
 * would join with the admin's real id and could carry real events (or send presence). Returns the undo. A channel
 * the app opened before the preview (the shared per-user bus) stays; its events name real jobs and people, which
 * never match a preview thread's made-up ids.
 */
export function installInertRealtime(): () => void {
  const client = supabase as unknown as { channel: (...a: unknown[]) => unknown; removeChannel: (c: unknown) => unknown };
  const realChannel = client.channel;
  const realRemove = client.removeChannel;
  const channel = (name: unknown) => inertChannel(String(name));
  const removeChannel = (c: unknown) => ((c as Record<symbol, unknown> | null)?.[INERT_CHANNEL] ? Promise.resolve("ok") : realRemove.call(supabase, c));
  client.channel = channel;
  client.removeChannel = removeChannel;
  return () => {
    if (client.channel === channel) client.channel = realChannel;
    if (client.removeChannel === removeChannel) client.removeChannel = realRemove;
  };
}
