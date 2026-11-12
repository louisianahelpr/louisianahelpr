import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle2, ThumbsUp, AlertTriangle, Navigation, X, HelpCircle, MapPin, Key, Car, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getLang, t } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enMessages";

// Audience-specific quick replies. Helpers communicate logistics
// outbound ("running late", "en route"); posters typically coordinate
// access ("door is unlocked", "running 10 min late myself"). Default
// is "helper" to preserve the previous behavior at callsites that
// don't pass an audience.
//
// `mode`:
//   • "populate" (default) — drops the message into the composer so the
//     user can edit before sending.
//   • "send" — fires the message immediately on tap. Used for the
//     status-aware smart replies ("On my way", "Running 5 min late",
//     "Done") which are designed for one-tap use during an active job.
/** F260q: label and message are dictionary keys (enMessages msg.qr.*), worded in the member's language when drawn. */
type QuickReply = { label: MsgKey; icon: LucideIcon; message: MsgKey; mode?: "populate" | "send" };

const helperReplies: QuickReply[] = [
  { label: "msg.qr.late10", icon: Clock, message: "msg.qr.late10.m" },
  { label: "msg.qr.complete", icon: CheckCircle2, message: "msg.qr.complete.m" },
  { label: "msg.qr.good", icon: ThumbsUp, message: "msg.qr.good.m" },
  { label: "msg.qr.moreInfo", icon: AlertTriangle, message: "msg.qr.moreInfo.m" },
];

const posterReplies: QuickReply[] = [
  { label: "msg.qr.start", icon: Clock, message: "msg.qr.start.m" },
  { label: "msg.qr.door", icon: Key, message: "msg.qr.door.m" },
  { label: "msg.qr.question", icon: HelpCircle, message: "msg.qr.question.m" },
  { label: "msg.qr.good", icon: ThumbsUp, message: "msg.qr.good.m" },
  { label: "msg.qr.address", icon: MapPin, message: "msg.qr.address.m" },
];

// ── Status-aware smart-replies (handoff item #15) ─────────────────────
//
// Only the helper sees these — the poster doesn't drive to the job.
// Each chip sends immediately on tap (mode: "send"), so logistics
// updates during an active job are one-tap, not three.
//
// Surfaced when the job is in flight ("accepted" once awarded but pre-
// start, "in_progress" once underway). For "completed"/"cancelled" we
// fall back to the generic helper replies — no special status chip
// makes sense once the job is wrapped.
const helperSmartRepliesAccepted: QuickReply[] = [
  { label: "msg.qr.onMyWay", icon: Car, message: "msg.qr.onMyWay.m", mode: "send" },
  { label: "msg.qr.late5", icon: Clock, message: "msg.qr.late5.m", mode: "send" },
];

const helperSmartRepliesInProgress: QuickReply[] = [
  { label: "msg.qr.late5", icon: Clock, message: "msg.qr.late5.m", mode: "send" },
  { label: "msg.qr.done", icon: CheckCircle2, message: "msg.qr.done.m", mode: "send" },
];

const ETA_PRESETS = [5, 10, 15, 20, 30] as const;

interface QuickRepliesProps {
  /** Called when a chip in `populate` mode is tapped — drops the message
   *  into the composer for the user to edit before sending. */
  onSelect: (message: string) => void;
  /** Called when a chip in `send` mode is tapped — fires the message
   *  immediately (no composer round-trip). Status-aware smart replies
   *  ("On my way", "Running 5 min late", "Done") use this so an active-
   *  job logistics update is a single tap. Optional: when omitted, every
   *  chip falls back to `onSelect` regardless of declared mode. */
  onSend?: (message: string) => void;
  /** Whose perspective the chips are written from. Default "helper" (legacy). */
  audience?: "helper" | "poster";
  /** Current `jobs.status` for the open thread. Drives which smart-
   *  reply set is prepended (#15): "accepted" → On my way / Running 5
   *  min late; "in_progress" → Running 5 min late / Done. Other
   *  statuses fall through to the generic audience replies only. */
  jobStatus?: string | null;
  /** Wrap onto multiple lines instead of scrolling horizontally. Set on
   *  roomy surfaces (the composer's "+" sheet) where a fade-clipped last
   *  chip reads as a bug rather than as "scroll for more". */
  wrap?: boolean;
}

export const QuickReplies = ({ onSelect, onSend, audience = "helper", jobStatus, wrap = false }: QuickRepliesProps) => {
  const [showEta, setShowEta] = useState(false);
  const replies = audience === "poster" ? posterReplies : helperReplies;
  // Only helpers get the En-Route flow (posters don't drive to themselves).
  const showEnRoute = audience === "helper";

  // Status-aware smart-replies — helper side only. Prepended before the
  // generic chips so they're the first thing in the user's tap target.
  // "assigned" is a legacy conversation alias for the offered-not-yet-
  // confirmed window (kept consistent with the chat-header chip in
  // ChatView), so it shares the "accepted" smart-reply set.
  const showSmartReplies = audience === "helper" && !!onSend;
  const smartReplies: QuickReply[] = !showSmartReplies
    ? []
    : jobStatus === "in_progress"
      ? helperSmartRepliesInProgress
      : jobStatus === "accepted" || jobStatus === "assigned"
        ? helperSmartRepliesAccepted
        : [];

  const handlePick = (qr: QuickReply) => {
    if (qr.mode === "send" && onSend) {
      onSend(t(qr.message));
      return;
    }
    onSelect(t(qr.message));
  };

  const pickEnRoute = (minutes: number) => {
    const arrives = new Date(Date.now() + minutes * 60_000).toLocaleTimeString(getLang() === "es" ? "es-US" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    onSelect(t("msg.qr.enRoute.m", { minutes, arrives }));
    setShowEta(false);
  };

  if (showEta) {
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pr-5 scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
        <span className="shrink-0 text-ds-11 font-semibold text-muted-foreground pr-1">{t("msg.qr.eta")}</span>
        {ETA_PRESETS.map((m) => (
          <Button
            key={m}
            size="sm"
            className="shrink-0 text-ds-11 min-h-[44px] px-3 rounded-full"
            onClick={() => pickEnRoute(m)}
          >
            {t("msg.qr.min", { m })}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-ds-11 min-h-[44px] min-w-[44px] px-2 ctl-exit"
          onClick={() => setShowEta(false)}
          aria-label={t("msg.qr.cancel")}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={
        // `wrap` is for surfaces with room to breathe (the "+" sheet). The
        // scrolling variant exists because these chips used to live in the
        // composer, where a fade mask hinted "there is more to the right" —
        // but in a sheet that same mask just clips the last chip mid-word for
        // no reason, since nothing is competing for the space.
        wrap
          ? "flex flex-wrap gap-1.5 pb-1"
          : "flex gap-1.5 overflow-x-auto pb-1 pr-5 scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]"
      }
    >
      {/* Status-aware smart-reply chips — sent on tap, no composer
          round-trip. Visually distinguished from the generic suggestions
          by the olive-tinted pill so the user reads them as "send-now"
          actions, not "draft this". A small Send glyph reinforces the
          one-tap-fires-immediately semantics. */}
      {smartReplies.map((qr) => (
        <Button
          key={`smart-${qr.label}`}
          variant="outline"
          size="sm"
          className="shrink-0 text-ds-11 min-h-[44px] px-2.5 gap-1 rounded-full"
          style={{
            // Olive, not rust: rust is money only (spec v2 §1.1).
            background: "hsl(var(--bark) / 0.14)",
            border: "1px solid hsl(var(--bark) / 0.45)",
            color: "hsl(var(--ink-deep))",
          }}
          onClick={() => handlePick(qr)}
          aria-label={t("msg.qr.sendAria", { label: t(qr.label) })}
        >
          <qr.icon className="w-3 h-3" />
          <span>{t(qr.label)}</span>
          <Send className="w-2.5 h-2.5 opacity-70" />
        </Button>
      ))}
      {/* The variant owns the fill. This button repainted it with `bg-primary`
          + hover:bg-primary/90 — a FLAT brand colour laid over the shared
          glossy gradient, so the most prominent send action in Messages looked
          like it came from a different button system than every other primary
          in the app. */}
      {showEnRoute && (
        <Button
          variant="primary"
          size="sm"
          className="shrink-0 text-ds-11 min-h-[44px] px-2.5 gap-1 rounded-full"
          onClick={() => setShowEta(true)}
        >
          <Navigation className="w-3 h-3" />
          {t("msg.qr.enRoute")}
        </Button>
      )}
      {replies.map((qr) => (
        <Button
          key={qr.label}
          variant="outline"
          size="sm"
          className="shrink-0 text-ds-11 min-h-[44px] px-2.5 gap-1 rounded-full"
          onClick={() => handlePick(qr)}
        >
          <qr.icon className="w-3 h-3" />
          {t(qr.label)}
        </Button>
      ))}
    </div>
  );
};
