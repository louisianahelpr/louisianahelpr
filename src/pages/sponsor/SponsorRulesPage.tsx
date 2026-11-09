/**
 * /25days/rules: the Official Giveaway Rules, from the template in
 * src/content/sponsorPage.ts (rules.sections). Until the owner sets
 * rules.approved to true the whole page carries a "DRAFT – review before
 * publishing" banner and its [placeholders] show highlighted, so nobody can
 * mistake it for final. Behind the same sponsor_25days switch as /sponsor.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { sponsorPage as C } from "@/content/sponsorPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { sponsorBackend, type SponsorBackend } from "@/lib/sponsor/api";
import { hasPlaceholder, placeholderRuns } from "@/lib/sponsor/placeholders";
import { SponsorShell } from "./SponsorPage";
import "./sponsor.css";

const NotFound = lazy(() => import("@/pages/info/NotFound"));

/** True while the rules page must show the DRAFT banner. Exported for its test. */
export function rulesAreDraft(rules: { approved: boolean; sections: ReadonlyArray<{ heading: string; body: string }> }): boolean {
  if (!rules.approved) return true;
  // Approved with a placeholder left is still a draft: never publish brackets as final rules.
  return rules.sections.some((s) => hasPlaceholder(s.heading) || hasPlaceholder(s.body));
}

function RuleText({ text }: { text: string }) {
  return (
    <>
      {placeholderRuns(text).map((r, i) => (r.placeholder ? <mark key={i} className="lh25-ph">{r.text}</mark> : <span key={i}>{r.text}</span>))}
    </>
  );
}

export default function SponsorRulesPage() {
  const [backend, setBackend] = useState<SponsorBackend | null>(null);
  useEffect(() => {
    let live = true;
    void sponsorBackend().then((b) => { if (live) setBackend(b); });
    return () => { live = false; };
  }, []);
  const draft = rulesAreDraft(C.rules);
  usePageMeta({
    title: C.meta.rulesTitle,
    description: C.meta.rulesDescription,
    canonical: `${C.links.website}${C.links.rules}`,
    // A draft is never indexed.
    robots: draft ? "noindex" : undefined,
  });
  const q = useQuery({
    queryKey: ["sponsor-25days", "public", null, !!backend],
    enabled: !!backend,
    queryFn: () => (backend as SponsorBackend).publicState(null),
    staleTime: 60_000,
    meta: { persist: false },
  });

  if (!backend || q.isPending) {
    return <SponsorShell><div className="lh25-loading" role="status"><span className="lh25-spinner" aria-hidden="true" /> Loading…</div></SponsorShell>;
  }
  if (q.isError) {
    return (
      <SponsorShell>
        <div className="lh25-loading" role="alert">
          <p>We couldn't load the rules. Check your connection and try again.</p>
          <button type="button" className="lh25-btn lh25-btn-primary" onClick={() => void q.refetch()}>Try again</button>
        </div>
      </SponsorShell>
    );
  }
  if (!q.data.on) return <Suspense fallback={null}><NotFound /></Suspense>;

  return (
    <SponsorShell>
      <main className="lh25-rules">
        {draft ? <p className="lh25-draft" role="note" data-testid="rules-draft-banner">{C.rules.draftBanner}</p> : null}
        <Link className="lh25-back" to="/sponsor">← {C.rules.backLink}</Link>
        <h1>{C.rules.title}</h1>
        <p className="lh25-rules-sub">{C.rules.subtitle}</p>
        {C.rules.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            <p>{draft ? <RuleText text={s.body} /> : s.body}</p>
          </section>
        ))}
      </main>
    </SponsorShell>
  );
}
