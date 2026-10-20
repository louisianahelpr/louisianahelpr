/**
 * The job-status chip INSIDE Messages (inbox row + chat header) is neutral ink on a
 * faint ink tint (lead review of board 38, 2026-10-20): rust is for money only
 * (spec v2 §1.1), and the shared jobStatusColor map paints in_progress / accepted
 * in sienna. The label still comes from the canonical jobStatusLabel.
 */
export const MESSAGE_STATUS_CHIP = { text: "hsl(var(--foreground))", bg: "hsl(var(--foreground) / 0.07)" } as const;
