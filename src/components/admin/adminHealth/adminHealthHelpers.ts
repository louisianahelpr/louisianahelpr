import type { CheckTone } from "./useConfigChecks";

/** The dot beside each Health check row, by tone (moved out of AdminHealth.tsx, componentSizeRatchet). */
export const CHECK_TONE_DOT: Record<CheckTone, string> = {
  ok: "bg-[hsl(var(--bark))]",
  warn: "bg-[hsl(var(--burnt-sienna))]",
  danger: "bg-destructive",
  unknown: "bg-muted-foreground",
};

export const formatDelay = (mins: number | null): string => {
  if (mins === null) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  if (mins < 60 * 24) return `${(mins / 60).toFixed(1)} h`;
  return `${(mins / 60 / 24).toFixed(1)} d`;
};
