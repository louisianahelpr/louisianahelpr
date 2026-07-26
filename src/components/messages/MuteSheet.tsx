import { Bell, BellOff, Clock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import {
  SNOOZE_PRESETS,
  snoozeRemainingLabel,
  type SnoozePreset,
} from "@/lib/threadMutes";
import type { Conversation } from "./types";

interface MuteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  convo: Conversation | null;
  onSnoozeMute: (convo: Conversation, until: Date | null) => void;
  onUnmute: (convo: Conversation) => void;
}

/**
 * MuteSheet — picker bottom sheet that converts the binary mute toggle
 * into a snooze picker (1h / 8h / "until tomorrow 8 AM" / forever).
 *
 * Mirrors the iMessage "Hide Alerts → For 1 Hour / For 8 Hours / Until
 * Tomorrow" pattern. The sheet body lists the four presets and, when
 * the thread is already muted, surfaces an "Unmute now" option and the
 * remaining-time label so the user can see exactly how long a snooze
 * has left without leaving the sheet.
 */
export function MuteSheet({
  open,
  onOpenChange,
  convo,
  onSnoozeMute,
  onUnmute,
}: MuteSheetProps) {
  if (!convo) return null;

  const isMuted = !!convo.isMuted;
  const remaining = isMuted ? snoozeRemainingLabel(convo.muteUntil ?? null) : null;
  // A "forever" mute has isMuted=true but muteUntil=null. The remaining
  // label hides for that case (we surface "Muted until you turn it back
  // on" instead so the user knows it's not on a timer).
  const isForever = isMuted && !convo.muteUntil;

  const handlePick = (preset: SnoozePreset) => {
    const until = preset.resolveUntil();
    onSnoozeMute(convo, until);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-2xl">
        <SheetHero
          eyebrow={
            <>
              <BellOff className="w-3 h-3" />
              Quiet hours
            </>
          }
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="Mute notifications"
        />
        {isMuted && (
          <div
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{
              background: "hsl(var(--olivewood) / 0.08)",
              border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            }}
          >
            <Clock className="w-3 h-3" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            <span
              className="font-serif italic text-[0.74rem]"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              {isForever ? "Muted until you turn it back on" : remaining ?? "Muted"}
            </span>
          </div>
        )}

        <div className="mt-4 grid gap-1.5">
          {SNOOZE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePick(preset)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-ds-md text-left transition-colors hover:bg-secondary/40 min-h-[48px]"
              style={{
                background: "hsla(0, 0%, 100%, 0.65)",
                border: "0.5px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <span
                className="font-sans font-medium text-[0.92rem]"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {preset.label}
              </span>
              {preset.id === "forever" ? (
                <BellOff
                  className="w-4 h-4 shrink-0"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                />
              ) : (
                <Clock
                  className="w-4 h-4 shrink-0"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                />
              )}
            </button>
          ))}
          {isMuted && (
            <button
              type="button"
              onClick={() => {
                onUnmute(convo);
                onOpenChange(false);
              }}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-ds-md text-left transition-colors hover:bg-secondary/40 min-h-[48px] mt-1"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.06)",
                border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              }}
            >
              <span
                className="font-sans font-medium text-[0.92rem]"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                Turn notifications back on
              </span>
              <Bell
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              />
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
