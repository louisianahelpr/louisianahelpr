import { Button } from "@/components/ui/button";
import { Clock, MapPin, CheckCircle2, ThumbsUp, AlertTriangle } from "lucide-react";

const quickReplies = [
  { label: "On my way!", icon: MapPin, message: "🚗 On my way! Be there shortly." },
  { label: "Running late", icon: Clock, message: "⏰ Running about 10 minutes late — sorry for the delay!" },
  { label: "Job complete", icon: CheckCircle2, message: "✅ All done! Please review the work and mark as complete." },
  { label: "Sounds good", icon: ThumbsUp, message: "👍 Sounds good, thanks!" },
  { label: "Need more info", icon: AlertTriangle, message: "Could you share a few more details so I can prepare?" },
];

interface QuickRepliesProps {
  onSelect: (message: string) => void;
}

export const QuickReplies = ({ onSelect }: QuickRepliesProps) => (
  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
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
