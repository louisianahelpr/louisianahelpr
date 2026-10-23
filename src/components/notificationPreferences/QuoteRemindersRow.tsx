import { Clock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SwitchSlot } from "./SwitchSlot";

/**
 * "Quote reminders" — the EMAIL switch for the quote reminders (a quote's 48 h
 * reply window is ending) and the "Quotes are closed" notice (Q2120, owner
 * 2026-10-21: "quote reminders also by email, with their own setting").
 *
 * Email-only, the mirror of the push-only Saved Helpr row: the in-app notice
 * and its push stay under "Job offers" (the rows above), and
 * send-notification-email gates these emails on
 * `notification_preferences.email_quote_reminders` (type `quote_reminder`).
 * Default on, like every other transactional email switch.
 */
export function QuoteRemindersRow({
  loaded, savingKey, checked, onToggle, disabled, dimmed, saving,
}: {
  loaded: boolean;
  savingKey: string | null;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  /** The Email master is off: the row reads as paused. */
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
          <Clock className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <Label
            className="font-sans font-semibold block text-ds-14 mb-0"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Quote reminders
          </Label>
          <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Email when a quote's reply time is almost up, and when quotes close. In the app they come with Job offers.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
        {/* Email-only: the push for these rides the "Job offers" switch. */}
        <div className="w-[51px] flex justify-center" title="Push comes with Job offers">
          <span className="font-sans text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden>
            —
          </span>
          <span className="sr-only">Push comes with Job offers</span>
        </div>
        <SwitchSlot
          loaded={loaded}
          savingKey={savingKey}
          checked={checked}
          onCheckedChange={onToggle}
          disabled={disabled}
          ariaLabel="Quote reminders email"
          savingId="email_quote_reminders"
        />
      </div>
    </div>
  );
}
