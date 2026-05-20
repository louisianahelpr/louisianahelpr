export function EmptyJobs({ className }: { className?: string }) {
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
      <path d="M32 28 L46 22 L60 36 L52 50 Z" />
      <path d="M52 50 L88 86" />
      <path d="M82 80 L96 94" />
      <circle cx="76" cy="50" r="16" />
      <path d="M88 62 L100 74" />
      <path d="M70 50 L82 50" />
      <path d="M76 44 L76 56" />
    </svg>
  );
}
