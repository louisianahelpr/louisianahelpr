/** One numbered step on Sell a bunch. */
import type { ReactNode } from "react";

export function BunchSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
