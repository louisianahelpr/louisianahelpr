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
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CHIP, CHIP_OFF, CHIP_ON } from "@/components/ui/chipClasses";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { PREVIEW_STAGES, isPreviewStage, previewSample, type PreviewSample, type PreviewStage, type PreviewViewer } from "./jobPreviewSamples";
import { installPreviewFetch, jobPreviewChecks } from "./previewBackend";
import { EYE_GLYPH, InertNavigation, PreviewErrorBoundary, PreviewGlyph, forgetSharedReads, installInertRealtime, sayWouldHave, usePageSheetOpen } from "./previewParts";

// The member's job page itself: the same module /jobs/:id lazy-loads (JobDetail.tsx).
const JobPage = lazy(() => import("@/pages/jobs/jobPage/JobPage"));
// The Helpr's own Working card (Jobs > Working), whose "Cancel job" opens the Helpr's cancel sheet (helper_cancel_booking).
// That sheet lives on the card, not on the job page (b177 handoff), so the Cancel sheet stage draws the card for the Helpr.
const ConfirmedSection = lazy(() => import("@/pages/jobs/appliedJobCard/ConfirmedSection").then((m) => ({ default: m.ConfirmedSection })));

/** The Helpr's Working card for the sample's job, as Jobs > Working draws it for a hired Helpr. */
function HelprWorkingCard({ sample }: { sample: PreviewSample }) {
  // Inside InertNavigation: every move the card makes (Message, after a cancel) stays here as a note.
  const navigate = useNavigate();
  const poster = sample.profiles.find((p) => p.id === sample.job.customer_id)?.full_name ?? null;
  const job = sample.job as unknown as Job;
  const app = { id: `${sample.jobId}-app`, job_id: sample.jobId, helper_id: sample.userId, status: "accepted", created_at: sample.job.helper_confirmed_at ?? null, job, posterName: poster } as unknown as AppliedApp;
  return (
    <div className="space-y-3 p-4 pb-56" data-preview-working-card="">
      <p className="text-ds-13 text-muted-foreground">Jobs › Working: the Helpr's card for this job</p>
      <h1 className="text-ds-18 font-semibold">{sample.job.title}</h1>
      <ConfirmedSection app={app} job={job} userId={sample.userId} initialTracking={null} navigate={(to) => navigate(to)} />
    </div>
  );
}

const PHONE_WINDOW = "lh-job-preview-phone";

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
      onUnlisted: (what) => jobPreviewChecks.onUnlisted?.(what),
    });
    // A new realtime channel (a live job list, a chat) never connects while the preview is open (lead 11-02).
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
  return ready ? <>{children}</> : null;
}

/**
 * Presses one control on the page once it has drawn (the Cancel sheet stage opens the poster's cancel quote, or the
 * Helpr's own cancel sheet). It looks on the row first, then under "More options" (job page) or "More" (Working card).
 * Never inside the preview controls.
 */
function useOpenOnDraw(label: string | null, key: string) {
  useEffect(() => {
    if (!label) return;
    let tries = 0;
    const find = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => !b.closest("[data-preview-controls]") && !b.disabled && b.textContent?.trim() === name);
    const t = window.setInterval(() => {
      tries++;
      const target = find(label);
      if (target) { target.click(); window.clearInterval(t); return; }
      // The job page's menu is "More options"; the Working card's is "More" (JobStepCard).
      const more = find("More options") ?? find("More");
      if (more && tries % 4 === 1) more.click();
      if (tries > 40) window.clearInterval(t);
    }, 150);
    return () => window.clearInterval(t);
  }, [label, key]);
}

function PreviewControls({ stage, viewer, onStage, onViewer, onLeave }: {
  stage: PreviewStage; viewer: PreviewViewer; onStage: (s: PreviewStage) => void; onViewer: (v: PreviewViewer) => void; onLeave: () => void;
}) {
  const [open, setOpen] = useState(true);
  // Q2617: while one of the page's sheets is open the dock steps aside, so it never covers the sheet's buttons.
  const sheetOpen = usePageSheetOpen();
  const label = PREVIEW_STAGES.find((s) => s.key === stage)?.label ?? stage;
  const inPhoneWindow = typeof window !== "undefined" && window.name === PHONE_WINDOW;
  const openPhone = () => {
    const w = window.open(window.location.href, PHONE_WINDOW, "popup=yes,width=375,height=812");
    if (!w) toast.error("Your browser blocked the phone window. Allow pop-ups for this site and try again.");
  };
  if (sheetOpen) return null;
  if (!open) {
    // Q2617: "Hide" collapses the dock to one small button in the top corner, clear of the page's buttons.
    return createPortal(
      <div data-preview-controls="" data-preview-collapsed="" role="region" aria-label="Job page preview controls"
        className="fixed right-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] pointer-events-auto">
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
      aria-label="Job page preview controls"
      className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-[60] mx-auto max-w-2xl rounded-2xl border border-border bg-card p-3 shadow-lg pointer-events-auto lg:bottom-4 lg:left-[calc(var(--desktop-sidebar-w,0px)+1rem)] lg:right-auto lg:mx-0 lg:w-[34rem]"
    >
      <div className="flex items-center gap-2">
        <PreviewGlyph d={EYE_GLYPH} className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-ds-14 font-semibold">
          Preview: {label} · {viewer === "poster" ? "Poster" : "Helpr"}
        </p>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen(false)} aria-expanded>
          <PreviewGlyph d="m6 9 6 6 6-6" className="h-4 w-4" />
          Hide
        </Button>
      </div>
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

  useOpenOnDraw(sample.opens, `${stage}-${viewer}`);

  // The backend wraps everything this screen draws, the controls too, and stays until the route unmounts; a crash in
  // the page is caught INSIDE it (PreviewErrorBoundary), so nothing ever falls back to the real network.
  return (
    <PreviewBackend sample={sample}>
      <QueryClientProvider client={client}>
        <InertNavigation>
          <PreviewErrorBoundary resetKey={`${stage}-${viewer}`}>
            <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading job"><JobCardSkeleton /></div>}>
              {sample.draws === "helpr_working_card"
                ? <HelprWorkingCard key={`${stage}-${viewer}`} sample={sample} />
                : <JobPage key={`${stage}-${viewer}`} id={sample.jobId} userId={sample.userId} />}
            </Suspense>
          </PreviewErrorBoundary>
        </InertNavigation>
      </QueryClientProvider>
      <PreviewErrorBoundary resetKey="controls">
        <PreviewControls stage={stage} viewer={viewer} onStage={(s) => set({ stage: s })} onViewer={(v) => set({ viewer: v })} onLeave={() => navigate("/admin?view=jobs")} />
      </PreviewErrorBoundary>
    </PreviewBackend>
  );
}
