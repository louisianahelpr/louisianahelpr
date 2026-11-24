import { useEffect, useState } from "react";
import { giftGuides as G } from "@/content/giftGuides";
import { SBS_DAY, SBS_WORDS as W, sbsDayWords } from "@/content/sbsFeaturedLocal";
import { listFeaturedLocal, sbsLogoUrl, type SbsListing } from "@/lib/sbsFeaturedApi";
import { report } from "@/lib/errorLogger";
import { louisianaDay } from "@/content/giftGuideDeals.mjs";
import { safeDocumentUrl } from "@/lib/storagePath";
import { SB_CARD_CSS } from "./smallBizCardStyles";
import { FeatureCta } from "./SmallBizFeatureCta";
import { businessKey } from "../../../../supabase/functions/_shared/sbsSubmission";

/** The local list's heading id: one of the two branches below renders it, never both. */
const SBS_LOCAL_HEAD = "gift-sbs-local";

/**
 * Small Business Saturday "Featured local" (owner 2026-11-20): approved FREE listings, shown BELOW the 25 Days sponsors
 * (owner: "our small business sponsers still get lsited a the to of the list with a badge"). A business that is already
 * a sponsor shows once, in the sponsor spot (matched by name, or by the same link). Then the "Get your business
 * featured" card; its form is its own chunk, loaded only when tapped. This file itself loads only when the Small
 * Business Saturday page opens. Guard: src/test/sbsFeaturedLocal1120.test.tsx.
 */

const SBS_CSS = `
.gg-sbs-local{margin-top:22px}
.gg-sbs-local-intro{margin:4px 0 10px;font-size:13px;color:var(--gg-muted)}
.gg-bdg-local{background:#e3eedf;color:#2f5a2a}
.gg-sbs-initials{font-size:22px;font-weight:800;letter-spacing:.02em;color:var(--gg-olive)}
.gg-sbs-introlink{display:inline-flex;align-items:center;min-height:44px;font-size:14px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-sbs-introlink:hover,.gg-sbs-introlink:focus-visible{text-decoration:underline}
`;

/** One or two letters for a listing with no logo. */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9& ]+/g, " ").split(/\s+/).filter((w) => w && !/^(the|and|&|of)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join("") || name.slice(0, 1)).toUpperCase();
}

const hostPath = (u: string | null | undefined) => {
  if (!u) return "";
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^(www\.|m\.)/, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    // Not a URL: matches nothing.
    return "";
  }
};

/** The approved listings that are NOT already sponsors (sponsors keep their spot at the top). */
export function withoutSponsors(rows: SbsListing[], sponsors: Array<{ name: string; links: Array<string | null | undefined> }>): SbsListing[] {
  const names = new Set(sponsors.map((s) => businessKey(s.name)).filter(Boolean));
  // A bare social site ("facebook.com") names nobody; a bare own domain ("sweetspot.com") does.
  const links = new Set(sponsors.flatMap((s) => s.links.map(hostPath)).filter((l) => l && !/^(facebook|instagram|tiktok|fb)\.com$/.test(l)));
  return rows.filter((r) => !names.has(businessKey(r.name)) && !links.has(hostPath(r.link)));
}

function LocalCard({ b }: { b: SbsListing }) {
  const [logoOk, setLogoOk] = useState(true);
  const href = safeDocumentUrl(b.link);
  const logo = b.has_logo && logoOk ? (
    <img loading="lazy" decoding="async" src={sbsLogoUrl(b.id)} alt="" width={72} height={72} onError={() => setLogoOk(false)} />
  ) : (
    <span className="gg-sbs-initials" aria-hidden="true">{initials(b.name)}</span>
  );
  // Owner 2026-11-22 ("remove visit, they can click the picture or title to visit"): the logo and the name each open the
  // business's page in a new tab (as Visit did); no link, plain text. The logo link repeats the name's, so it is hidden
  // from screen readers and Tab.
  const out = (className: string, children: React.ReactNode, hidden = false) => href && (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className={className} data-gift-sb-out=""
      {...(hidden ? { "aria-hidden": true, tabIndex: -1 } : {})}>{children}</a>
  );
  return (
    <li className="gg-sb" data-gift-sbs-local={b.id}>
      {href ? out("gg-sb-logo", logo, true) : <span className="gg-sb-logo">{logo}</span>}
      <span className="gg-sb-body">
        <p className="gg-sb-name">{href ? out("gg-sb-name-link", <>{b.name}<span className="sr-only"> ({G.newTab})</span></>) : b.name}</p>
        <p className="gg-sb-town">{[b.town, b.category].filter(Boolean).join(" · ")}</p>
        <span className="gg-badges"><i className="gg-bdg gg-bdg-local" data-gift-badge="local">{W.badge}</i></span>
        {b.deal && <p className="gg-sb-text"><b>{sbsDayWords(louisianaDay(new Date())).dealLabel}</b> {b.deal}</p>}
      </span>
    </li>
  );
}

/**
 * Under the sponsor sections: approved free listings (if any), then the sign-up card. `heading` replaces the section's
 * title and intro where no sponsor list sits above it (no page uses it now; the Small Business Saturday page shows the listings without a heading).
 */

export function SmallBizLocal({ sponsors, heading }: { sponsors: Array<{ name: string; links: Array<string | null | undefined> }>; heading?: { title: string; intro: string } }) {
  const [rows, setRows] = useState<SbsListing[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let live = true;
    listFeaturedLocal().then(
      (r) => {
        if (!live) return;
        setRows(r);
        setPhase("ready");
      },
      // Reported; on /shop-small the section says the shops did not load (the sponsors and the sign-up card still show).
      (e) => {
        report(e, { tags: { source: "SmallBizLocal.listFeaturedLocal" } });
        if (live) setPhase("failed");
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const list = withoutSponsors(rows, sponsors);
  // Holiday audit 1121 area 5 #4: on /shop-small (its own section heading) the free listings say when they are loading,
  // empty or failed; under a guide's sponsor sections an empty list stays silent.
  const stateLine = !heading || list.length > 0 ? null
    : phase === "loading" ? <p className="gg-sbs-local-intro" role="status" data-gift-sbs-local-state="loading">{W.localLoading}</p>
    : phase === "failed" ? <p className="gg-sbs-local-intro" role="alert" data-gift-sbs-local-state="failed">{W.localFailed}</p>
    : <p className="gg-sbs-local-intro" data-gift-sbs-local-state="empty">{louisianaDay(new Date()) <= SBS_DAY ? W.localEmptyBefore : W.localEmptyAfter}</p>;
  return (
    <>
      <style>{SB_CARD_CSS}{SBS_CSS}</style>
      {stateLine && heading && (
        <section className="gg-sbs-local" aria-labelledby={SBS_LOCAL_HEAD} data-gift-sbs-section="">
          <div className="gg-rowhead"><h2 id={SBS_LOCAL_HEAD}>{heading.title}</h2></div>
          {stateLine}
        </section>
      )}
      {list.length > 0 && (
        <section className="gg-sbs-local" aria-labelledby={SBS_LOCAL_HEAD} data-gift-sbs-section="">
          <div className="gg-rowhead"><h2 id={SBS_LOCAL_HEAD}>{heading?.title ?? W.sectionTitle}<span className="gg-rowcount">&nbsp;({list.length})</span></h2></div>
          <p className="gg-sbs-local-intro">{heading?.intro ?? sbsDayWords(louisianaDay(new Date())).sectionIntro}</p>
          <ul className="gg-sb-grid">{list.map((b) => <LocalCard key={b.id} b={b} />)}</ul>
        </section>
      )}
      <FeatureCta />
    </>
  );
}
