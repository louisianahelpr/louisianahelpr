/** CompleteProfile's "still needed" list (moved out of CompleteProfile.tsx, Q806; markup unchanged). */
import { Circle } from "lucide-react";
import type { useLanguage } from "@/lib/i18n/language";
import { ProfileNextStep } from "./ProfileNextStep";

type T = ReturnType<typeof useLanguage>["t"];
type Item = { label: string; step: string; done: boolean };

export function StillNeededList({ checklist, allComplete, t }: { checklist: Item[]; allComplete: boolean; t: T }) {
  /* WHAT IS STILL MISSING — the whole point of this screen.
      The `checklist` above has existed since the gate shipped and was
      never rendered: the only signal a blocked user got was a
      DISABLED button reading "Complete required fields", with every
      field on the form wearing an identical red asterisk whether it
      was satisfied or not. Because the button is disabled whenever
      `allComplete` is false, the per-field `fail()` toasts in
      handleSubmit are unreachable too — so a user missing exactly one
      field (four accounts in prod on 2026-08-31, two of them missing
      only City) had nothing anywhere on the page naming it.
      This is a redirect the app will not let them out of, so naming
      the remaining fields is not a nicety.
      Shown only while incomplete: once every item is done the list
      is noise and the enabled "Enter App" button says it better. */
  if (allComplete) return null;
  return (
    <div
      className="rounded-ds-md border p-3.5"
      style={{
        borderColor: "hsl(var(--burnt-sienna) / 0.28)",
        background: "hsl(var(--burnt-sienna) / 0.06)",
      }}
    >
      {/* NOT `text-display-eyebrow` — that utility was `display: none`
          app-wide ("all eyebrows gone", 2026-07-25; rule deleted
          2026-10-12, Q1288), so a label written with it rendered nothing.
          Caught here by reading the computed page text, not the
          class name — same trap as asserting gloss by class. */}
      <ProfileNextStep checklist={checklist} t={t} />
      <p className="mt-2 text-ds-11 font-semibold" style={{ color: "hsl(var(--sienna-ink))" }}>{t("profileGate.stillNeeded")}</p>
      <ul className="mt-2 space-y-1.5" aria-live="polite">
        {checklist
          .filter((c) => !c.done)
          .map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-ds-11" style={{ color: "hsl(var(--ink-deep))" }}>
              <Circle className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }} aria-hidden />
              {c.label}
            </li>
          ))}
      </ul>
    </div>
  );
}
