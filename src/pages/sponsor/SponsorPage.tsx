/**
 * /sponsor (also /25days): the 25 Days of Louisiana Giveaways sponsor page
 * (owner spec 2026-11-09). Public: a brand opens it from a pitch email, often
 * with ?ref=<their code>, signed out.
 *
 * Hidden behind the `sponsor_25days` switch: sponsor_public_state() answers
 * on=false (and every sponsor RPC and the sign-up function refuse) unless an
 * admin has set the switch to Everyone, or to Testers and the viewer is one.
 * While it is off the route renders the app's ordinary Not found page.
 *
 * Its own lazy chunk with its own stylesheet (sponsor.css, scoped under
 * .lh25) and font: nothing here is in the main bundle or the app's theme.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { sponsorPage as C } from "@/content/sponsorPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { coarseDevice, coarseReferrer, sponsorBackend, type SponsorBackend } from "@/lib/sponsor/api";
import { normalizeRef } from "../../../supabase/functions/_shared/sponsorSignup";
import { ClaimSection } from "@/components/sponsor/ClaimSection";
import { Garland } from "@/components/sponsor/Decor";
import {
  About, BrandGets, Faq, FinalCta, Footer, Founder, Hero, HowItWorks, PlaceholderPreview, PreviewCard, Reach,
  SponsorWall, Testimonials, TrustStrip, WhatWeAsk,
} from "@/components/sponsor/Sections";
import "./sponsor.css";

const NotFound = lazy(() => import("@/pages/info/NotFound"));

function useBackend(): SponsorBackend | null {
  const [b, setB] = useState<SponsorBackend | null>(null);
  useEffect(() => {
    let live = true;
    void sponsorBackend().then((x) => { if (live) setB(x); });
    return () => { live = false; };
  }, []);
  return b;
}

/** One visit row per page view; a reload in the same tab within 30 minutes is not a new visit. */
function shouldLogVisit(ref: string | null): boolean {
  const key = `lh25-visit:${ref ?? "direct"}`;
  try {
    const last = Number(window.sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 30 * 60_000) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked (private mode): log the visit; the server's rate limit still applies.
  }
  return true;
}

/** The page's own top: the dev-only sample-data ribbon and the string lights. */
export function SponsorChrome() {
  const demo = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
  return (
    <>
      {demo ? <div className="lh25-demo-ribbon">LOCAL PREVIEW · SAMPLE DATA · NOT LIVE</div> : null}
      <Garland />
    </>
  );
}

/* The same head values api/share.ts serves before JavaScript runs (NOINDEX_PAGE_META), one per path. */
function HeadSponsor() {
  usePageMeta(NOINDEX_PAGE_META["/sponsor"]);
  return null;
}
function Head25days() {
  usePageMeta(NOINDEX_PAGE_META["/25days"]);
  return null;
}

export default function SponsorPage() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const refCode = normalizeRef(params.get("ref"));
  const preview = import.meta.env.DEV && params.has("demo") && params.has("placeholders");
  // Local preview only: show the claim section as it looks after the sign-up deadline.
  const previewClosed = import.meta.env.DEV && params.has("demo") && params.has("closed");
  const backend = useBackend();


  const stateQ = useQuery({
    queryKey: ["sponsor-25days", "public", refCode, !!backend],
    enabled: !!backend,
    queryFn: () => (backend as SponsorBackend).publicState(refCode),
    staleTime: 60_000,
    meta: { persist: false },
  });

  const on = stateQ.data?.on === true;
  useEffect(() => {
    if (!backend || !on || !shouldLogVisit(refCode)) return;
    backend.logVisit(refCode, coarseReferrer(document.referrer), coarseDevice(navigator.userAgent)).catch((e: unknown) => {
      // A lost visit row must never break the page; it is reported for the ops log.
      console.warn("[sponsor] visit not logged", e);
    });
  }, [backend, on, refCode]);

  const photoUrl = useMemo(() => (stateQ.data?.hasFounderPhoto && backend ? backend.founderPhotoUrl() : null), [stateQ.data, backend]);

  if (!backend || stateQ.isPending) {
    return (
      <div className="lh25 min-h-screen bg-premium-page">
        <SponsorChrome />
        <div className="lh25-loading" role="status" aria-live="polite"><span className="lh25-spinner" aria-hidden="true" /> Loading…</div>
      </div>
    );
  }
  if (stateQ.isError) {
    return (
      <div className="lh25 min-h-screen bg-premium-page">
        <SponsorChrome />
        <div className="lh25-loading" role="alert">
          <ReportErrorScreen source="SponsorPage" title="We couldn't load this page" />
          <p>We couldn't load this page. Check your connection and try again.</p>
          <button type="button" className="lh25-btn lh25-btn-primary" onClick={() => void stateQ.refetch()}>Try again</button>
          <p>Or email <a href={`mailto:${C.links.email}`}>{C.links.email}</a>.</p>
        </div>
      </div>
    );
  }
  if (!on) {
    return <Suspense fallback={null}><NotFound /></Suspense>;
  }
  const state = stateQ.data;
  return (
    <PlaceholderPreview.Provider value={preview}>
      {pathname === "/25days" ? <Head25days /> : <HeadSponsor />}
      <div className="lh25 min-h-screen bg-premium-page">
        <SponsorChrome />
        <Hero greetingBrand={state.greetingBrand} />
        <TrustStrip />
        <div className="lh25-main">
          <About />
          <Founder photoUrl={photoUrl} />
          <HowItWorks />
          <BrandGets />
          <WhatWeAsk />
          <Reach stats={state.stats} />
          <PreviewCard />
          <SponsorWall wall={state.wall} logoUrl={(id) => backend.logoUrl(id)} />
          <Testimonials items={state.testimonials} />
          <ClaimSection state={state} greetingBrand={state.greetingBrand} refCode={refCode} onSubmit={(p, logo) => backend.submit(p, logo)} nowMs={previewClosed ? Date.UTC(2026, 11, 2) : undefined} />
          <Faq />
        </div>
        <FinalCta />
        <Footer />
      </div>
    </PlaceholderPreview.Provider>
  );
}
