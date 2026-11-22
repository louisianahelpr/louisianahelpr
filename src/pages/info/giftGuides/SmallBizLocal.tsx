import { useEffect, useRef, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { SBS_WORDS as W } from "@/content/sbsFeaturedLocal";
import { listFeaturedLocal, sbsLogoUrl, type SbsListing } from "@/lib/sbsFeaturedApi";
import { loadModule } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { safeDocumentUrl } from "@/lib/storagePath";
import { SB_CARD_CSS } from "./smallBizCardStyles";
import { businessKey } from "../../../../supabase/functions/_shared/sbsSubmission";

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
.gg-sbs-cta{margin:22px 0 8px;padding:16px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));color:var(--gg-ink);scroll-margin-top:88px}
.gg-sbs-cta h2{margin:0;font-size:18px;font-weight:800;line-height:1.25}
.gg-sbs-cta p{margin:6px 0 12px;font-size:14px;line-height:1.45;color:var(--gg-ink);max-width:40rem}
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
  return (
    <li className="gg-sb" data-gift-sbs-local={b.id}>
      <span className="gg-sb-logo">
        {b.has_logo && logoOk ? (
          <img loading="lazy" decoding="async" src={sbsLogoUrl(b.id)} alt="" width={72} height={72} onError={() => setLogoOk(false)} />
        ) : (
          <span className="gg-sbs-initials" aria-hidden="true">{initials(b.name)}</span>
        )}
      </span>
      <span className="gg-sb-body">
        <p className="gg-sb-name">{b.name}</p>
        <p className="gg-sb-town">{[b.town, b.category].filter(Boolean).join(" · ")}</p>
        <span className="gg-badges"><i className="gg-bdg gg-bdg-local" data-gift-badge="local">{W.badge}</i></span>
        {b.deal && <p className="gg-sb-text"><b>{W.dealLabel}</b> {b.deal}</p>}
        {href && <span className="gg-sb-links">
          <Button asChild variant="outline" size="sm" className="gg-sb-visit">
            <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" data-gift-sb-out="">
              {/* "Visit" alone: a long business name never overflows the card at 320 px; the name is read out. */}
              {W.visitShort}<span className="sr-only"> {b.name} ({G.newTab})</span>
            </a>
          </Button>
        </span>}
      </span>
    </li>
  );
}

type FormModule = { SmallBizSubmitForm: ComponentType<{ onClose: () => void }> };
// The form's chunk, alone in its loader (loads on tap only).
const loadForm = () => loadModule(() => import("./SmallBizSubmitForm"));

const SBS_CTA_ID = "get-featured";

/** The "Get your business featured" card, its form opening in place. */
function FeatureCta() {
  const [open, setOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  // Holiday audit 1121 #76: Close hands focus back to the open button (it jumped to the top of the page), and the
  // form stays mounted while closed, so reopening keeps what was typed.
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => openButton.current?.focus());
  };
  const [Form, setForm] = useState<FormModule["SmallBizSubmitForm"] | null>(null);
  const [failed, setFailed] = useState(false);
  const openForm = () => {
    setOpen(true);
    setFailed(false);
    if (Form) return;
    void loadForm().then(
      (m) => m && setForm(() => (m as FormModule).SmallBizSubmitForm),
      (e) => {
        report(e, { tags: { source: "SmallBizLocal.loadForm" } });
        setFailed(true);
      },
    );
  };
  return (
    <section className="gg-sbs-cta" id={SBS_CTA_ID} aria-labelledby="gg-sbs-cta-h" data-gift-sbs-cta="">
      <h2 id="gg-sbs-cta-h">{W.ctaTitle}</h2>
      <p>{W.ctaLine}</p>
      {!open ? (
        <Button ref={openButton} className="btn-grad-primary" onClick={openForm} data-gift-sbs-open="">{W.ctaButton}</Button>
      ) : failed ? (
        <div role="alert" data-gift-sbs-form-failed="">
          <p>{W.formFailed}</p>
          <Button variant="outline" size="sm" onClick={openForm} data-gift-sbs-form-retry="">{W.formRetry}</Button>
        </div>
      ) : Form ? null : (
        <p role="status">{W.loadingForm}</p>
      )}
      {Form && <div hidden={!open} data-gift-sbs-form-wrap=""><Form onClose={close} /></div>}
    </section>
  );
}

/**
 * Under the sponsor sections: approved free listings (if any), then the sign-up card. `heading` replaces the section's
 * title and intro where no sponsor list sits above it (/shop-small, src/pages/info/ShopSmall.tsx).
 */
export function SmallBizLocal({ sponsors, heading }: { sponsors: Array<{ name: string; links: Array<string | null | undefined> }>; heading?: { title: string; intro: string } }) {
  const [rows, setRows] = useState<SbsListing[]>([]);
  useEffect(() => {
    let live = true;
    listFeaturedLocal().then(
      (r) => live && setRows(r),
      // A failed read shows no extra section; the sponsors and the sign-up card still show.
      (e) => report(e, { tags: { source: "SmallBizLocal.listFeaturedLocal" } }),
    );
    return () => {
      live = false;
    };
  }, []);
  const list = withoutSponsors(rows, sponsors);
  return (
    <>
      <style>{SB_CARD_CSS}{SBS_CSS}</style>
      {list.length > 0 && (
        <section className="gg-sbs-local" aria-labelledby="gift-sbs-local" data-gift-sbs-section="">
          <div className="gg-rowhead"><h2 id="gift-sbs-local">{heading?.title ?? W.sectionTitle}<span className="gg-rowcount">&nbsp;({list.length})</span></h2></div>
          <p className="gg-sbs-local-intro">{heading?.intro ?? W.sectionIntro}</p>
          <ul className="gg-sb-grid">{list.map((b) => <LocalCard key={b.id} b={b} />)}</ul>
        </section>
      )}
      <FeatureCta />
    </>
  );
}
