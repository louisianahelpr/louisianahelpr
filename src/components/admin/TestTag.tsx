/**
 * Q368 (owner, 2026-09-24): admin queues KEEP seed (is_seed) rows and mark
 * them, instead of hiding them (the home counts exclude them and show them as
 * "(+N test)"). One tag, so every queue says "Test" the same way.
 */
export const TestTag = () => (
  <span
    data-testid="admin-test-tag"
    className="inline-flex items-center text-ds-10 px-1.5 py-0.5 rounded-full border border-border bg-muted text-muted-foreground font-semibold uppercase tracking-wide"
  >
    Test
  </span>
);
