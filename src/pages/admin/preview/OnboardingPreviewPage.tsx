/**
 * /admin/preview/onboarding — the two onboarding screens no test account can reach without a write (Q2664 (b),
 * audit 1102d): the unfinished Complete your profile form (a finished account is sent to /home) and the first-run
 * picker "What brings you to Helpr?" (shown once per account, stamped on every shared seat). Admin only (the route).
 *
 * It draws the REAL screens: pages/auth/CompleteProfile.tsx (what /complete-profile draws) and the first run's own
 * screens (components/firstRun/FirstRun.tsx, what FirstRunHost loads), so a change to them shows here with no change
 * to this file. What they are fed is made up:
 *  - the form reads a blank, unfinished profile from the preview's own query cache (the admin's real profile, in the
 *    app's cache, is never touched);
 *  - every Supabase request is answered by the Messages preview's backend (messagesPreviewBackend.ts) and never sent:
 *    reads from the sample, every write, RPC and function answered "done" with a "Preview: this would ..." note;
 *  - the picker's Continue never reorders the admin's own Home (onPicks), and Done starts it again;
 *  - every navigation stays on this page, with the same note.
 * Guard: src/test/adminOnboardingPreviewIsInert.test.tsx.
 */
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { installMessagesPreviewFetch, messagesPreviewChecks } from "./messagesPreviewBackend";
import { EYE_GLYPH, InertNavigation, PreviewErrorBoundary, PreviewGlyph, forgetSharedReads, installInertRealtime, sayWouldHave } from "./previewParts";

const CompleteProfile = lazy(() => import("@/pages/auth/CompleteProfile"));
const FirstRunScreens = lazy(() => import("@/components/firstRun/FirstRun"));

const ONBOARDING_PREVIEW_STAGES = [
  { key: "profile", label: "Finish your profile" },
  { key: "picker", label: "What brings you" },
] as const;
export type OnboardingPreviewStage = (typeof ONBOARDING_PREVIEW_STAGES)[number]["key"];
const isStage = (v: string | null): v is OnboardingPreviewStage => ONBOARDING_PREVIEW_STAGES.some((s) => s.key === v);

/** A sign-up that stopped after step 2: no name, no city, no terms ticked, no photo. Made up. */
function onboardingSampleProfile(userId: string): Record<string, unknown> {
  return {
    id: userId, user_id: userId, first_name: null, last_name: null, full_name: null, location: null, zip_code: null,
    bio: null, avatar_url: null, accepted_terms_at: null, age_attested_at: null, date_of_birth: null,
    is_legacy_user: false, onboarding_tour_completed_at: null, created_at: new Date().toISOString(),
  };
}

/** Never stale: the form's own refetch (focus, mount) would otherwise read the admin's real, finished profile. */
const NEVER_STALE = 1000 * 60 * 60 * 24 * 365 * 100;

const SAMPLE = { reads: {}, tables: {} };

function PreviewBackend({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  const ownRef = useRef<string | null>(user?.id ?? null);
  ownRef.current = user?.id ?? null;
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    let lastGesture = -Infinity;
    const mark = () => { lastGesture = Date.now(); };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    const { uninstall } = installMessagesPreviewFetch({
      supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
      sample: () => SAMPLE,
      ownUserId: () => ownRef.current,
      ownRowTables: ["member_section_prefs"],
      onBlocked: (what) => { if (Date.now() - lastGesture < 2000) sayWouldHave(what); },
      onUnlisted: (what) => messagesPreviewChecks.onUnlisted?.(what),
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
  return ready ? <>{children}</> : null;
}

function PickerStage() {
  const [round, setRound] = useState(0);
  return (
    <FirstRunScreens
      key={round}
      startInTour={false}
      onPicks={() => sayWouldHave("put your picks first on Home")}
      onDone={() => { sayWouldHave("mark the tour seen"); setRound((r) => r + 1); }}
    />
  );
}

function Controls({ stage, onStage, onLeave }: { stage: OnboardingPreviewStage; onStage: (s: OnboardingPreviewStage) => void; onLeave: () => void }) {
  return createPortal(
    <div
      data-preview-controls=""
      role="region"
      aria-label="Onboarding preview controls"
      // Above the picker and the coach marks (both z-[70], full screen), so a stage can always be changed or left.
      className="preview-dock fixed inset-x-2 bottom-[calc(var(--safe-area-bottom,0px)+0.5rem)] z-[80] mx-auto max-w-md rounded-2xl border border-border bg-card p-3 shadow-lg pointer-events-auto lg:bottom-4 lg:right-4 lg:left-auto lg:mx-0 lg:w-[26rem]"
    >
      <div className="flex items-center gap-2">
        <PreviewGlyph d={EYE_GLYPH} className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-ds-14 font-semibold">Preview: sign-up after step 2</p>
        <Button variant="outline" size="sm" className="rounded-full" onClick={onLeave}>Leave</Button>
      </div>
      <div role="radiogroup" aria-label="Stage" className="mt-2 flex flex-wrap gap-2">
        {ONBOARDING_PREVIEW_STAGES.map((s) => (
          <ChoicePill key={s.key} selected={s.key === stage} onClick={() => onStage(s.key)}>{s.label}</ChoicePill>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export default function OnboardingPreviewPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const stageParam = params.get("stage");
  const stage: OnboardingPreviewStage = isStage(stageParam) ? stageParam : "profile";
  const me = user?.id ?? "";
  // Its own cache per stage: the form's profile read is the sample, never the admin's own.
  const client = useMemo(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    if (me) {
      qc.setQueryData(queryKeys.currentUser.byId(me), { profile: onboardingSampleProfile(me), isAdmin: true, adminCheckFailed: false }, { updatedAt: Date.now() + NEVER_STALE });
    }
    return qc;
  }, [me, stage]);
  return (
    <PreviewBackend>
      <QueryClientProvider client={client}>
        <InertNavigation>
          <PreviewErrorBoundary resetKey={stage}>
            <div data-preview-view={stage}>
              {me && (
                <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading the preview" />}>
                  {stage === "picker" ? <PickerStage /> : <CompleteProfile />}
                </Suspense>
              )}
            </div>
          </PreviewErrorBoundary>
        </InertNavigation>
      </QueryClientProvider>
      <PreviewErrorBoundary resetKey="controls">
        <Controls stage={stage} onStage={(s) => setParams({ stage: s }, { replace: true })} onLeave={() => navigate("/admin?view=reports")} />
      </PreviewErrorBoundary>
    </PreviewBackend>
  );
}
