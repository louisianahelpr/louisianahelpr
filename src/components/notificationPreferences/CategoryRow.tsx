import { Label } from "@/components/ui/label";
import { SwitchSlot } from "./SwitchSlot";
import type { Prefs, Row } from "./types";

/**
 * One category row on the Notifications screen: label, App switch, Email
 * switch (or a dash when the kind has no email). Shared by the main list and
 * the Declutter group. Moved verbatim out of NotificationPreferences (its
 * size ratchet); every value it reads arrives as a prop.
 */
export function CategoryRow({
  item, prefs, emailMasterEnabled, emailShownOn, saving, loaded, savingKey, locked, onToggle,
}: {
  item: Row; prefs: Prefs; emailMasterEnabled: boolean; emailShownOn: boolean; saving: boolean;
  loaded: boolean; savingKey: string | null; locked: boolean; onToggle: (key: keyof Prefs) => void;
}) {
  return (
        <div
          className={`flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${
            prefs.push_enabled || (!item.noEmailSwitch && emailMasterEnabled && emailShownOn) ? "" : "opacity-85"
          } ${saving ? "opacity-80 cursor-wait" : ""}`}
          style={{
            borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
              style={{
                background: "hsl(var(--bark) / 0.10)",
                color: "hsl(var(--bark))",
              }}
            >
              {item.icon}
            </span>
            <div className="min-w-0">
              <Label
                className="font-sans font-semibold text-ds-14 mb-0"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {item.label}
              </Label>
              {item.description && (
                <p className="font-sans text-ds-12 leading-snug mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {item.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
            <SwitchSlot
              loaded={loaded}
              savingKey={savingKey}
              checked={prefs[item.key] === true && prefs.push_enabled}
              onCheckedChange={() => onToggle(item.key)}
              disabled={locked || !prefs.push_enabled}
              ariaLabel={`${item.label} push`}
              savingId={item.key}
            />
            {/* Reads and disables exactly the way the App column does: the
                switch shows category AND master, and the master being off
                greys the row rather than rewriting it. That symmetry is the
                whole point — the stored category value is untouched while the
                master is off, so flipping the master back on brings the user's
                own choices back rather than a row of `true`s. */}
            {item.noEmailSwitch ? (
              <div className="w-[51px] flex justify-center" title={item.noEmailSwitch}>
                <span className="font-sans text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden>
                  —
                </span>
                <span className="sr-only">{`${item.label}: ${item.noEmailSwitch}`}</span>
              </div>
            ) : (
            <SwitchSlot
              loaded={loaded}
              savingKey={savingKey}
              checked={emailShownOn && emailMasterEnabled}
              onCheckedChange={() => onToggle(item.emailKey)}
              disabled={locked || !emailMasterEnabled}
              ariaLabel={`${item.label} email`}
              savingId={item.emailKey}
            />
            )}
          </div>
        </div>
  );
}
