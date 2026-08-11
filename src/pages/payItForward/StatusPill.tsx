// ─── Status pill ──────────────────────────────────────────────────────────────
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    available: { label: "Available", color: "hsl(var(--pif-green))", bg: "hsl(var(--pif-tint) / 0.12)" },
    sent: { label: "Ready to use", color: "hsl(var(--pif-green))", bg: "hsl(var(--pif-tint) / 0.12)" },
    redeemed: { label: "Redeemed", color: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.10)" },
    reserved: { label: "Reserved", color: "hsl(var(--amber-tint))", bg: "hsl(var(--amber-tint) / 0.12)" },
    expired: { label: "Expired", color: "hsl(var(--olivewood) / 0.8)", bg: "hsl(var(--olivewood) / 0.08)" },
  };
  const s = map[status] ?? map.available;
  return (
    <span
      className="text-ds-10 font-sans font-semibold uppercase px-1.5 py-0.5 rounded-ds-sm"
      style={{ color: s.color, background: s.bg, letterSpacing: "0.06em" }}
    >
      {s.label}
    </span>
  );
}
