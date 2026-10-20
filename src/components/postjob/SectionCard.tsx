import type { LucideIcon } from "lucide-react";

interface SectionCardProps {
  /** 1-based chapter number shown in the corner marker. */
  stepNumber: number;
  /** Bodoni display title — the chapter name. */
  title: string;
  /** Section icon, rendered inside the chapter marker. */
  icon: LucideIcon;
  /** True once the section's required fields are satisfied. */
  complete: boolean;
  children: React.ReactNode;
}

/**
 * SectionCard — the shared "chapter" container for the three Post-a-Task
 * sections (Details / Logistics / Budget). Gives every section the same
 * contained panel, the same internal padding, and the same editorial
 * header: a numbered chapter marker + Bodoni title. This is what turns
 * the wall of fields into three unmistakable chapters.
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
