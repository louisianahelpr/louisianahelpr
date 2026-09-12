import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The ONE primary action of a live job: "I'm Done — Request Payout".
 *
 * Extracted so the two steps that can offer it (on site, working) cannot draw
 * it differently — the disabled "Available in N min" state, the bark fill and
 * the explanatory sentence travel together.
 *
 * THE DISABLED TWIN IS STILL GONE. While a required photo is missing this
 * renders NOTHING (the caller passes `hasPhotos={false}`); it used to render a
 * dead full-width button reading "Upload before & after photos first" — an
 * instruction wearing the costume of the action it was refusing, directly under
 * the uploader that carries the instruction out.
 */
export function PayoutPrimary({
  hasPhotos,
  busy,
  tooEarly,
  minutesLeft,
  onComplete,
}: {
  hasPhotos: boolean;
  busy: boolean;
  tooEarly: boolean;
  minutesLeft: number;
  onComplete: () => void;
}) {
  if (!hasPhotos) return null;
  const disabled = busy || tooEarly;
  const label = busy ? "…" : tooEarly ? `Available in ${minutesLeft} min` : "I'm Done — Request Payout";
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        className="w-full rounded-ds-md"
        onClick={onComplete}
        disabled={disabled}
        style={
          !disabled
            ? {
                background: "hsl(var(--bark))",
                backgroundImage: "none",
                border: "1px solid hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                boxShadow: "var(--elev-bark-raised)",
              }
            : undefined
        }
      >
        <CheckCircle2 className="w-4 h-4 mr-1" />
        {label}
      </Button>
      {tooEarly && (
        <p className="font-sans text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Available 30 minutes after arrival to ensure quality.
        </p>
      )}
    </div>
  );
}
