import { CalendarDays } from "lucide-react";

// ---------------------------------------------------------------------------
// Empty-state illustration
// ---------------------------------------------------------------------------
export function EmptyConnections() {
  return (
    <div className="flex flex-col items-center py-10 gap-3">
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: 56, height: 56,
          background: "hsl(var(--gold-warm) / 0.12)",
          border: "1.5px solid hsl(var(--gold-warm) / 0.3)",
        }}
      >
        <CalendarDays className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} />
      </div>
      <p
        className="font-display italic font-semibold"
        style={{ fontSize: "0.98rem", color: "hsl(var(--ink-deep))" }}
      >
        No calendars connected yet
      </p>
      <p
        className="text-center max-w-xs"
        style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Add your first rental calendar below and Helpr will auto-post
        cleaning jobs after every guest checkout.
      </p>
    </div>
  );
}
