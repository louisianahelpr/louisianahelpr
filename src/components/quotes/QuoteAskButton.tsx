import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgeGateNote } from "@/components/AgeGateNote";

/**
 * Review's one button when the poster picked "Get quotes" (A2-C32, lead option A): nothing is charged here,
 * so there is no payment breakdown, confirm box or pay button, only "Ask for quotes".
 */
export function QuoteAskButton({ sending, onAsk, underAge }: { sending: boolean; onAsk: () => void; underAge: boolean }) {
  return (
    <div className="space-y-3">
      <Button variant="primary" className="w-full" size="lg" onClick={onAsk} disabled={sending || underAge}>
        {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Send className="w-4 h-4 mr-2" aria-hidden />}
        {sending ? "Sending…" : "Ask for quotes"}
      </Button>
      {underAge && <AgeGateNote kind="post" className="text-center" />}
    </div>
  );
}
