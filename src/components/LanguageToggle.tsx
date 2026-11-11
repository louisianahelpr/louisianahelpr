import { Check, Languages } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LANGS, ensureLangLoaded, useLanguage, type Lang } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

/**
 * English / Español switch (Spanish language option, 2026-10-29). ONE shared
 * control for Settings, Log in, Sign up and the landing page. Each language's
 * name is written in that language, so a Spanish speaker finds "Español" while
 * the screen is still in English. The choice is remembered on this device.
 *
 * F410d (audit 11-10): the chosen language wears a check mark, and a switch
 * confirms with a toast in the NEW language once its words have loaded, so
 * nobody taps twice wondering whether the first tap took.
 */
const NAME: Record<Lang, MsgKey> = { en: "lang.english", es: "lang.spanish" };

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <div role="group" aria-label={t("lang.label")} data-testid="language-toggle" className={`inline-flex items-center gap-1 text-ds-13 font-sans ${className}`}>
      <Languages className="h-4 w-4 shrink-0" aria-hidden style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
      {LANGS.map((l, i) => (
        <span key={l} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="px-1">·</span>}
          <Button
            type="button"
            variant="link"
            size="sm"
            lang={l}
            aria-pressed={lang === l}
            onClick={() => {
              if (l === lang) return;
              setLang(l);
              void ensureLangLoaded().then(() => toast(t("lang.saved")));
            }}
            className="px-1.5 text-ds-13 tracking-normal"
            style={{ color: lang === l ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.8)", fontWeight: lang === l ? 700 : 500 }}
          >
            {lang === l && <Check className="h-3.5 w-3.5 mr-0.5 shrink-0" aria-hidden data-lang-check="" />}
            {t(NAME[l])}
          </Button>
        </span>
      ))}
    </div>
  );
}
