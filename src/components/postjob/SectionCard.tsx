import type { LucideIcon } from "lucide-react";

interface SectionCardProps {
  /** Unused since the five-screen flow (kept optional for callers). */
  stepNumber?: number;
  /** The section's accessible name (aria-label). */
  title: string;
  /** Unused since the five-screen flow (kept optional for callers). */
  icon?: LucideIcon;
  /** Unused since the five-screen flow (kept optional for callers). */
  complete?: boolean;
  children: React.ReactNode;
}

/**
 * SectionCard: the plain card each Post a Job section sits in. Since the
 * five-screen flow (boards 23/44/3/45) each screen's Bodoni question names
 * the section, so the old numbered chapter header is gone; `title` is the
 * card's accessible name. stepNumber / icon / complete are no longer drawn.
 */
export function SectionCard({ title, children }: SectionCardProps) {
  // Post a Job is one question per screen now (boards 23, 44, 3, 45, 46): the
  // screen's Bodoni question (PostJobStepHeader) names the section, so the
  // numbered chapter header that served the old one-page form is gone. The
  // title stays as the section's accessible name.
  return (
    <section aria-label={title} className="rounded-ds-lg bg-card border border-border p-card space-y-5">
      {children}
    </section>
  );
}
