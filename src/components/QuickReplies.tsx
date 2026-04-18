import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, CheckCircle2, ThumbsUp, AlertTriangle, Navigation, X } from "lucide-react";

const quickReplies = [
  { label: "Running late", icon: Clock, message: "⏰ Running about 10 minutes late — sorry for the delay!" },
  { label: "Job complete", icon: CheckCircle2, message: "✅ All done! Please review the work and mark as complete." },
  { label: "Sounds good", icon: ThumbsUp, message: "👍 Sounds good, thanks!" },
  { label: "Need more info", icon: AlertTriangle, message: "Could you share a few more details so I can prepare?" },
];

const ETA_PRESETS = [5, 10, 15, 20, 30] as const;

interface QuickRepliesProps {
  onSelect: (message: string) => void;
}

export const QuickReplies = ({ onSelect }: QuickRepliesProps) => {
  const [showEta, setShowEta] = useState(false);

  const sendEnRoute = (minutes: number) => {
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
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground pr-1">ETA:</span>
        {ETA_PRESETS.map((m) => (
          <Button
            key={m}
            size="sm"
            className="shrink-0 text-xs h-7 px-3 rounded-full"
            onClick={() => sendEnRoute(m)}
          >
            {m} min
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs h-7 px-2 rounded-full"
          onClick={() => setShowEta(false)}
          aria-label="Cancel"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      <Button
        size="sm"
        className="shrink-0 text-xs h-7 px-2.5 gap-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={() => setShowEta(true)}
      >
        <Navigation className="w-3 h-3" />
        I'm En Route
      </Button>
      {quickReplies.map((qr) => (
        <Button
          key={qr.label}
          variant="outline"
          size="sm"
          className="shrink-0 text-xs h-7 px-2.5 gap-1 rounded-full"
          onClick={() => onSelect(qr.message)}
        >
          <qr.icon className="w-3 h-3" />
          {qr.label}
        </Button>
      ))}
    </div>
  );
};
