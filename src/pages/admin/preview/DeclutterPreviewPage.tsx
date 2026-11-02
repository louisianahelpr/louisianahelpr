/**
 * /admin/preview/declutter — Q2585 (Auditor 1, audit 1102a): every Declutter order stage, on either side, as a member
 * sees it, for the admin only. Prod has almost no Declutter orders, so audits could not walk paid, booked, each
 * handover, handed over, refund, problem, haul-away or donation read-only; this draws them on made-up data.
 *
 * It draws the REAL Buying and Selling views (BuyingDash / SellingDash, the components the Declutter tabs draw), so a
 * change to them shows here with no change to this file. What they are fed is made up (declutterPreviewSamples.ts):
 *  - every Supabase request is answered from the sample and never sent (declutterPreviewBackend.ts, deny by default);
 *  - every write, RPC and function call is answered without being sent, with a "Preview: this would ..." note;
 *  - every link and navigation inside the views stays here, with the same note.
 * The stage and side are in the address (?stage=booked&side=seller), so an audit opens any of them at 375 and 1440
 * directly; "Phone window" opens the same address in a 375-wide window.
 * Admin-gated by the route (ProtectedRoute + AdminRoute, the same as /admin). Guard: src/test/adminDeclutterPreviewIsInert.test.ts.
 */
import { Component, lazy, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UNSAFE_NavigationContext, useSearchParams, type To } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";
import { BuyingDash, SellingDash } from "@/components/declutter/DeclutterMineViews";
// Loaded on demand, never statically: a static import from this admin route made DeclutterHomeView a chunk of its own
// (shared by two lazy routes), which put ~1.8 KB gz more on /declutter's critical path (Q178 budget, train 2 11-02).
// The dynamic import resolves to the chunk /declutter already has.
const MyListingsView = lazy(() => import("@/components/declutter/DeclutterHomeView").then((m) => ({ default: m.MyListingsView })));
import {
  DECLUTTER_PREVIEW_STAGES, declutterPreviewSample, isDeclutterPreviewStage,
  type DeclutterPreviewSample, type DeclutterPreviewSide, type DeclutterPreviewStage,
} from "./declutterPreviewSamples";
import { declutterPreviewChecks, installDeclutterPreviewFetch } from "./declutterPreviewBackend";

const PHONE_WINDOW = "lh-declutter-preview-phone";

function sayWouldHave(what: string) {
  toast(`Preview: this would ${what}.`, { id: `preview-${what}` });
}

function toText(to: To | number): string {
  if (typeof to === "number") return to < 0 ? "the previous screen" : "the next screen";
  if (typeof to === "string") return to;
  return `${to.pathname ?? ""}${to.search ?? ""}` || "another screen";
}

/** The views' navigation, kept on this screen: every move becomes a note. */
function InertNavigation({ children }: { children: ReactNode }) {
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

/** The preview backend, in place while this screen is open. Children draw only once it is. */
function PreviewBackend({ sample, children }: { sample: DeclutterPreviewSample; children: ReactNode }) {
  const { user } = useCurrentUser();
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const ownRef = useRef<string | null>(user?.id ?? null);
  ownRef.current = user?.id ?? null;
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    // Only a write that follows a tap is said; one the app makes on its own (a heartbeat) is held back silently.
    let lastGesture = -Infinity;
    const mark = () => { lastGesture = Date.now(); };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    const { uninstall } = installDeclutterPreviewFetch({
      supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
      sample: () => sampleRef.current,
      ownUserId: () => ownRef.current,
      onBlocked: (what) => { if (Date.now() - lastGesture < 2000) sayWouldHave(what); },
      onUnlisted: (what) => declutterPreviewChecks.onUnlisted?.(what),
    });
    setReady(true);
    return () => {
      uninstall();
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
      setReady(false);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

/**
 * Audit 1102c P2: a crash inside the views must never reach the route's error boundary. That one unmounted
 * PreviewBackend, which put the window's own fetch back, so the page read PROD, and its "Go Home" navigated for real.
 * This boundary sits INSIDE the backend and the inert navigation, so the fetch layer stays in place and the
 * fallback has no link or navigation of its own. A new stage or side (resetKey) draws again.
 */
class PreviewErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state: { error: Error | null; key: string } = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Shown on screen below; the console keeps the stack for whoever fixes the view.
    console.error("Declutter preview: a view crashed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" data-preview-crashed="" className="space-y-3 rounded-2xl border border-border bg-card p-4 pb-56">
        <p className="text-ds-15 font-semibold">This stage hit a problem in the preview.</p>
        <p className="break-words text-ds-13 text-muted-foreground">{this.state.error.message || String(this.state.error)}</p>
        <p className="text-ds-13 text-muted-foreground">Nothing was sent. Pick another stage or side below, or draw it again.</p>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => this.setState({ error: null })}>Draw it again</Button>
      </div>
    );
  }
}

function Controls({ stage, side, onStage, onSide }: {
  stage: DeclutterPreviewStage; side: DeclutterPreviewSide; onStage: (s: DeclutterPreviewStage) => void; onSide: (s: DeclutterPreviewSide) => void;
}) {
  const openPhone = () => {
    const w = window.open(window.location.href, PHONE_WINDOW, "popup=yes,width=375,height=812");
    if (!w) toast.error("Your browser blocked the phone window. Allow pop-ups for this site and try again.");
  };
  return createPortal(
    <div data-preview-controls="" role="region" aria-label="Declutter preview controls"
      className="pointer-events-auto fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] mx-auto max-w-2xl space-y-2 rounded-2xl border border-border bg-card p-3 shadow-lg lg:bottom-4">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-ds-14 font-semibold">Declutter preview · made-up data, nothing is saved</p>
        {typeof window !== "undefined" && window.name !== PHONE_WINDOW && (
          <Button type="button" size="sm" variant="outline" className="shrink-0 rounded-full" onClick={openPhone}>Phone window</Button>
        )}
      </div>
      <div role="radiogroup" aria-label="Side" className="flex gap-2">
        {(["buyer", "seller"] as const).map((s) => (
          <ChoicePill key={s} selected={side === s} data-preview-side={s} onClick={() => onSide(s)}>{s === "buyer" ? "Buyer" : "Seller"}</ChoicePill>
        ))}
      </div>
      <div role="radiogroup" aria-label="Order stage" className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {DECLUTTER_PREVIEW_STAGES.map((s) => (
          <ChoicePill key={s.key} selected={stage === s.key} data-preview-stage={s.key} onClick={() => onStage(s.key)} className="px-3">{s.label}</ChoicePill>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Every Declutter switch on, so the views draw as they do for a member who has Declutter. */
function previewClient(userId: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
  qc.setQueryData(featureSwitchBatchKey(userId), Object.fromEntries(FEATURE_SWITCH_KEYS.map((k) => [k, true])));
  return qc;
}

function Views({ sample }: { sample: DeclutterPreviewSample }) {
  // A fresh cache per stage and side: the sample never mixes with the app's own cache or another stage's.
  const qc = useMemo(() => previewClient(sample.userId), [sample]);
  return (
    <QueryClientProvider client={qc}>
      <div data-preview-view={`${sample.stage}:${sample.side}`} className="space-y-6 pb-56">
        {sample.side === "buyer"
          ? <BuyingDash todo={null} />
          : <SellingDash todo={null} userId={sample.userId} listings={<Suspense fallback={null}><MyListingsView userId={sample.userId} haulOn /></Suspense>} />}
      </div>
    </QueryClientProvider>
  );
}

export default function DeclutterPreviewPage() {
  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const rawStage = params.get("stage");
  const stage: DeclutterPreviewStage = isDeclutterPreviewStage(rawStage) ? rawStage : "paid";
  const side: DeclutterPreviewSide = params.get("side") === "seller" ? "seller" : "buyer";
  const userId = user?.id ?? null;
  const sample = useMemo(() => (userId ? declutterPreviewSample(stage, side, userId) : null), [stage, side, userId]);
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n; }, { replace: true });
  if (!sample) return null;
  const label = DECLUTTER_PREVIEW_STAGES.find((s) => s.key === stage)?.label ?? stage;
  return (
    <AppPage title={`Declutter preview: ${label}, ${side === "buyer" ? "buyer" : "seller"}`} backTo="/admin?tab=settings">
      {/* The backend wraps everything the page draws, the controls too, and stays in place until the route unmounts. */}
      <PreviewBackend sample={sample}>
        <InertNavigation>
          <PreviewErrorBoundary resetKey={`${stage}:${side}`}>
            <Views key={`${stage}:${side}`} sample={sample} />
          </PreviewErrorBoundary>
        </InertNavigation>
        <PreviewErrorBoundary resetKey="controls">
          <Controls stage={stage} side={side} onStage={(s) => set("stage", s)} onSide={(s) => set("side", s)} />
        </PreviewErrorBoundary>
      </PreviewBackend>
    </AppPage>
  );
}
