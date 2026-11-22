import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { composeAccessibleName, jobActionChipStyle, type JobActionTone } from "@/components/job-card/JobActionRow";

/**
 * Jobs audit 11-21 (L26): on the job page the crew roster's buttons were the card grid's chips (a small icon stacked
 * over a tiny label), unlike every other button on the page. This is the same action at the page's button look (the
 * action bar's size="wrap" and 15px words, JobPageActionRow), the icon BESIDE the words. Same tones as JobActionChip
 * (Message is one colour everywhere), same press; `data-job-action-chip` so the roster's row still gives each one an
 * equal share. The Posted card's roster keeps JobActionChip (its stack is for the card's tight grid at 375).
 * Guard: src/test/crewRosterButtonsRow1121.test.tsx.
 */
export function CrewRowButton({ icon: Icon, label, tone, onClick, disabled, ariaLabel }: {
  icon: LucideIcon;
  label: string;
  tone: JobActionTone;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Button
      variant="outline"
      size="wrap"
      className="w-full min-w-0 flex-row gap-1.5 rounded-full border-0 px-3 glass-press"
      style={jobActionChipStyle(tone)}
      disabled={disabled}
      data-job-action-chip=""
      data-crew-row-button=""
      aria-label={composeAccessibleName(label, ariaLabel)}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-ds-15 font-medium leading-tight">{label}</span>
    </Button>
  );
}
