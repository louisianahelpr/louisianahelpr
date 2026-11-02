/**
 * /admin/preview/messages — the Messages page at every state an audit needs (lead 11-02, audit 1102d: no test account
 * has a conversation, so the thread, blocked and reported states could not be walked), for the admin only.
 *
 * It draws the REAL Messages page (pages/messages/Messages.tsx, the component /messages draws), so a change to that
 * page shows here with no change to this file. What it is fed is made up (messagesPreviewSamples.ts):
 *  - every Supabase request the page makes is answered from the sample and never sent (messagesPreviewBackend.ts);
 *  - every write, RPC and edge-function call is answered "done" without being sent, with a "Preview: this would ..."
 *    note; a new realtime channel never connects (installInertRealtime);
 *  - opening a thread stays on this page; every other link and navigation stays here too, with the same note.
 * The interception is installed before the page mounts and held until the route unmounts; a crash in the page is
 * caught inside it (PreviewErrorBoundary). Admin-gated by the route (ProtectedRoute + AdminRoute, the same as /admin).
 * Guard: src/test/adminMessagesPreviewIsInert.test.tsx.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams, type To } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CHIP, CHIP_OFF, CHIP_ON } from "@/components/ui/chipClasses";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import {
  MESSAGES_PREVIEW_STAGES, isMessagesPreviewStage, messagesPreviewSample,
  type MessagesPreviewSample, type MessagesPreviewSide, type MessagesPreviewStage,
} from "./messagesPreviewSamples";
import { installMessagesPreviewFetch, messagesPreviewChecks } from "./messagesPreviewBackend";
import { DESKTOP_MIN_WIDTH, EYE_GLYPH, InertNavigation, PreviewErrorBoundary, PreviewGlyph, forgetSharedReads, installInertRealtime, sayWouldHave, usePageSheetOpen } from "./previewParts";

// The member's Messages page itself: the same module /messages lazy-loads (App.tsx).
const Messages = lazy(() => import("@/pages/messages/Messages"));

const PREVIEW_PATH = "/admin/preview/messages";

/** The preview backend, in place before the page mounts and until this screen unmounts. */
function PreviewBackend({ sample, onAction, children }: { sample: MessagesPreviewSample; onAction: (name: string) => void; children: ReactNode }) {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const { user } = useCurrentUser();
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const ownRef = useRef<string | null>(user?.id ?? null);
  ownRef.current = user?.id ?? null;
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    // Only a write that follows a tap is said; one the app makes on its own (a read receipt) is held back silently.
    let lastGesture = -Infinity;
    const mark = () => { lastGesture = Date.now(); };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    const { uninstall } = installMessagesPreviewFetch({
      supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
      sample: () => sampleRef.current,
      ownUserId: () => ownRef.current,
      onBlocked: (what) => { if (Date.now() - lastGesture < 2000) sayWouldHave(what); },
      onUnlisted: (what) => messagesPreviewChecks.onUnlisted?.(what),
      // After the sheet has taken the answer (its toast, closing), the stage after it is drawn (audit 1102e).
      onAction: (name) => { window.setTimeout(() => onActionRef.current(name), 500); },
    });
    const undoRealtime = installInertRealtime();
    forgetSharedReads();
    setReady(true);
    return () => {
      undoRealtime();
      forgetSharedReads();
      uninstall();
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
      setReady(false);
    };
  }, []);
  // Audit 1102e: a new stage or side drops the shared reads too. The block read is kept 2 s (userBlocks.ts), so "After
  // a block" opened within 2 s of another stage drew that stage's blocks (none), and Eli stayed in the inbox.
  useLayoutEffect(() => {
    forgetSharedReads();
  }, [sample]);
  return ready ? <>{children}</> : null;
}

/** Presses the named controls in order once the page has drawn (the Report sheet stage). Never the preview's own. */
function useOpenOnDraw(labels: string[] | null, key: string) {
  useEffect(() => {
    if (!labels?.length) return;
    let step = 0;
    let tries = 0;
    const t = window.setInterval(() => {
      tries++;
      const name = labels[step];
      const b = Array.from(document.querySelectorAll<HTMLElement>("button, [role='menuitem']"))
        .find((x) => !x.closest("[data-preview-controls]") && (x.getAttribute("aria-label") === name || x.textContent?.trim() === name));
      if (b) {
        // Radix menus open on pointerdown; plain buttons on click.
        b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
        b.click();
        step++;
        if (step >= labels.length) window.clearInterval(t);
      }
      if (tries > 60) window.clearInterval(t);
    }, 150);
    return () => window.clearInterval(t);
  }, [labels, key]);
}

function Controls({ stage, side, onStage, onSide, onLeave }: {
  stage: MessagesPreviewStage; side: MessagesPreviewSide; onStage: (s: MessagesPreviewStage) => void; onSide: (s: MessagesPreviewSide) => void; onLeave: () => void;
}) {
  // Audit 1102e: open, the dock covered the bottom ~185 px of a phone's first screen (Recurring's Cancel job, the
  // composer). Below the desktop width it starts as the small Preview button; a tap opens it.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= DESKTOP_MIN_WIDTH);
  const sheetOpen = usePageSheetOpen();
  const label = MESSAGES_PREVIEW_STAGES.find((s) => s.key === stage)?.label ?? stage;
  if (sheetOpen) return null;
  if (!open) {
    return createPortal(
      <div data-preview-controls="" data-preview-collapsed="" role="region" aria-label="Messages preview controls"
        // Audit 1102e: at the top it sat over the page title (375) and the account avatar (1440). Bottom corner, above
        // the phone's tab bar and Post button (AppShell's 96 px reserve).
        className="fixed right-2 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-[60] pointer-events-auto lg:bottom-4 lg:right-4">
        <Button variant="outline" size="sm" className="rounded-full bg-card shadow-lg" onClick={() => setOpen(true)} aria-expanded={false}>
          <PreviewGlyph d={EYE_GLYPH} className="h-4 w-4 text-primary" />
          Preview
        </Button>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div
      data-preview-controls=""
      role="region"
      aria-label="Messages preview controls"
      className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-[60] mx-auto max-w-2xl rounded-2xl border border-border bg-card p-3 shadow-lg pointer-events-auto lg:bottom-4 lg:left-[calc(var(--desktop-sidebar-w,0px)+1rem)] lg:right-auto lg:mx-0 lg:w-[34rem]"
    >
      <div className="flex items-center gap-2">
        <PreviewGlyph d={EYE_GLYPH} className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-ds-14 font-semibold">
          Preview: {label} · {side === "poster" ? "You posted the jobs" : "You're the Helpr"}
        </p>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen(false)} aria-expanded>
          <PreviewGlyph d="m6 9 6 6 6-6" className="h-4 w-4" />
          Hide
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        <p className="hidden text-ds-13 text-muted-foreground lg:block">
          Made-up people and messages, real Messages page. Nothing here reads or sends a real message.
        </p>
        <div role="radiogroup" aria-label="Stage" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
          {MESSAGES_PREVIEW_STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={s.key === stage}
              className={cn(CHIP, "min-h-9 shrink-0 px-3", s.key === stage ? CHIP_ON : CHIP_OFF)}
              onClick={() => onStage(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Your side"
            className="min-w-0 flex-1"
            value={side}
            onChange={onSide}
            options={[{ value: "poster", label: "Poster" }, { value: "helpr", label: "Helpr" }]}
          />
          <Button variant="outline" size="sm" className="rounded-full" onClick={onLeave}>Leave</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function MessagesPreviewPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const stageParam = params.get("stage");
  const stage: MessagesPreviewStage = isMessagesPreviewStage(stageParam) ? stageParam : "inbox";
  const side: MessagesPreviewSide = params.get("side") === "helpr" ? "helpr" : "poster";
  const me = user?.id ?? "";
  const sample = useMemo(() => messagesPreviewSample(stage, side, me), [stage, side, me]);
  // Its own cache per stage and side: nothing from the real inbox, and nothing left over from the last stage.
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }), [sample]);
  const set = (next: { stage?: MessagesPreviewStage; side?: MessagesPreviewSide }) => {
    const s = messagesPreviewSample(next.stage ?? stage, next.side ?? side, me);
    const q: Record<string, string> = { stage: s.stage, side: s.side };
    if (s.openThread) Object.assign(q, { jobId: s.openThread.jobId, userId: s.openThread.userId });
    setParams(q, { replace: true });
  };
  // The thread a stage opens is the page's own deep link (?jobId=&userId=), read once as it mounts.
  useEffect(() => {
    if (sample.openThread && params.get("jobId") !== sample.openThread.jobId) set({});
    // Only when the stage asks for a thread the address does not carry yet.
  }, [sample]);
  // Messages moving within itself (a thread opened, back to the list) stays on this address, with the preview's own keys.
  const rewrite = (to: To): To | null => {
    const path = typeof to === "string" ? to : `${to.pathname ?? ""}${to.search ?? ""}`;
    // A bare "?..." (setSearchParams) moves within the page itself.
    const u = new URL(path.startsWith("?") ? `/messages${path}` : path, "https://preview.invalid");
    if (u.pathname !== "/messages") return null;
    u.searchParams.set("stage", stage);
    u.searchParams.set("side", side);
    return `${PREVIEW_PATH}?${u.searchParams.toString()}`;
  };
  useOpenOnDraw(sample.opens, `${stage}-${side}`);
  // Drawn once the address carries the stage's thread, and kept drawn while the page moves within itself (a thread
  // closed back to the list drops ?jobId=); a new stage or side waits for its own address again.
  const viewKey = `${stage}-${side}`;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const addressReady = !sample.openThread || params.get("jobId") === sample.openThread.jobId;
  useEffect(() => {
    if (addressReady && readyKey !== viewKey) setReadyKey(viewKey);
  }, [addressReady, readyKey, viewKey]);
  const ready = readyKey === viewKey;

  return (
    <PreviewBackend sample={sample} onAction={(name) => { if (name === "block_user_and_settle") set({ stage: "blocked" }); }}>
      <QueryClientProvider client={client}>
        <InertNavigation rewrite={rewrite}>
          <PreviewErrorBoundary resetKey={`${stage}-${side}`}>
            <div data-preview-view={`${stage}:${side}`}>
              {me && ready && (
                <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading messages" />}>
                  <Messages key={`${stage}-${side}`} />
                </Suspense>
              )}
            </div>
          </PreviewErrorBoundary>
        </InertNavigation>
      </QueryClientProvider>
      <PreviewErrorBoundary resetKey="controls">
        <Controls stage={stage} side={side} onStage={(s) => set({ stage: s })} onSide={(s) => set({ side: s })} onLeave={() => navigate("/admin?view=reports")} />
      </PreviewErrorBoundary>
    </PreviewBackend>
  );
}
