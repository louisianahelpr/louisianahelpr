/**
 * A3-30 (audit 11-01): Finish your profile names the next step and how far along it is: "Next: add your full name ·
 * step 1 of 3" (the first item still missing; N counts the done ones plus this one). In the "Still needed" box, in the
 * member's language. Moved out of CompleteProfile.tsx (component-size ratchet).
 */
type Item = { done: boolean; step: string };

export function profileNextStep(checklist: Item[]): { step: string; n: number; total: number } | null {
  const next = checklist.find((c) => !c.done);
  if (!next) return null;
  return { step: next.step, n: checklist.filter((c) => c.done).length + 1, total: checklist.length };
}

export function ProfileNextStep({ checklist, t }: { checklist: Item[]; t: (key: "profileGate.nextStep", vars: Record<string, string | number>) => string }) {
  const v = profileNextStep(checklist);
  if (!v) return null;
  return (
    <p data-next-step="you" className="text-ds-15 font-semibold leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
      {t("profileGate.nextStep", { step: v.step, n: v.n, total: v.total })}
    </p>
  );
}
