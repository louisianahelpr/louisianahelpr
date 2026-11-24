import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Button } from "@/components/ui/button";
import { SBS_WORDS as W, sbsDayWords } from "@/content/sbsFeaturedLocal";
import { louisianaDay } from "@/content/giftGuideDeals.mjs";
import { loadModule } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";

/**
 * "Get your business featured" (owner 2026-11-20; the admin-reviewed sign-up, edge function sbs-featured), on its own so
 * the Small Business Saturday day page can show it without the free listings' reader: owner 2026-11-21 "add this to
 * the top or bottom of the shop small business". The full card sits at the BOTTOM of the business list (the day page
 * and /shop-small), and a one-line link at the TOP jumps to it and opens the form. One form, its own chunk, loaded on
 * tap only (SmallBizSubmitForm).
 */

type FormModule = { SmallBizSubmitForm: ComponentType<{ onClose: () => void }> };
// The form's chunk, alone in its loader (loads on tap only).
const loadForm = () => loadModule(() => import("./SmallBizSubmitForm"));

const SBS_CTA_ID = "get-featured";

const SBS_CTA_CSS = `
.gg-sbs-cta{margin:22px 0 8px;padding:16px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));color:var(--gg-ink);scroll-margin-top:88px}
.gg-sbs-cta h2{margin:0;font-size:18px;font-weight:800;line-height:1.25}
.gg-sbs-cta p{margin:6px 0 12px;font-size:14px;line-height:1.45;color:var(--gg-ink);max-width:40rem}
.gg-sbs-toplink{display:inline-flex;align-items:center;min-height:44px;margin:0 0 6px;padding:0;border:0;background:none;font-size:14px;font-weight:600;color:var(--gg-olive);text-align:left;cursor:pointer}
.gg-sbs-toplink:hover,.gg-sbs-toplink:focus-visible{text-decoration:underline}
`;

/** Opens the card's form from anywhere on the page (the top link). */
const OPEN_EVENT = "gg-sbs-open-form";

/**
 * The one-line link at the top of a business list: scrolls to the card and opens its form. Owner 2026-11-22 (iPhone):
 * it shares its row with the sort and the heart in smaller words; where the row is too narrow for one line, "Get
 * featured free ›" moves whole to a second line.
 */
const [CTA_ASK, CTA_GO] = W.ctaTopLink.split("? ");
export function FeatureCtaLink() {
  const go = () => {
    const card = document.getElementById(SBS_CTA_ID);
    card?.scrollIntoView({ block: "start", behavior: "smooth" });
    window.dispatchEvent(new Event(OPEN_EVENT));
  };
  return (
    <InlineTextButton className="gg-sbs-toplink" onClick={go} data-gift-sbs-toplink="">
      <span>{CTA_GO ? <>{CTA_ASK}? <span className="whitespace-nowrap">{CTA_GO}&nbsp;›</span></> : <>{W.ctaTopLink}&nbsp;›</>}</span>
    </InlineTextButton>
  );
}

/** The "Get your business featured" card, its form opening in place. */
export function FeatureCta() {
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
  const openRef = useRef(openForm);
  openRef.current = openForm;
  useOpenEvent(useCallback(() => openRef.current(), []));
  return (
    <section className="gg-sbs-cta" id={SBS_CTA_ID} aria-labelledby="gg-sbs-cta-h" data-gift-sbs-cta="">
      <style>{SBS_CTA_CSS}</style>
      <h2 id="gg-sbs-cta-h">{W.ctaTitle}</h2>
      <p>{sbsDayWords(louisianaDay(new Date())).ctaLine}</p>
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

function useOpenEvent(fn: () => void) {
  useEffect(() => {
    window.addEventListener(OPEN_EVENT, fn);
    return () => window.removeEventListener(OPEN_EVENT, fn);
  }, [fn]);
}
