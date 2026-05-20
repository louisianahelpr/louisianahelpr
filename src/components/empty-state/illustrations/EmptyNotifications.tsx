export function EmptyNotifications({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M40 80 Q40 56 60 50 Q80 56 80 80 L84 86 L36 86 Z" />
      <path d="M54 92 Q60 98 66 92" />
      <path d="M60 44 L60 50" />
      <path d="M22 56 L30 60" />
      <path d="M22 70 L30 70" />
      <path d="M98 56 L90 60" />
      <path d="M98 70 L90 70" />
    </svg>
  );
}
