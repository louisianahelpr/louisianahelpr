/**
 * No phone or browser registered for push (owner 2026-11-01): say how to get alerts at the TOP of the
 * notification settings, not only in the "Send a test" row at the bottom.
 */
export function PushDeviceHint() {
  return (
    <p
      data-testid="push-device-hint"
      className="px-3 min-[360px]:px-4 py-2.5 font-sans text-ds-13"
      style={{ color: "hsl(var(--ink-deep) / 0.8)", borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
    >
      Get alerts on your phone: allow notifications for Louisiana Helpr.
    </p>
  );
}
