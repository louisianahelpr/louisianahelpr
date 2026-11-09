// F103 (owner UI audit 11-09): the header over each group of rows on Notification settings (Messages, Jobs, Money,
// Account), in the Declutter group's own heading style.
export function NotificationGroupHeader({ title }: { title: string }) {
  return (
    <div
      className="px-3 min-[360px]:px-4 pt-3 pb-1.5 shrink-0"
      style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
      data-notification-group={title}
    >
      <h2 className="font-sans font-semibold text-ds-13 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
        {title}
      </h2>
    </div>
  );
}
