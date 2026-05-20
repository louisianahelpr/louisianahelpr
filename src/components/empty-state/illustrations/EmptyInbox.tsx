export function EmptyInbox({ className }: { className?: string }) {
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
      <path d="M22 54 L60 30 L98 54 L98 92 Q98 96 94 96 L26 96 Q22 96 22 92 Z" />
      <path d="M22 54 L60 76 L98 54" />
      <path d="M60 76 L60 96" />
      <path d="M78 20 L92 20 L78 32 L92 32" />
      <path d="M70 12 L78 12 L70 18 L78 18" />
    </svg>
  );
}
