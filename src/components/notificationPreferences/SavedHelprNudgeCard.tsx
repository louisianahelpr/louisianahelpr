import { Label } from "@/components/ui/label";
import { Bell } from "lucide-react";
import type { Prefs } from "./types";
import { SwitchSlot } from "./SwitchSlot";

/** The Notifications tab's saved-Helpr availability nudge card (moved out of NotificationPreferences.tsx, Q806). */
export function SavedHelprNudgeCard({ prefs, toggle, locked, saving, savingKey, loaded }: {
  prefs: Prefs;
  toggle: (key: keyof Prefs) => void | Promise<void>;
  locked: boolean;
  saving: boolean;
  savingKey: string | null;
  loaded: boolean;
}) {
  return (
    <>
    {/* Saved-Helpr availability nudges: a STANDALONE opt-in (owner 2026-09-15), OFF by default, not a
        type-routed category row; the saved-helper-availability-push cron reads this column directly. Push-only. */}
    <div
      className={`flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${prefs.push_enabled ? "" : "opacity-85"} ${saving ? "opacity-80 cursor-wait" : ""}`}
      style={{
        borderTop: "0.5px solid hsl(var(--olivewood) / 0.08)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span
          className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
          style={{
            background: "hsl(var(--bark) / 0.14)",
            color: "hsl(var(--bark))",
          }}
        >
          <Bell className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <Label
            className="font-sans font-semibold block text-ds-14 mb-0"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Saved Helpr openings
          </Label>
          <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Get a nudge when a Helpr you've saved opens up new availability. Off by default.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
        <SwitchSlot
          loaded={loaded}
          savingKey={savingKey}
          checked={prefs.saved_helper_availability}
          onCheckedChange={() => toggle("saved_helper_availability")}
          disabled={locked || !prefs.push_enabled}
          ariaLabel="Saved Helpr availability nudges"
          savingId="saved_helper_availability"
        />
        {/* Push-only — no email version. */}
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
    </>
  );
}
