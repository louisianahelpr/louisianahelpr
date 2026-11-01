import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LANGS, useLanguage, type Lang } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

/**
 * English / Español switch (Spanish language option, 2026-10-29). ONE shared
 * control for Settings, Log in, Sign up and the landing page. Each language's
 * name is written in that language, so a Spanish speaker finds "Español" while
 * the screen is still in English. The choice is remembered on this device.
 */
const NAME: Record<Lang, MsgKey> = { en: "lang.english", es: "lang.spanish" };

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <div role="group" aria-label={t("lang.label")} data-testid="language-toggle" className={`inline-flex items-center gap-1 text-ds-13 font-sans ${className}`}>
      <Languages className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
      {LANGS.map((l, i) => (
        <span key={l} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="px-1">·</span>}
          <Button
            type="button"
            variant="link"
            size="sm"
            lang={l}
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className="px-1.5 text-ds-13 tracking-normal"
            style={{ color: lang === l ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.8)", fontWeight: lang === l ? 700 : 500 }}
          >
            {t(NAME[l])}
          </Button>
        </span>
      ))}
    </div>
  );
}
