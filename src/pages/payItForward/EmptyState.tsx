// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-ds-md p-4 text-center"
      style={{ background: "hsl(var(--bark) / 0.04)", border: "0.5px dashed hsl(var(--bark) / 0.18)" }}
    >
      <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        {message}
      </p>
    </div>
  );
}
