import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

/**
 * The "or" rule between email + password and the Apple / Google buttons on
 * the Log in card (board 37, 2026-10-20): one horizontal rule at every width,
 * since the card is one column now (the lg vertical twin went with the
 * two-panel split). A plain lowercase "or" in --muted-foreground: rust is
 * money only (spec v2 §1.1), so the old --accent-ink caption is gone.
 * --muted-foreground on the card measures above 4.5:1 in both themes (it is
 * the app's caption colour). Extracted from Login.tsx (2026-10-06).
 */
export function OrRule() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--border))" }} />
      <span className="text-ds-13 font-sans text-muted-foreground">{t("auth.or")}</span>
      <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--border))" }} />
    </div>
  );
}
