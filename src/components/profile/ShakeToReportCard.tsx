import { useState } from "react";
import { Vibrate } from "lucide-react";
import { toast } from "sonner";
import { isShakeToReportOn, isShakeToReportSupported, turnOffShakeToReport, turnOnShakeToReport } from "@/lib/shakeToReport";
import { Switch } from "@/components/ui/switch";

/**
 * LEAD-SHAKE-PROMPT: the app only (a genuine native capability: the website
 * never asks for motion access). Off until the member turns it on here; the
 * phone's motion question rides this tap, never a random first tap.
 */
export function ShakeToReportCard() {
  const [shakeOn, setShakeOn] = useState(() => isShakeToReportOn());
  const handleShakeToggle = async (next: boolean) => {
    if (!next) {
      turnOffShakeToReport();
      setShakeOn(false);
      return;
    }
    const ok = await turnOnShakeToReport();
    setShakeOn(ok);
    if (!ok) toast("Shake to report stays off. Your phone didn't allow motion access.");
  };
  if (!isShakeToReportSupported()) return null;
  return (
    <div className="rounded-2xl liquid-glass p-card">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Vibrate className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            Shake to report a problem
          </h2>
          <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Shake your phone to open a bug report. Your phone asks once to allow motion.
          </p>
        </div>
        <Switch
          checked={shakeOn}
          onCheckedChange={handleShakeToggle}
          aria-label="Shake to report a problem"
        />
      </div>
    </div>
  );
}
