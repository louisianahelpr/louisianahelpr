/**
 * /admin/preview/job — the job page at every stage, as a member sees it, for the admin only (owner 2026-11-01:
 * "is there a way I can just test clicking each section of the steps to see each stage of this").
 *
 * It draws the REAL job page (jobPage/JobPage.tsx, the component /jobs/:id draws for a signed-in member), so a change
 * to that page shows here with no change to this file. What it is fed is made up (jobPreviewSamples.ts):
 *  - every Supabase request the page makes is answered from the sample and never sent (previewBackend.ts);
 *  - every write, RPC, payment step and edge-function call is answered "done" without being sent, with a
 *    "Preview: this would …" note;
 *  - every link and navigation inside the page stays here, with the same note.
 * Admin-gated by the route (ProtectedRoute + AdminRoute, the same as /admin). Guard: src/test/adminJobPreviewIsInert.test.tsx.
 */
import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UNSAFE_NavigationContext, useNavigate, useSearchParams, type To } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CHIP, CHIP_OFF, CHIP_ON } from "@/components/ui/chipClasses";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { PREVIEW_STAGES, isPreviewStage, previewSample, type PreviewSample, type PreviewStage, type PreviewViewer } from "./jobPreviewSamples";
import { installPreviewFetch } from "./previewBackend";

// The member's job page itself: the same module /jobs/:id lazy-loads (JobDetail.tsx).
const JobPage = lazy(() => import("@/pages/jobs/jobPage/JobPage"));

const PHONE_WINDOW = "lh-job-preview-phone";

function toText(to: To | number): string {
  if (typeof to === "number") return to < 0 ? "the previous screen" : "the next screen";
  if (typeof to === "string") return to;
  return `${to.pathname ?? ""}${to.search ?? ""}` || "another screen";
}

/** Says what a tap would have done; a burst of the same note shows once. */
function sayWouldHave(what: string) {
  toast(`Preview: this would ${what}.`, { id: `preview-${what}` });
}

/** The page's navigation, kept on this screen: the router's own navigator, with every move turned into a note. */
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

/** The preview backend, in place while this screen is open (previewBackend.ts). Children draw only once it is. */
function PreviewBackend({ sample, children }: { sample: PreviewSample; children: ReactNode }) {
  const { user } = useCurrentUser();
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const ownRef = useRef<string | null>(user?.id ?? null);
  ownRef.current = user?.id ?? null;
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    // A tap in the last two seconds: a write the app makes on its own (a heartbeat) is held back silently.
    let lastGesture = -Infinity;
    const mark = () => { lastGesture = Date.now(); };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    const { uninstall } = installPreviewFetch({
      supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
      sample: () => sampleRef.current,
      ownUserId: () => ownRef.current,
      onBlocked: (what) => { if (Date.now() - lastGesture < 2000) sayWouldHave(what); },
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

function PreviewControls({ stage, viewer, onStage, onViewer, onLeave }: {
  stage: PreviewStage; viewer: PreviewViewer; onStage: (s: PreviewStage) => void; onViewer: (v: PreviewViewer) => void; onLeave: () => void;
}) {
  const [open, setOpen] = useState(true);
  const label = PREVIEW_STAGES.find((s) => s.key === stage)?.label ?? stage;
  const inPhoneWindow = typeof window !== "undefined" && window.name === PHONE_WINDOW;
  const openPhone = () => {
    const w = window.open(window.location.href, PHONE_WINDOW, "popup=yes,width=375,height=812");
    if (!w) toast.error("Your browser blocked the phone window. Allow pop-ups for this site and try again.");
  };
  return createPortal(
    <div
      data-preview-controls=""
      role="region"
      aria-label="Job page preview controls"
      className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-[60] mx-auto max-w-2xl rounded-2xl border border-border bg-card p-3 shadow-lg pointer-events-auto lg:bottom-4 lg:left-[calc(var(--desktop-sidebar-w,0px)+1rem)] lg:right-auto lg:mx-0 lg:w-[34rem]"
    >
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-ds-14 font-semibold">
          Preview: {label} · {viewer === "poster" ? "Poster" : "Helpr"}
        </p>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
          {open ? "Hide" : "Change"}
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="hidden text-ds-13 text-muted-foreground lg:block">
            Made-up job, real job page. Nothing here reads or changes a real job, and no button does anything.
          </p>
          {/* One row that scrolls sideways on a phone, so the page stays in view. */}
          <div role="radiogroup" aria-label="Stage" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
            {PREVIEW_STAGES.map((s) => (
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
              ariaLabel="Seen by"
              className="min-w-0 flex-1"
              value={viewer}
              onChange={onViewer}
              options={[{ value: "poster", label: "Poster" }, { value: "helpr", label: "Helpr" }]}
            />
            {inPhoneWindow ? (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => window.close()}>Close phone window</Button>
            ) : (
              <Button variant="outline" size="sm" className="hidden rounded-full sm:inline-flex" onClick={openPhone}>Phone size (375)</Button>
            )}
            <Button variant="outline" size="sm" className="rounded-full" onClick={onLeave}>Leave</Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

export default function JobPreviewPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const stageParam = params.get("stage");
  const stage: PreviewStage = isPreviewStage(stageParam) ? stageParam : "posted";
  const viewer: PreviewViewer = params.get("viewer") === "helpr" ? "helpr" : "poster";
  const sample = useMemo(() => previewSample(stage, viewer), [stage, viewer]);
  // Its own cache per stage and side: nothing from a real page, and nothing left over from the last stage.
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }), [sample]);
  const set = (next: { stage?: PreviewStage; viewer?: PreviewViewer }) =>
    setParams({ stage: next.stage ?? stage, viewer: next.viewer ?? viewer }, { replace: true });

  return (
    <>
      <PreviewBackend sample={sample}>
        <QueryClientProvider client={client}>
          <InertNavigation>
            <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading job"><JobCardSkeleton /></div>}>
              <JobPage key={`${stage}-${viewer}`} id={sample.jobId} userId={sample.userId} />
            </Suspense>
          </InertNavigation>
        </QueryClientProvider>
      </PreviewBackend>
      <PreviewControls stage={stage} viewer={viewer} onStage={(s) => set({ stage: s })} onViewer={(v) => set({ viewer: v })} onLeave={() => navigate("/admin?view=jobs")} />
    </>
  );
}
