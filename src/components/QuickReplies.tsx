import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle2, ThumbsUp, AlertTriangle, Navigation, X, HelpCircle, MapPin, Key } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Audience-specific quick replies. Helpers communicate logistics
// outbound ("running late", "en route"); posters typically coordinate
// access ("door is unlocked", "running 10 min late myself"). Default
// is "helper" to preserve the previous behavior at callsites that
// don't pass an audience.
type QuickReply = { label: string; icon: LucideIcon; message: string };

const helperReplies: QuickReply[] = [
  { label: "Running late", icon: Clock, message: "⏰ Running about 10 minutes late — sorry for the delay!" },
  { label: "Job complete", icon: CheckCircle2, message: "✅ All done! Please review the work and mark as complete." },
  { label: "Sounds good", icon: ThumbsUp, message: "👍 Sounds good, thanks!" },
  { label: "Need more info", icon: AlertTriangle, message: "Could you share a few more details so I can prepare?" },
];

const posterReplies: QuickReply[] = [
  { label: "When can you start?", icon: Clock, message: "Hi — when's the earliest you could start? Trying to plan around it." },
  { label: "Door's unlocked", icon: Key, message: "🔑 Door's unlocked — go on in. Let me know when you arrive." },
  { label: "Quick question", icon: HelpCircle, message: "Quick question about the job — got a sec?" },
  { label: "Sounds good", icon: ThumbsUp, message: "👍 Sounds good, thanks!" },
  { label: "Address details", icon: MapPin, message: "Quick note on the address: " },
];

const ETA_PRESETS = [5, 10, 15, 20, 30] as const;

interface QuickRepliesProps {
  /** Called when the user taps a quick reply chip — populates the message input. */
  onSelect: (message: string) => void;
  /** Whose perspective the chips are written from. Default "helper" (legacy). */
  audience?: "helper" | "poster";
}

export const QuickReplies = ({ onSelect, audience = "helper" }: QuickRepliesProps) => {
  const [showEta, setShowEta] = useState(false);
  const replies = audience === "poster" ? posterReplies : helperReplies;
  // Only helpers get the En-Route flow (posters don't drive to themselves).
  const showEnRoute = audience === "helper";

  const pickEnRoute = (minutes: number) => {
    const arrives = new Date(Date.now() + minutes * 60_000).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    onSelect(`🚗 I'm en route — ETA about ${minutes} minutes (around ${arrives}). See you soon!`);
    setShowEta(false);
  };

  if (showEta) {
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pr-5 scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
        <span className="shrink-0 text-ds-11 font-semibold text-muted-foreground pr-1">ETA:</span>
        {ETA_PRESETS.map((m) => (
          <Button
            key={m}
            size="sm"
            className="shrink-0 text-ds-11 h-7 px-3 rounded-full"
            onClick={() => pickEnRoute(m)}
          >
            {m} min
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-ds-11 h-7 px-2 rounded-full"
          onClick={() => setShowEta(false)}
          aria-label="Cancel"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 pr-5 scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
      {showEnRoute && (
        <Button
          size="sm"
          className="shrink-0 text-ds-11 h-7 px-2.5 gap-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setShowEta(true)}
        >
          <Navigation className="w-3 h-3" />
          I'm En Route
        </Button>
      )}
      {replies.map((qr) => (
        <Button
          key={qr.label}
          variant="outline"
          size="sm"
          className="shrink-0 text-ds-11 h-7 px-2.5 gap-1 rounded-full"
          onClick={() => onSelect(qr.message)}
        >
          <qr.icon className="w-3 h-3" />
          {qr.label}
        </Button>
      ))}
    </div>
  );
};
