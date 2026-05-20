export function EmptyPosts({ className }: { className?: string }) {
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
      <path d="M30 22 L74 22 L86 34 L86 98 L30 98 Z" />
      <path d="M74 22 L74 34 L86 34" />
      <path d="M40 50 L66 50" />
      <path d="M40 62 L70 62" />
      <path d="M40 74 L60 74" />
      <path d="M82 78 L100 60 L106 66 L88 84 L80 86 Z" />
      <path d="M98 62 L104 68" />
    </svg>
  );
}
