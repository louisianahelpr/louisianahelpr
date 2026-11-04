import { Label } from "@/components/ui/label";
import { Moon } from "lucide-react";
import { QuietHoursClock } from "@/components/profile/QuietHoursClock";
import type { Prefs } from "./types";
import { SwitchSlot } from "./SwitchSlot";
import { QuietTimeInput } from "./QuietTimeInput";

/** The Notifications tab's Quiet hours card (moved out of NotificationPreferences.tsx, Q806). The tab owns the state and the saves. */
export function QuietHoursCard({ prefs, quietEnabled, toggleQuiet, patchPrefs, locked, saving, savingKey, loaded }: {
  prefs: Prefs;
  quietEnabled: boolean;
  toggleQuiet: () => void;
  patchPrefs: (patch: Partial<Prefs>, key: string) => Promise<void>;
  locked: boolean;
  saving: boolean;
  savingKey: string | null;
  loaded: boolean;
}) {
  return (
    <>
    {/* Quiet hours — when on, non-critical pushes are suppressed
        between start and end (security alerts always fire). Sits
        between the digest toggle and the per-category rows so it
        reads as a delivery preference, not a category. */}
    <div
      className={`px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${prefs.push_enabled ? "" : "opacity-85"} ${saving ? "opacity-80 cursor-wait" : ""}`}
      style={{
        borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
            style={{
              background: "hsl(var(--bark) / 0.10)",
              color: "hsl(var(--bark))",
            }}
          >
            <Moon className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Quiet hours
            </Label>
            {/* Was "Mute non-critical pushes overnight. Security alerts still
                fire." — the second sentence is the same false promise as the
                old footer. `send-push-notification` returns on
                `isInQuietHours(...)` before it loads a single token
                (index.ts, the quiet-hours gate), with no exemption for
                `warning`, `system_alert` or `admin_alert`: EVERY push is held
                inside the window. The in-app bell row is still written by the
                trigger that fired the function, so the notification is
                waiting when the app opens — which is the true version of the
                reassurance and what this now says.

                Separately, and NOT fixed here: that gate evaluates the window
                in UTC because no per-user timezone is stored, so a Louisiana
                user's 22:00–07:00 actually mutes 17:00–02:00 local. Reported
                to the orchestrator rather than papered over in copy — the
                times below deliberately carry no "local" claim. */}
            <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Hold pushes overnight. Everything still lands in the bell icon.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
          <SwitchSlot
            loaded={loaded}
            savingKey={savingKey}
            checked={quietEnabled}
            onCheckedChange={toggleQuiet}
            disabled={locked || !prefs.push_enabled}
            ariaLabel="Quiet hours"
            savingId="quiet_hours"
          />
          {/* THE EM-DASH IS 0.7, NOT 0.3 — and both copies of it in this
              file (here and the saved-Helpr row) moved together.
              At 0.3 it measured 1.79:1 against a 4.5:1 AA floor: the faintest
              text in the app and, at ds-14, genuinely hard to see rather than
              merely quiet. It is NOT exempt as decoration: it is the cell's
              value — "there is no email version of this row" — and a reader
              who cannot see it reads the row as if the email column were
              simply missing.
              0.7 is the floor that clears AA (ladder on parchment: 0.3 →
              1.79, 0.5 → 2.84, 0.65 → 4.24, 0.7 → 4.90) and it is an ink the
              app already uses in 39 other places, so no new value is
              invented. It stays below the 0.8 the row labels wear, and the
              column still reads as "app only, intentionally" — only now it
              reads at all. */}
          <div className="w-[51px] flex justify-center" title="Push-only — no email version of this">
            <span
              className="font-sans text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              aria-hidden
            >
              —
            </span>
            <span className="sr-only">Push-only, no email version</span>
          </div>
        </div>
      </div>
      {quietEnabled && (
        <div className="mt-2 flex items-start gap-3 pl-[2.375rem]">
          <div className="flex-1 flex items-center gap-2 flex-wrap">
            <QuietTimeInput label="From" ariaLabel="Quiet hours start time" value={prefs.quiet_start ?? "22:00"} onChange={(v) => void patchPrefs({ quiet_start: v }, "quiet_hours")} disabled={locked || !prefs.push_enabled || saving} />
            <QuietTimeInput label="to" ariaLabel="Quiet hours end time" value={prefs.quiet_end ?? "07:00"} onChange={(v) => void patchPrefs({ quiet_end: v }, "quiet_hours")} disabled={locked || !prefs.push_enabled || saving} />
          </div>
          {/* Visual donut — translates the start/end times into a 24hr
              arc so it's immediately clear *which* hours are muted.
              Pure visual, no interaction. */}
          <QuietHoursClock
            start={prefs.quiet_start ?? "22:00"}
            end={prefs.quiet_end ?? "07:00"}
            size={48}
          />
        </div>
      )}
    </div>
    </>
  );
}
