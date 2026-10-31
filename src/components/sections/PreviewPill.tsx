import { useLanguage } from "@/lib/i18n/language";

/**
 * THE tester's mark (lead, 2026-10-21): a live section the viewer can open
 * ONLY because they are a tester (admin or test account), its switch not yet
 * open to everyone. SoonPill's shape in a muted olive, sentence case, wherever
 * a live section is listed (rail, Settings › Your sections, Create sheet).
 * It says "Coming soon", the same words the phone's Explore chips say to every
 * viewer (owner 2026-10-22): audit A2-L17 (2026-10-29) found the desktop rail
 * saying "Preview" while the 375 switcher said "Coming soon" for the same
 * section. The olive (not muted grey) is what still tells a tester the section
 * opens for them.
 * Shown only when useSectionTabs says `preview`, which is never true for a
 * member and never while the answer is loading or failed.
 *  - "pill": a row with room (Settings, Create);
 *  - "rail": a line UNDER the section's name on the 248px rail, as SoonPill's
 *            rail line is for a member: beside "Declutter" even the old 7-letter
 *            "Preview" pill had to shrink to fit (179px in a 175px box at full
 *            size), and "Coming soon" is longer.
 */
// AUD31-52: the words come from the same i18n key as SoonPill (Spanish read "Casas · Coming soon" beside "Muy pronto").
export function PreviewPill({ variant = "pill", className = "", ...rest }: { variant?: "pill" | "rail"; className?: string } & Record<`data-${string}`, string>) {
  const { t } = useLanguage();
  if (variant === "rail") {
    return (
      <span {...rest} data-preview-pill="" className={`block text-ds-11 font-medium leading-tight ${className}`} style={{ color: "hsl(var(--bark))" }}>
        {t("soon.full")}
      </span>
    );
  }
  return (
    <span
      {...rest}
      data-preview-pill=""
      className={`inline-flex items-center rounded-full border font-semibold shrink-0 px-2 py-0.5 text-ds-11 ${className}`}
      // An olive tint over an OPAQUE card base (SoonPill is bg-card too), so a border it rides on never shows through.
      style={{
        color: "hsl(var(--bark))",
        borderColor: "hsl(var(--bark) / 0.35)",
        backgroundColor: "hsl(var(--card))",
        backgroundImage: "linear-gradient(hsl(var(--bark) / 0.08), hsl(var(--bark) / 0.08))",
      }}
    >
      {t("soon.full")}
    </span>
  );
}
