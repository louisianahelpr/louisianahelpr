/**
 * The shop owner's settings share one look and one save (Area 07 M5, design audit 11-18: radio cards in two pickers,
 * filled/outline pill pairs in another, a separate "Save delivery", two success toasts and two silent saves).
 * Every choice is a radio card that saves on tap; each section says "Saved. New orders use it." under itself once
 * its save lands. Only typed values (the delivery price and miles) keep a button, since a tap can't finish them.
 */
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

/** The one "saved" line every shop setting shows after its save lands (replaces the mixed toasts / silence). */
export function ShopSettingSaved({ show }: { show: boolean }) {
  const { t } = useLanguage();
  // Always mounted, so a screen reader hears the words when they arrive (aria-live on an empty region); out of the
  // flow (sr-only) while empty, so the section's spacing never holds a blank line.
  return (
    <p className={show ? "text-ds-11 font-semibold text-primary" : "sr-only"} role="status" aria-live="polite" data-shop-setting-saved="">
      {show ? t("shb.set.saved") : null}
    </p>
  );
}

/** A dashboard section head (Area 07 M4): one style for every group, sentence case, the count after a dot. */
export function ShopSectionHead({ id, label, count }: { id: string; label: string; count?: number }) {
  const { t } = useLanguage();
  return (
    <h2 id={id} className="text-ds-15 font-semibold" data-shop-section-head="">
      {count === undefined ? label : t("shb.dash.head", { label, n: count })}
    </h2>
  );
}
