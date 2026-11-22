import { Ban, Flag, MoreHorizontal, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { hapticLight } from "@/lib/haptics";

/** Each menu row is a 44px target with its words (Jobs audit 11-21, G10). */
const ROW = "min-h-11 gap-2 px-3 text-ds-14";

/**
 * The applicant row's "..." menu (Jobs audit 11-21, G10). Private note, Report and Block were three 32px icon-only
 * buttons beside Compare, with Block (red) at the same weight as the everyday actions; they squeezed the name to
 * "Jean-Bapti..." and added three of the 21 sub-44px targets measured on the panel. They are one 44px "..." now,
 * opening labelled 44px rows; Block stays last and red. Message, Hire and Decline stay on the row (ApplicantHireRow).
 */
export function ApplicantMoreMenu({
  helperName,
  hasNote,
  onNote,
  onReport,
  onBlock,
}: {
  helperName: string;
  hasNote: boolean;
  onNote: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="iconCompact" className="shrink-0 rounded-full" aria-label={`More for ${helperName}`} data-applicant-more="">
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuItem className={ROW} onClick={() => { hapticLight(); onNote(); }} data-applicant-menu="note">
          <NotebookPen className="h-4 w-4 shrink-0" aria-hidden="true" />
          {hasNote ? "Edit your private note" : "Add a private note"}
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} onClick={() => { hapticLight(); onReport(); }} data-applicant-menu="report">
          <Flag className="h-4 w-4 shrink-0" aria-hidden="true" />
          Report application
        </DropdownMenuItem>
        <div role="separator" className="my-1 h-px bg-border" />
        <DropdownMenuItem
          className={`${ROW} text-[hsl(var(--danger-ink))] focus:text-[hsl(var(--danger-ink))]`}
          onClick={() => { hapticLight(); onBlock(); }}
          data-applicant-menu="block"
        >
          <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
          Block {helperName}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
