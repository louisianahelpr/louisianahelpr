// Shared tier display name helper for edge functions
// Maps tier IDs to their branded display names (e.g., "pro" → "Helpr Pro")

export function tierDisplayName(tier: string | null | undefined): string {
  if (!tier) return "Free";
  const normalized = String(tier).toLowerCase();
  const tiers: Record<string, string> = {
    free: "Free",
    basic: "Helpr Basic",
    pro: "Helpr Pro",
    elite: "Helpr Elite",
    business: "Business",
  };
  return tiers[normalized] ?? normalized;
}
