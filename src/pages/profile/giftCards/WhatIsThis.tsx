/** The gift card tab's "What is this?" card and its claiming banner (moved out of GiftCard.tsx, Q806; markup unchanged). */
import { Sparkles } from "lucide-react";

export function WhatIsThis() {
  return (
    <>
      {/* What is this? */}
      {/* Card radius + padding are the canonical profile-card values
          (`rounded-2xl … p-5`). Only the FILL stays gift-tinted — the
          bespoke `rounded-ds-md p-4` box these used made the screen read
          as a different app than the tabs it is opened from. */}
      {/* Spec v2 rebuild (2026-10-21): a hint row on --subtle with an
          olive icon, not a green box. */}
      <div className="rounded-[20px] bg-muted p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <p className="font-sans font-semibold text-ds-14 text-foreground">
            What is this?
          </p>
        </div>
        <p
          className="font-sans text-ds-13 leading-relaxed"
          style={{ color: "hsl(var(--ink-deep) / 0.75)" }}
        >
          Send a Helpr gift card to someone you know. Find them by name or type their email,
          choose an amount, and we'll send them a link to claim it — they can put it toward
          any job they need done.
        </p>
      </div>
    </>
  );
}

/** Shown while a gift claim (?claim= link or the card's Claim This Gift button) is in flight. */
export function ClaimingBanner() {
  return (
    <div
      className="rounded-[20px] border border-border bg-card p-4 flex items-center gap-3 mb-6"
    >
      <div
        className="w-4 h-4 shrink-0 rounded-full border-2 border-t-transparent motion-safe:animate-spin"
        style={{ borderColor: "hsl(var(--bark))", borderTopColor: "transparent" }}
      />
      <p className="font-sans text-ds-13 text-foreground">
        Claiming your gift card…
      </p>
    </div>
  );
}
