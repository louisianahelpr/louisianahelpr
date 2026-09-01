// The shared panel shell for /analytics: one frosted card, one heading, one
// optional caption that says WHERE the number came from.
//
// The caption is not decoration. Every panel on this page has to answer "over
// what, exactly?" — a fee total means nothing without its window, and a market
// median means nothing without its parish. Making the slot part of the shell
// means a new panel cannot quietly ship without one.

import type { ReactNode } from "react";

interface AnalyticsPanelProps {
  title: string;
  /** Where the numbers came from: window, scope, sample. */
  caption?: ReactNode;
  /** Small trailing control (a range toggle, a link). */
  actions?: ReactNode;
  children: ReactNode;
}

export function AnalyticsPanel({ title, caption, actions, children }: AnalyticsPanelProps) {
  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className="font-display italic font-bold leading-tight text-headline-section"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
          >
            {title}
          </h2>
          {caption && (
            <p className="text-ds-11 mt-1" style={{ color: "hsl(var(--olivewood) / 0.62)" }}>
              {caption}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A single headline figure. `value` is already formatted; `null` is never rendered as 0. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | null;
  hint?: string;
  tone?: "default" | "positive";
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 min-w-0"
      style={{
        background: "hsl(var(--ivory-sand) / 0.6)",
        border: "0.5px solid hsl(var(--olivewood) / 0.10)",
      }}
    >
      {/* WRAPS, never truncates. `truncate` here cut "Platform fees" to
          "Platform fe…" and "You apply within" to "You apply …" at 320px in
          senior mode — a label that has lost the word carrying its meaning is
          worse than a label on two lines. */}
      <div className="text-ds-11 leading-tight" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
        {label}
      </div>
      <div
        className="text-ds-20 font-semibold tabular-nums mt-0.5"
        style={{
          color:
            value === null
              ? "hsl(var(--olivewood) / 0.35)"
              : tone === "positive"
                ? "hsl(var(--bark))"
                : "hsl(var(--ink-deep))",
        }}
      >
        {/* An em dash, never "0". A metric with no sample has no value; a zero
            is a claim that somebody measured it. */}
        {value ?? "—"}
      </div>
      {hint && (
        <div className="text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
