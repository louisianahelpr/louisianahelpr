import {
  AlertTriangle, CheckCircle2, Truck,
} from "lucide-react";

export const STATUS_STEPS = [
  { key: "needs_transport", label: "Needs transport", icon: AlertTriangle, color: "hsl(var(--burnt-sienna))" },
  { key: "helper_assigned", label: "Helper assigned", icon: Truck, color: "hsl(var(--bark))" },
  { key: "evacuated", label: "Evacuated", icon: Truck, color: "hsl(var(--gold-warm))" },
  { key: "safe", label: "Safe", icon: CheckCircle2, color: "hsl(var(--sage))" },
  { key: "reunited", label: "Reunited", icon: CheckCircle2, color: "hsl(var(--bark))" },
] as const;

export type EvacStatus = (typeof STATUS_STEPS)[number]["key"];

export const statusMeta = (status: string) =>
  STATUS_STEPS.find((s) => s.key === status) ?? STATUS_STEPS[0];

export const speciesEmoji = (species: string) =>
  ({ dog: "🐕", cat: "🐈", bird: "🐦", rabbit: "🐇", reptile: "🦎", other: "🐾" }[species] ?? "🐾");
