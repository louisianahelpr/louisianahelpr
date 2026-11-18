/** The gift card tab's "What is this?" card and its claiming banner (moved out of GiftCard.tsx, Q806; markup unchanged). */

export function WhatIsThis() {
  // Design audit r3 #34: was a 170 px grey "What is this?" box (a fill used nowhere else) before the form. Now one
  // muted line under the page title, the way other tabs open. Guard: src/test/auditR3Mediums.test.tsx.
  return (
    <p className="font-sans text-ds-14 leading-relaxed text-muted-foreground" data-gift-intro="">
      Send credit toward any job on Helpr. Find them by name or email, pick an amount, and we&apos;ll send a link to claim it.
    </p>
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
