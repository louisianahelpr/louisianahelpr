// ─── Loading placeholders for the two gift card lists ────────────────────────
const TILE_BG = { background: "hsl(var(--olivewood) / 0.07)" };

export function ReceivedListSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-ds-md h-24 motion-safe:animate-pulse" style={TILE_BG} />
      ))}
    </div>
  );
}

export function SentListSkeleton() {
  return <div className="rounded-ds-md h-16 motion-safe:animate-pulse" style={TILE_BG} />;
}
