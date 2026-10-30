import { EyeOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SwitchSlot } from "./SwitchSlot";

/**
 * "Show message words" (Messages audit M6, 20261030141139): whether a
 * new-message alert in the bell and on the lock screen shows the first words of
 * the message, or only "Sent you a message.". Default on. Emails never carry the
 * words, so the Email column shows a dash. Sits right under the Messages row and
 * reads as paused while Messages alerts (or the Push master) are off.
 */
export function MessagePreviewRow({
  loaded, savingKey, checked, onToggle, disabled, dimmed, saving,
}: {
  loaded: boolean;
  savingKey: string | null;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  dimmed: boolean;
  saving: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${dimmed ? "opacity-85" : ""} ${saving ? "opacity-80 cursor-wait" : ""}`}
      style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span
          className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
          style={{ background: "hsl(var(--bark) / 0.14)", color: "hsl(var(--bark))" }}
        >
          <EyeOff className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <Label
            className="font-sans font-semibold block text-ds-14 mb-0"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Show message words
          </Label>
          <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Off: alerts say only who wrote. Emails never include the words.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
        <SwitchSlot
          loaded={loaded}
          savingKey={savingKey}
          checked={checked}
          onCheckedChange={onToggle}
          disabled={disabled}
          ariaLabel="Show message words in alerts"
          savingId="message_preview"
        />
        <div className="w-[51px] flex justify-center" title="Emails never include the words">
          <span className="font-sans text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden>
            —
          </span>
          <span className="sr-only">Emails never include the words</span>
        </div>
      </div>
    </div>
  );
}
